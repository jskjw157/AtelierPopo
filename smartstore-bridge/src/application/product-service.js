import fs from 'node:fs';
import path from 'node:path';
import { loadProductTemplate } from '../config.js';
import { loadProductInfo, resolveImagePlan, listProductJsonFiles } from '../domain/queensilver.js';
import { calculateSalePrice } from '../domain/pricing.js';
import { buildOptionInfo } from '../domain/options.js';
import {
  buildProductPayload,
  previewImageUrls,
  sellerManagementCode,
  validateProductPayload
} from '../domain/payload.js';
import { prepareAndUploadProductImages } from '../naver/images.js';

function responseNumbers(response) {
  const productNos = response?.productNos?.[0] || response || {};
  return {
    originProductNo: productNos.originProductNo || response?.originProductNo,
    channelProductNo: productNos.smartstoreChannelProductNo || response?.smartstoreChannelProductNo || response?.channelProductNo
  };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export class ProductService {
  constructor({ config, client, productsApi, ledger }) {
    this.config = config;
    this.client = client;
    this.productsApi = productsApi;
    this.ledger = ledger;
  }

  categoryIdFor(product) {
    for (const category of product.categories || []) {
      const id = this.config.categories?.[category];
      if (id && !String(id).includes('REPLACE_WITH')) return id;
    }
    throw new Error(`카테고리 매핑이 없습니다: ${(product.categories || []).join(', ')}`);
  }

  preview(inputPath) {
    const loaded = loadProductInfo(inputPath);
    if (loaded.errors.length) throw new Error(`소스 상품 검증 실패:\n- ${loaded.errors.join('\n- ')}`);
    const { product, productDir, productJsonPath } = loaded;
    const code = sellerManagementCode(this.config, product.product_id);
    const imagePlan = resolveImagePlan(product, productDir, this.config.images);
    if (!imagePlan.representative) throw new Error('대표 이미지가 없습니다.');
    if (imagePlan.missing.length) throw new Error(`로컬 이미지가 누락되었습니다: ${imagePlan.missing.join(', ')}`);
    const categoryId = this.categoryIdFor(product);
    const price = calculateSalePrice(product.sale_price_display, this.config.pricing);
    const optionInfo = buildOptionInfo(product.options, {
      stockQuantity: this.config.defaultStockQuantity,
      sellerCode: code,
      forceSoldOut: Boolean(product.sold_out)
    });
    const template = loadProductTemplate(this.config);
    const payload = buildProductPayload({
      template,
      config: this.config,
      product,
      categoryId,
      price,
      optionInfo,
      imageUrls: previewImageUrls(imagePlan)
    });
    const payloadErrors = validateProductPayload(payload, { execute: false });
    const result = {
      source: {
        productId: product.product_id,
        name: product.name,
        categories: product.categories,
        soldOut: Boolean(product.sold_out),
        sourcePath: productJsonPath,
        sourceUrl: product.source_url
      },
      sellerManagementCode: code,
      categoryId,
      price,
      options: optionInfo,
      imagePlan: {
        representative: imagePlan.representative.path,
        detailCount: imagePlan.detail.length,
        detail: imagePlan.detail.map(item => item.path)
      },
      payload,
      validationErrors: payloadErrors,
      executable: payloadErrors.length === 0 && (!product.sold_out || this.config.includeSoldOut)
    };
    if (this.ledger) {
      this.ledger.upsertQueued({ sourceProductId: product.product_id, sellerManagementCode: code, sourcePath: productJsonPath });
      this.ledger.mark(product.product_id, 'previewed', { payload });
    }
    return result;
  }

  assertWriteAllowed(confirm) {
    if (!this.config.naver.allowWrites) {
      throw new Error('NAVER_ALLOW_WRITES=false입니다. 실제 등록 전에 .env에서 true로 바꿔야 합니다.');
    }
    if (confirm !== this.config.writeConfirmation) {
      throw new Error(`확인 문구가 틀렸습니다. --confirm ${this.config.writeConfirmation} 가 필요합니다.`);
    }
  }

  async create(inputPath, { confirm } = {}) {
    this.assertWriteAllowed(confirm);
    const preview = this.preview(inputPath);
    if (preview.source.soldOut && !this.config.includeSoldOut) {
      this.ledger?.mark(preview.source.productId, 'skipped', { lastError: 'source_sold_out' });
      return { status: 'skipped', reason: 'source_sold_out', preview };
    }
    if (preview.validationErrors.length) {
      throw new Error(`상품 등록 전 검증 실패:\n- ${preview.validationErrors.join('\n- ')}`);
    }

    this.ledger?.mark(preview.source.productId, 'creating');
    try {
      const existing = await this.productsApi.findBySellerManagementCode(preview.sellerManagementCode);
      if (existing) {
        this.ledger?.mark(preview.source.productId, 'exists', { result: existing });
        return { status: 'exists', existing, preview };
      }

      const { product, productDir } = loadProductInfo(inputPath);
      const imagePlan = resolveImagePlan(product, productDir, this.config.images);
      const uploadedImages = await prepareAndUploadProductImages(
        this.client,
        product.product_id,
        imagePlan,
        this.config,
        this.config.workDir
      );
      const template = loadProductTemplate(this.config);
      const payload = buildProductPayload({
        template,
        config: this.config,
        product,
        categoryId: preview.categoryId,
        price: preview.price,
        optionInfo: preview.options,
        imageUrls: uploadedImages
      });
      const errors = validateProductPayload(payload, { execute: true });
      if (errors.length) throw new Error(`최종 페이로드 검증 실패:\n- ${errors.join('\n- ')}`);
      const response = await this.productsApi.create(payload);
      const numbers = responseNumbers(response);
      this.ledger?.mark(product.product_id, 'created', {
        ...numbers,
        payload,
        result: response
      });
      return { status: 'created', ...numbers, response };
    } catch (error) {
      this.ledger?.mark(preview.source.productId, 'failed', { lastError: error.stack || error.message });
      throw error;
    }
  }

  enqueueCatalog(catalogRoot) {
    if (!this.ledger) throw new Error('원장(ledger)이 필요합니다.');
    const files = listProductJsonFiles(catalogRoot);
    let queued = 0;
    let failed = 0;
    const failures = [];
    for (const file of files) {
      try {
        const { product } = loadProductInfo(file);
        this.ledger.upsertQueued({
          sourceProductId: product.product_id,
          sellerManagementCode: sellerManagementCode(this.config, product.product_id),
          sourcePath: file
        });
        queued += 1;
      } catch (error) {
        failed += 1;
        failures.push({ file, error: error.message });
      }
    }
    return { total: files.length, queued, failed, failures: failures.slice(0, 20) };
  }

  async runBatch({ limit = 20, execute = false, confirm, status = 'queued' } = {}) {
    if (!this.ledger) throw new Error('원장(ledger)이 필요합니다.');
    const configuredMax = Math.max(1, Number(this.config.batch?.maxSize ?? 20));
    const effectiveLimit = Math.min(Math.max(1, Number(limit)), configuredMax);
    const jobs = this.ledger.list({ status, limit: effectiveLimit });
    const results = [];
    for (const [index, job] of jobs.entries()) {
      try {
        if (execute) {
          const result = await this.create(job.source_path, { confirm });
          results.push({
            productId: job.source_product_id,
            ok: true,
            status: result.status,
            originProductNo: result.originProductNo,
            channelProductNo: result.channelProductNo
          });
        } else {
          const preview = this.preview(job.source_path);
          const previewFile = this.writePreview(preview);
          results.push({
            productId: job.source_product_id,
            name: preview.source.name,
            ok: true,
            status: 'previewed',
            executable: preview.executable,
            validationErrors: preview.validationErrors,
            salePrice: preview.price.salePrice,
            previewFile
          });
        }
      } catch (error) {
        if (!execute) this.ledger.mark(job.source_product_id, 'failed', { lastError: error.stack || error.message });
        results.push({ productId: job.source_product_id, ok: false, status: 'failed', error: error.message });
      }
      if (execute && index < jobs.length - 1) {
        await sleep(Math.max(0, Number(this.config.batch?.delayMs ?? 800)));
      }
    }
    return {
      requested: jobs.length,
      effectiveLimit,
      succeeded: results.filter(item => item.ok).length,
      failed: results.filter(item => !item.ok).length,
      results
    };
  }

  writePreview(preview, outputPath) {
    const resolved = path.resolve(outputPath || path.join(this.config.workDir, 'previews', `${preview.source.productId}.json`));
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(preview, null, 2));
    return resolved;
  }
}
