import { MultiSourceCatalogError, asMultiSourceCatalogError } from './errors.js';

function asPositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export class CatalogIngestionService {
  constructor({ registry, persistence, config, logger = console }) {
    if (!registry || !persistence) throw new Error('CatalogIngestionService에는 registry와 persistence가 필요합니다.');
    this.registry = registry;
    this.persistence = persistence;
    this.config = config || {};
    this.logger = logger;
  }

  async ingestSource({
    sourceId,
    mode = 'incremental',
    cursor = null,
    productIds = [],
    pageSize,
    maxPages,
    maxProducts,
    force = false
  } = {}) {
    const normalizedSourceId = String(sourceId || '').trim().toLowerCase();
    if (!normalizedSourceId) throw new MultiSourceCatalogError('CATALOG_SOURCE_ID_REQUIRED', 'sourceId가 필요합니다.');
    this.registry.requireSource(normalizedSourceId);
    const safePageSize = asPositiveInteger(pageSize, this.config.ingestionPageSize || 100, 500);
    const safeMaxPages = asPositiveInteger(maxPages, this.config.ingestionMaxPages || 10, 1000);
    const safeMaxProducts = asPositiveInteger(maxProducts, this.config.ingestionMaxProducts || 2000, 100_000);
    const requestedIds = [...new Set((Array.isArray(productIds) ? productIds : []).map(value => String(value).trim()).filter(Boolean))]
      .slice(0, safeMaxProducts);
    const effectiveMode = requestedIds.length ? 'single_product' : mode;
    const run = await this.persistence.startIngestionRun({
      sourceId: normalizedSourceId,
      mode: effectiveMode,
      sourceCursor: cursor,
      details: { pageSize: safePageSize, maxPages: safeMaxPages, maxProducts: safeMaxProducts, force: Boolean(force) }
    });
    const counts = { discoveredCount: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, failedCount: 0 };
    const failures = [];
    let nextCursor = cursor;
    let pages = 0;

    const ingestOne = async sourceProductId => {
      counts.discoveredCount += 1;
      try {
        const fetched = await this.registry.getSourceProduct(normalizedSourceId, sourceProductId, {
          includeRaw: true,
          force: Boolean(force)
        });
        const stored = await this.persistence.upsertSourceProduct(fetched.sourceProduct, {
          rawProduct: fetched.rawProduct || fetched.sourceProduct
        });
        if (stored.changeType === 'created') counts.createdCount += 1;
        else if (stored.changeType === 'updated') counts.updatedCount += 1;
        else counts.unchangedCount += 1;
        return stored;
      } catch (error) {
        counts.failedCount += 1;
        const normalized = asMultiSourceCatalogError(error, 'CATALOG_PRODUCT_INGEST_FAILED');
        if (failures.length < 100) {
          failures.push({ sourceProductId: String(sourceProductId), code: normalized.code, message: normalized.message });
        }
        this.logger?.warn?.('Catalog source product ingestion failed', {
          sourceId: normalizedSourceId,
          sourceProductId: String(sourceProductId),
          code: normalized.code,
          message: normalized.message
        });
        return null;
      }
    };

    try {
      if (requestedIds.length) {
        for (const sourceProductId of requestedIds) await ingestOne(sourceProductId);
        nextCursor = requestedIds.at(-1) || cursor;
      } else {
        let currentCursor = cursor;
        while (pages < safeMaxPages && counts.discoveredCount < safeMaxProducts) {
          const remaining = safeMaxProducts - counts.discoveredCount;
          const page = await this.registry.listChanges(normalizedSourceId, {
            cursor: currentCursor,
            limit: Math.min(safePageSize, remaining),
            force: Boolean(force)
          });
          pages += 1;
          const items = Array.isArray(page.items) ? page.items : [];
          for (const item of items) {
            const id = item.sourceProductId || item.productId || item.id;
            if (!id) {
              counts.discoveredCount += 1;
              counts.failedCount += 1;
              if (failures.length < 100) failures.push({ sourceProductId: null, code: 'CATALOG_LIST_ITEM_ID_MISSING', message: '상품 변경 목록에 sourceProductId가 없습니다.' });
              continue;
            }
            await ingestOne(id);
            if (counts.discoveredCount >= safeMaxProducts) break;
          }
          nextCursor = page.nextCursor ?? currentCursor;
          if (!page.hasMore || !items.length || counts.discoveredCount >= safeMaxProducts) break;
          if (String(nextCursor || '') === String(currentCursor || '')) {
            throw new MultiSourceCatalogError(
              'CATALOG_INGESTION_CURSOR_STALLED',
              '상품소스 Cursor가 진행되지 않아 수집을 중단했습니다.',
              { status: 502, details: { sourceId: normalizedSourceId, cursor: currentCursor } }
            );
          }
          currentCursor = nextCursor;
        }
      }
      const successful = counts.createdCount + counts.updatedCount + counts.unchangedCount;
      const state = counts.failedCount === 0
        ? 'completed'
        : successful > 0 ? 'completed_with_errors' : 'failed';
      return await this.persistence.completeIngestionRun(run.ingestionRunId, {
        state,
        sourceCursor: nextCursor,
        ...counts,
        details: { pages, failures, force: Boolean(force) }
      });
    } catch (error) {
      const normalized = asMultiSourceCatalogError(error, 'CATALOG_INGESTION_FAILED');
      await this.persistence.completeIngestionRun(run.ingestionRunId, {
        state: 'failed',
        sourceCursor: nextCursor,
        ...counts,
        failedCount: Math.max(1, counts.failedCount),
        details: { pages, failures, fatal: { code: normalized.code, message: normalized.message } }
      }).catch(() => {});
      throw normalized;
    }
  }
}
