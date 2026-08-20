import fs from 'node:fs';
import path from 'node:path';
import {
  loadCatalogManifest,
  productPathFromManifest
} from '../domain/queensilver.js';

function asPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function productSummary(entry) {
  return {
    productId: String(entry.product_id ?? ''),
    name: entry.name || entry.title_hint || '',
    categories: Array.isArray(entry.categories) ? entry.categories : [],
    sourcePriceDisplay: entry.sale_price_display || '',
    optionCount: Number(entry.option_count || 0),
    imageCount: Number(entry.image_count || 0),
    completed: entry.completed !== false,
    sourceUrl: entry.url || null
  };
}

export class CatalogRepository {
  constructor(catalogRoot) {
    this.catalogRoot = catalogRoot ? path.resolve(catalogRoot) : '';
    this.cached = null;
  }

  setRoot(catalogRoot) {
    const resolved = catalogRoot ? path.resolve(catalogRoot) : '';
    if (resolved !== this.catalogRoot) {
      this.catalogRoot = resolved;
      this.cached = null;
    }
  }

  manifestPath() {
    if (!this.catalogRoot) throw new Error('catalogRoot가 설정되지 않았습니다.');
    return path.join(this.catalogRoot, 'catalog_manifest.json');
  }

  load() {
    const manifestPath = this.manifestPath();
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`catalog_manifest.json을 찾을 수 없습니다: ${manifestPath}`);
    }
    const mtimeMs = fs.statSync(manifestPath).mtimeMs;
    if (!this.cached || this.cached.mtimeMs !== mtimeMs) {
      const { manifest } = loadCatalogManifest(this.catalogRoot);
      this.cached = { manifest, mtimeMs };
    }
    return this.cached.manifest;
  }

  stats() {
    const manifest = this.load();
    const entries = Object.values(manifest.products || {});
    const byCategory = {};
    for (const entry of entries) {
      for (const category of entry.categories || ['미분류']) {
        byCategory[category] = (byCategory[category] || 0) + 1;
      }
    }
    return {
      source: manifest.source || null,
      totalProducts: Number(manifest.total_products ?? entries.length),
      totalCompleted: Number(manifest.total_completed ?? entries.filter(item => item.completed !== false).length),
      byCategory
    };
  }

  getById(productId) {
    const id = String(productId ?? '').trim();
    if (!id) return null;
    const manifest = this.load();
    const direct = manifest.products?.[id];
    if (direct) return direct;
    return Object.values(manifest.products || {}).find(item => String(item.product_id) === id) || null;
  }

  requireById(productId) {
    const entry = this.getById(productId);
    if (!entry) {
      const error = new Error(`카탈로그에서 상품을 찾을 수 없습니다: ${productId}`);
      error.code = 'CATALOG_PRODUCT_NOT_FOUND';
      throw error;
    }
    return entry;
  }

  resolveProductPath(productId) {
    const entry = this.requireById(productId);
    const productPath = productPathFromManifest(this.catalogRoot, entry);
    const relative = path.relative(this.catalogRoot, productPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`상품 경로가 catalogRoot 밖을 가리킵니다: ${productId}`);
    }
    return productPath;
  }

  getSummary(productId) {
    return productSummary(this.requireById(productId));
  }

  search({ query, category, limit = 50, offset = 0 } = {}) {
    const manifest = this.load();
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('ko-KR');
    const normalizedCategory = String(category || '').trim();
    const safeLimit = Math.max(1, asPositiveInteger(limit, 50, 200));
    const safeOffset = asPositiveInteger(offset, 0, 100_000);

    const matched = Object.values(manifest.products || {}).filter(entry => {
      if (normalizedCategory && !(entry.categories || []).includes(normalizedCategory)) return false;
      if (!normalizedQuery) return true;
      const haystack = [entry.product_id, entry.name, entry.title_hint, ...(entry.categories || [])]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ko-KR');
      return haystack.includes(normalizedQuery);
    });

    return {
      total: matched.length,
      limit: safeLimit,
      offset: safeOffset,
      items: matched.slice(safeOffset, safeOffset + safeLimit).map(productSummary)
    };
  }
}
