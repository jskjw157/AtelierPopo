import { loadProductInfo } from '../domain/queensilver.js';
import { sellerManagementCode } from '../domain/payload.js';
import { HttpError } from './errors.js';
import { parseBooleanQuery, parseIntegerQuery, validateConfirmation, validateIdempotencyKey } from './security.js';
import { publicCreateResult, publicJob, publicPreview } from './presenters.js';
import {
  assertHttpWriteAllowed,
  replyIfIdempotentOperationExists,
  route,
  sendJson,
  sendOperationResponse,
  validateProductId
} from './runtime.js';

export function createProductRoutes({ app, httpConfig, createAsyncOperation, redactionRoots }) {
  return [
    route('GET', /^\/api\/v1\/products$/, async ({ req, res, url }) => {
      const result = app.catalogRepository.search({
        query: url.searchParams.get('query'),
        category: url.searchParams.get('category'),
        limit: parseIntegerQuery(url.searchParams.get('limit'), 50, { min: 1, max: 200 }),
        offset: parseIntegerQuery(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 })
      });
      sendJson(req, res, 200, { ok: true, ...result });
    }),

    route('GET', /^\/api\/v1\/products\/([^/]+)$/, async ({ req, res, match }) => {
      const productId = validateProductId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, {
        ok: true,
        product: app.catalogRepository.getSummary(productId),
        job: publicJob(app.ledger.get(productId), { includeDetails: false, redactionRoots })
      });
    }),

    route('POST', /^\/api\/v1\/products\/([^/]+)\/validate$/, async ({ req, res, match }) => {
      const productId = validateProductId(decodeURIComponent(match[1]));
      const productPath = app.catalogRepository.resolveProductPath(productId);
      const loaded = loadProductInfo(productPath);
      sendJson(req, res, 200, {
        ok: loaded.errors.length === 0,
        product: {
          productId: loaded.product.product_id,
          name: loaded.product.name,
          categories: loaded.product.categories || [],
          soldOut: Boolean(loaded.product.sold_out),
          imageCount: (loaded.product.downloaded_images || []).length
        },
        errors: loaded.errors
      });
    }),

    route('POST', /^\/api\/v1\/products\/([^/]+)\/preview$/, async ({ req, res, match, url }) => {
      const productId = validateProductId(decodeURIComponent(match[1]));
      const productPath = app.catalogRepository.resolveProductPath(productId);
      const preview = app.productService.preview(productPath);
      sendJson(req, res, 200, {
        ok: true,
        preview: publicPreview(preview, {
          includePayload: parseBooleanQuery(url.searchParams.get('includePayload'), false)
        })
      });
    }),

    route('GET', /^\/api\/v1\/products\/([^/]+)\/remote$/, async ({ req, res, match }) => {
      const productId = validateProductId(decodeURIComponent(match[1]));
      app.catalogRepository.requireById(productId);
      const code = sellerManagementCode(app.config, productId);
      const product = await app.productsApi.findBySellerManagementCode(code);
      sendJson(req, res, 200, {
        ok: true,
        sellerManagementCode: code,
        exists: Boolean(product),
        product
      });
    }),

    route('POST', /^\/api\/v1\/products\/([^/]+)\/register$/, async ({ req, res, match, body }) => {
      const productId = validateProductId(decodeURIComponent(match[1]));
      const confirmation = validateConfirmation(body.confirmation, app.config.writeConfirmation);
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const operationType = 'register_product';
      if (replyIfIdempotentOperationExists({
        req,
        res,
        ledger: app.ledger,
        idempotencyKey,
        operationType,
        sourceProductId: productId,
        redactionRoots
      })) return;

      assertHttpWriteAllowed(app, httpConfig, confirmation);
      const productPath = app.catalogRepository.resolveProductPath(productId);
      const preview = app.productService.preview(productPath);
      if (!preview.executable) {
        throw new HttpError(422, 'PRODUCT_NOT_EXECUTABLE', '상품이 현재 설정으로 등록 가능한 상태가 아닙니다.', {
          validationErrors: preview.validationErrors,
          soldOut: preview.source.soldOut
        });
      }

      const created = await createAsyncOperation({
        idempotencyKey,
        operationType,
        sourceProductId: productId,
        request: { productId },
        task: async () => publicCreateResult(await app.productService.create(productPath, { confirm: confirmation }))
      });
      sendOperationResponse(req, res, created.row, { reused: created.reused, redactionRoots });
    }, { write: true })
  ];
}
