import crypto, { randomUUID } from 'node:crypto';
import { MultiSourceCatalogError } from './errors.js';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function asLimit(value, fallback = 50, max = 500) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function asOffset(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeSourceProduct(input, rawProduct = null) {
  if (!input || typeof input !== 'object') {
    throw new MultiSourceCatalogError('CATALOG_PERSISTENCE_INVALID_PRODUCT', '저장할 공급처 상품이 올바르지 않습니다.');
  }
  const sourceId = String(input.sourceId || '').trim().toLowerCase();
  const sourceProductId = String(input.sourceProductId || '').trim();
  const sourceProductName = String(input.sourceProductName || input.name || '').trim();
  if (!sourceId || !sourceProductId || !sourceProductName) {
    throw new MultiSourceCatalogError(
      'CATALOG_PERSISTENCE_PRODUCT_FIELDS_REQUIRED',
      'sourceId, sourceProductId, sourceProductName이 필요합니다.',
      { details: { sourceId, sourceProductId, sourceProductName } }
    );
  }
  const normalized = {
    sourceId,
    sourceProductId,
    supplierSku: input.supplierSku ? String(input.supplierSku) : null,
    sourceProductName,
    sourceCategoryPath: Array.isArray(input.sourceCategoryPath)
      ? input.sourceCategoryPath.map(String)
      : String(input.sourceCategoryPath || '').split('>').map(item => item.trim()).filter(Boolean),
    sourceUrl: input.sourceUrl ? String(input.sourceUrl) : null,
    sourceStatus: String(input.sourceStatus || 'active').toLowerCase(),
    supplyCost: input.supplyCost === null || input.supplyCost === undefined || input.supplyCost === ''
      ? null
      : Number(input.supplyCost),
    currency: String(input.currency || 'KRW').toUpperCase(),
    optionGroups: Array.isArray(input.optionGroups) ? clone(input.optionGroups) : [],
    assets: input.assets && typeof input.assets === 'object' ? clone(input.assets) : {},
    rawProduct: clone(rawProduct ?? input.rawProduct ?? input),
    sourceModifiedAt: input.sourceModifiedAt ? new Date(input.sourceModifiedAt).toISOString() : null,
    providerType: input.providerType ? String(input.providerType) : null
  };
  normalized.sourceHash = String(input.sourceHash || '').trim() || hashJson({
    sourceProductName: normalized.sourceProductName,
    supplierSku: normalized.supplierSku,
    sourceCategoryPath: normalized.sourceCategoryPath,
    sourceUrl: normalized.sourceUrl,
    sourceStatus: normalized.sourceStatus,
    supplyCost: normalized.supplyCost,
    currency: normalized.currency,
    optionGroups: normalized.optionGroups,
    assets: normalized.assets,
    rawProduct: normalized.rawProduct
  });
  return normalized;
}

function normalizeHaarProduct(input) {
  if (!input || typeof input !== 'object') {
    throw new MultiSourceCatalogError('HAAR_PRODUCT_INVALID', 'HAAR 상품 입력이 올바르지 않습니다.');
  }
  const productName = String(input.productName || input.name || '').trim();
  if (!productName) throw new MultiSourceCatalogError('HAAR_PRODUCT_NAME_REQUIRED', 'HAAR 상품명이 필요합니다.');
  return {
    haarProductId: input.haarProductId ? String(input.haarProductId) : randomUUID(),
    internalSku: input.internalSku ? String(input.internalSku).trim() : null,
    productName,
    brandName: String(input.brandName || 'HAAR').trim() || 'HAAR',
    productCategory: input.productCategory ? String(input.productCategory).trim() : null,
    productType: input.productType ? String(input.productType).trim() : null,
    status: String(input.status || 'draft').toLowerCase(),
    canonicalAttributes: input.canonicalAttributes && typeof input.canonicalAttributes === 'object'
      ? clone(input.canonicalAttributes)
      : {},
    canonicalContent: input.canonicalContent && typeof input.canonicalContent === 'object'
      ? clone(input.canonicalContent)
      : {}
  };
}

function publicIngestionRun(run) {
  return run ? clone(run) : null;
}

export class MemoryCatalogPersistence {
  constructor({ sources = [], channels = [] } = {}) {
    this.mode = 'memory';
    this.durable = false;
    this.sources = new Map();
    this.channels = new Map();
    this.products = new Map();
    this.ingestionRuns = new Map();
    this.haarProducts = new Map();
    this.sourceLinks = new Map();
    for (const source of sources) this.sources.set(source.sourceId, clone(source));
    for (const channel of channels) this.channels.set(channel.channelId, clone(channel));
  }

  async initialize({ sources = [], channels = [] } = {}) {
    for (const source of sources) await this.upsertCatalogSource(source);
    for (const channel of channels) await this.upsertSalesChannel(channel);
    return this.status();
  }

  async close() {}

  async status() {
    return {
      mode: this.mode,
      ready: true,
      durable: this.durable,
      sourceCount: this.sources.size,
      channelCount: this.channels.size,
      sourceProductCount: this.products.size,
      haarProductCount: this.haarProducts.size,
      ingestionRunCount: this.ingestionRuns.size
    };
  }

  async upsertCatalogSource(source) {
    this.sources.set(source.sourceId, clone(source));
    return clone(source);
  }

  async upsertSalesChannel(channel) {
    this.channels.set(channel.channelId, clone(channel));
    return clone(channel);
  }

  async startIngestionRun({ sourceId, mode = 'incremental', sourceCursor = null, details = {} }) {
    const run = {
      ingestionRunId: randomUUID(),
      sourceId: String(sourceId),
      mode,
      state: 'running',
      sourceCursor,
      discoveredCount: 0,
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      details: clone(details)
    };
    this.ingestionRuns.set(run.ingestionRunId, run);
    return publicIngestionRun(run);
  }

  async completeIngestionRun(ingestionRunId, patch = {}) {
    const run = this.ingestionRuns.get(String(ingestionRunId));
    if (!run) throw new MultiSourceCatalogError('CATALOG_INGESTION_RUN_NOT_FOUND', '수집 실행을 찾을 수 없습니다.', { status: 404 });
    Object.assign(run, {
      ...clone(patch),
      state: patch.state || 'completed',
      completedAt: patch.completedAt || new Date().toISOString()
    });
    return publicIngestionRun(run);
  }

  async getIngestionRun(ingestionRunId) {
    return publicIngestionRun(this.ingestionRuns.get(String(ingestionRunId)) || null);
  }

  async upsertSourceProduct(input, { rawProduct = null } = {}) {
    const product = normalizeSourceProduct(input, rawProduct);
    const key = `${product.sourceId}:${product.sourceProductId}`;
    const existing = this.products.get(key);
    const changeType = !existing ? 'created' : existing.sourceHash === product.sourceHash ? 'unchanged' : 'updated';
    const now = new Date().toISOString();
    const row = {
      ...product,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.products.set(key, row);
    return { changeType, product: clone(row) };
  }

  async getSourceProduct(sourceId, sourceProductId) {
    return clone(this.products.get(`${String(sourceId).toLowerCase()}:${String(sourceProductId)}`) || null);
  }

  async listSourceProducts({ sourceId, query, status, limit = 50, offset = 0 } = {}) {
    const normalizedSourceId = String(sourceId || '').trim().toLowerCase();
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('ko-KR');
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const items = [...this.products.values()].filter(product => {
      if (normalizedSourceId && product.sourceId !== normalizedSourceId) return false;
      if (normalizedStatus && product.sourceStatus !== normalizedStatus) return false;
      if (normalizedQuery) {
        const haystack = [product.sourceProductId, product.supplierSku, product.sourceProductName, ...(product.sourceCategoryPath || [])]
          .filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    }).sort((left, right) => left.sourceProductName.localeCompare(right.sourceProductName, 'ko'));
    const safeLimit = asLimit(limit);
    const safeOffset = asOffset(offset);
    return { total: items.length, limit: safeLimit, offset: safeOffset, items: clone(items.slice(safeOffset, safeOffset + safeLimit)) };
  }

  async createHaarProduct(input) {
    const product = normalizeHaarProduct(input);
    if (product.internalSku && [...this.haarProducts.values()].some(item => item.internalSku === product.internalSku)) {
      throw new MultiSourceCatalogError('HAAR_PRODUCT_SKU_CONFLICT', `이미 사용 중인 internalSku입니다: ${product.internalSku}`, { status: 409 });
    }
    const now = new Date().toISOString();
    const row = { ...product, createdAt: now, updatedAt: now };
    this.haarProducts.set(row.haarProductId, row);
    return clone(row);
  }

  async getHaarProduct(haarProductId) {
    return clone(this.haarProducts.get(String(haarProductId)) || null);
  }

  async listHaarProducts({ query, status, limit = 50, offset = 0 } = {}) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('ko-KR');
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const items = [...this.haarProducts.values()].filter(product => {
      if (normalizedStatus && product.status !== normalizedStatus) return false;
      if (normalizedQuery) {
        const haystack = [product.haarProductId, product.internalSku, product.productName, product.brandName, product.productCategory, product.productType]
          .filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const safeLimit = asLimit(limit);
    const safeOffset = asOffset(offset);
    return { total: items.length, limit: safeLimit, offset: safeOffset, items: clone(items.slice(safeOffset, safeOffset + safeLimit)) };
  }

  async linkSourceProduct({
    haarProductId,
    sourceId,
    sourceProductId,
    relationType = 'supplier_listing',
    priority = 100,
    isPrimary = false,
    verifiedBy = null,
    metadata = {}
  }) {
    const product = this.haarProducts.get(String(haarProductId));
    if (!product) throw new MultiSourceCatalogError('HAAR_PRODUCT_NOT_FOUND', 'HAAR 상품을 찾을 수 없습니다.', { status: 404 });
    const sourceProduct = await this.getSourceProduct(sourceId, sourceProductId);
    if (!sourceProduct) throw new MultiSourceCatalogError('SOURCE_PRODUCT_NOT_PERSISTED', '연결할 공급처 상품이 저장되어 있지 않습니다.', { status: 404 });
    if (isPrimary) {
      for (const link of this.sourceLinks.values()) {
        if (link.haarProductId === String(haarProductId) && link.isPrimary && !link.validTo) link.isPrimary = false;
      }
    }
    const key = `${haarProductId}:${String(sourceId).toLowerCase()}:${sourceProductId}`;
    const existing = this.sourceLinks.get(key);
    const row = {
      haarProductId: String(haarProductId),
      sourceId: String(sourceId).toLowerCase(),
      sourceProductId: String(sourceProductId),
      relationType,
      priority: Number(priority || 100),
      isPrimary: Boolean(isPrimary),
      validFrom: existing?.validFrom || new Date().toISOString(),
      validTo: null,
      verifiedAt: verifiedBy ? new Date().toISOString() : existing?.verifiedAt || null,
      verifiedBy: verifiedBy ? String(verifiedBy) : existing?.verifiedBy || null,
      metadata: clone(metadata),
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    this.sourceLinks.set(key, row);
    return clone(row);
  }

  async listSourceLinks(haarProductId) {
    return clone([...this.sourceLinks.values()].filter(link => link.haarProductId === String(haarProductId)));
  }
}

function mapSourceProductRow(row) {
  if (!row) return null;
  return {
    sourceId: row.source_id,
    sourceProductId: row.source_product_id,
    supplierSku: row.supplier_sku,
    sourceProductName: row.source_product_name,
    sourceCategoryPath: row.source_category_path ? String(row.source_category_path).split(' > ').filter(Boolean) : [],
    sourceUrl: row.source_url,
    sourceStatus: row.source_status,
    supplyCost: row.supply_cost === null ? null : Number(row.supply_cost),
    currency: row.currency,
    optionGroups: row.option_summary_json || [],
    assets: row.asset_manifest_json || {},
    rawProduct: row.raw_product_json || {},
    sourceHash: row.source_hash,
    sourceModifiedAt: row.source_modified_at ? new Date(row.source_modified_at).toISOString() : null,
    firstSeenAt: row.first_seen_at ? new Date(row.first_seen_at).toISOString() : null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function mapHaarProductRow(row) {
  if (!row) return null;
  return {
    haarProductId: row.haar_product_id,
    internalSku: row.internal_sku,
    productName: row.product_name,
    brandName: row.brand_name,
    productCategory: row.product_category,
    productType: row.product_type,
    status: row.status,
    canonicalAttributes: row.canonical_attributes_json || {},
    canonicalContent: row.canonical_content_json || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export class PostgresCatalogPersistence {
  constructor({ connectionString, ssl = false, pool = null, logger = console } = {}) {
    if (!pool && !String(connectionString || '').trim()) {
      throw new MultiSourceCatalogError('CATALOG_DATABASE_URL_REQUIRED', 'PostgreSQL persistence에는 DATABASE_URL이 필요합니다.');
    }
    this.mode = 'postgres';
    this.durable = true;
    this.connectionString = connectionString;
    this.ssl = ssl;
    this.pool = pool;
    this.ownsPool = !pool;
    this.logger = logger;
    this.ready = false;
  }

  async initialize({ sources = [], channels = [] } = {}) {
    if (!this.pool) {
      let Pool;
      try {
        ({ Pool } = await import('pg'));
      } catch (error) {
        throw new MultiSourceCatalogError('CATALOG_PG_MODULE_MISSING', 'PostgreSQL 사용을 위해 pg 패키지가 필요합니다.', {
          status: 500,
          cause: error
        });
      }
      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: this.ssl || undefined,
        max: 8,
        allowExitOnIdle: true
      });
    }
    const requiredTables = ['catalog_sources', 'source_products', 'catalog_ingestion_runs', 'haar_products', 'haar_product_source_links', 'sales_channels'];
    const result = await this.pool.query(
      "SELECT relname FROM pg_class WHERE relname = ANY($1::text[]) AND relkind IN ('r', 'p')",
      [requiredTables]
    );
    const present = new Set(result.rows.map(row => row.relname));
    const missing = requiredTables.filter(table => !present.has(table));
    if (missing.length) {
      throw new MultiSourceCatalogError(
        'CATALOG_DATABASE_MIGRATIONS_REQUIRED',
        `카탈로그 PostgreSQL Migration이 필요합니다: ${missing.join(', ')}`,
        { status: 503, details: { missingTables: missing } }
      );
    }
    for (const source of sources) await this.upsertCatalogSource(source);
    for (const channel of channels) await this.upsertSalesChannel(channel);
    this.ready = true;
    return this.status();
  }

  async close() {
    if (this.ownsPool && this.pool) await this.pool.end();
    this.ready = false;
  }

  async status() {
    if (!this.pool) return { mode: this.mode, ready: false, durable: true };
    const result = await this.pool.query(`
      SELECT
        (SELECT count(*)::int FROM catalog_sources) AS source_count,
        (SELECT count(*)::int FROM sales_channels) AS channel_count,
        (SELECT count(*)::int FROM source_products) AS source_product_count,
        (SELECT count(*)::int FROM haar_products) AS haar_product_count,
        (SELECT count(*)::int FROM catalog_ingestion_runs) AS ingestion_run_count
    `);
    const row = result.rows[0];
    return {
      mode: this.mode,
      ready: this.ready,
      durable: this.durable,
      sourceCount: row.source_count,
      channelCount: row.channel_count,
      sourceProductCount: row.source_product_count,
      haarProductCount: row.haar_product_count,
      ingestionRunCount: row.ingestion_run_count
    };
  }

  async upsertCatalogSource(source) {
    const result = await this.pool.query(`
      INSERT INTO catalog_sources (
        source_id, source_name, source_type, provider_type, root_reference, credential_ref,
        default_currency, status, metadata_json, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
      ON CONFLICT (source_id) DO UPDATE SET
        source_name = EXCLUDED.source_name,
        source_type = EXCLUDED.source_type,
        provider_type = EXCLUDED.provider_type,
        root_reference = EXCLUDED.root_reference,
        credential_ref = EXCLUDED.credential_ref,
        default_currency = EXCLUDED.default_currency,
        status = EXCLUDED.status,
        metadata_json = EXCLUDED.metadata_json,
        updated_at = now()
      RETURNING *
    `, [
      source.sourceId, source.sourceName, source.sourceType, source.providerType, source.rootReference,
      source.credentialRef, source.defaultCurrency || 'KRW', source.status || 'active', JSON.stringify(source.metadata || {})
    ]);
    return result.rows[0];
  }

  async upsertSalesChannel(channel) {
    const legacyType = channel.channelRole === 'owned_store' ? 'owned_store' : channel.platformType;
    const result = await this.pool.query(`
      INSERT INTO sales_channels (
        channel_id, channel_type, channel_role, platform_type, external_store_id,
        primary_domain, account_reference, channel_name, status, metadata_json, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
      ON CONFLICT (channel_id) DO UPDATE SET
        channel_type = EXCLUDED.channel_type,
        channel_role = EXCLUDED.channel_role,
        platform_type = EXCLUDED.platform_type,
        external_store_id = EXCLUDED.external_store_id,
        primary_domain = EXCLUDED.primary_domain,
        account_reference = EXCLUDED.account_reference,
        channel_name = EXCLUDED.channel_name,
        status = EXCLUDED.status,
        metadata_json = EXCLUDED.metadata_json,
        updated_at = now()
      RETURNING *
    `, [
      channel.channelId, legacyType, channel.channelRole, channel.platformType, channel.externalStoreId,
      channel.primaryDomain, channel.accountReference, channel.channelName, channel.status || 'active',
      JSON.stringify(channel.metadata || {})
    ]);
    return result.rows[0];
  }

  async startIngestionRun({ sourceId, mode = 'incremental', sourceCursor = null, details = {} }) {
    const result = await this.pool.query(`
      INSERT INTO catalog_ingestion_runs (source_id, mode, state, source_cursor, started_at, details_json)
      VALUES ($1,$2,'running',$3,now(),$4::jsonb)
      RETURNING *
    `, [sourceId, mode, sourceCursor, JSON.stringify(details || {})]);
    return this.#mapRun(result.rows[0]);
  }

  async completeIngestionRun(ingestionRunId, patch = {}) {
    const result = await this.pool.query(`
      UPDATE catalog_ingestion_runs SET
        state = $2,
        source_cursor = COALESCE($3, source_cursor),
        discovered_count = $4,
        created_count = $5,
        updated_count = $6,
        unchanged_count = $7,
        failed_count = $8,
        completed_at = COALESCE($9::timestamptz, now()),
        details_json = $10::jsonb
      WHERE ingestion_run_id = $1::uuid
      RETURNING *
    `, [
      ingestionRunId, patch.state || 'completed', patch.sourceCursor ?? null,
      Number(patch.discoveredCount || 0), Number(patch.createdCount || 0), Number(patch.updatedCount || 0),
      Number(patch.unchangedCount || 0), Number(patch.failedCount || 0), patch.completedAt || null,
      JSON.stringify(patch.details || {})
    ]);
    if (!result.rows[0]) throw new MultiSourceCatalogError('CATALOG_INGESTION_RUN_NOT_FOUND', '수집 실행을 찾을 수 없습니다.', { status: 404 });
    return this.#mapRun(result.rows[0]);
  }

  async getIngestionRun(ingestionRunId) {
    const result = await this.pool.query('SELECT * FROM catalog_ingestion_runs WHERE ingestion_run_id = $1::uuid', [ingestionRunId]);
    return result.rows[0] ? this.#mapRun(result.rows[0]) : null;
  }

  #mapRun(row) {
    return {
      ingestionRunId: row.ingestion_run_id,
      sourceId: row.source_id,
      mode: row.mode,
      state: row.state,
      sourceCursor: row.source_cursor,
      discoveredCount: Number(row.discovered_count || 0),
      createdCount: Number(row.created_count || 0),
      updatedCount: Number(row.updated_count || 0),
      unchangedCount: Number(row.unchanged_count || 0),
      failedCount: Number(row.failed_count || 0),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      details: row.details_json || {}
    };
  }

  async upsertSourceProduct(input, { rawProduct = null } = {}) {
    const product = normalizeSourceProduct(input, rawProduct);
    const existing = await this.getSourceProduct(product.sourceId, product.sourceProductId);
    const changeType = !existing ? 'created' : existing.sourceHash === product.sourceHash ? 'unchanged' : 'updated';
    const result = await this.pool.query(`
      INSERT INTO source_products (
        source_id, source_product_id, supplier_sku, source_product_name, source_category_path,
        source_url, source_status, supply_cost, currency, option_summary_json, asset_manifest_json,
        raw_product_json, source_hash, source_modified_at, first_seen_at, last_seen_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::timestamptz,now(),now(),now())
      ON CONFLICT (source_id, source_product_id) DO UPDATE SET
        supplier_sku = EXCLUDED.supplier_sku,
        source_product_name = EXCLUDED.source_product_name,
        source_category_path = EXCLUDED.source_category_path,
        source_url = EXCLUDED.source_url,
        source_status = EXCLUDED.source_status,
        supply_cost = EXCLUDED.supply_cost,
        currency = EXCLUDED.currency,
        option_summary_json = EXCLUDED.option_summary_json,
        asset_manifest_json = EXCLUDED.asset_manifest_json,
        raw_product_json = EXCLUDED.raw_product_json,
        source_hash = EXCLUDED.source_hash,
        source_modified_at = EXCLUDED.source_modified_at,
        last_seen_at = now(),
        updated_at = CASE WHEN source_products.source_hash IS DISTINCT FROM EXCLUDED.source_hash THEN now() ELSE source_products.updated_at END
      RETURNING *
    `, [
      product.sourceId, product.sourceProductId, product.supplierSku, product.sourceProductName,
      product.sourceCategoryPath.join(' > '), product.sourceUrl, product.sourceStatus, product.supplyCost,
      product.currency, JSON.stringify(product.optionGroups), JSON.stringify(product.assets),
      JSON.stringify(product.rawProduct), product.sourceHash, product.sourceModifiedAt
    ]);
    return { changeType, product: mapSourceProductRow(result.rows[0]) };
  }

  async getSourceProduct(sourceId, sourceProductId) {
    const result = await this.pool.query(
      'SELECT * FROM source_products WHERE source_id = $1 AND source_product_id = $2',
      [String(sourceId).toLowerCase(), String(sourceProductId)]
    );
    return mapSourceProductRow(result.rows[0]);
  }

  async listSourceProducts({ sourceId, query, status, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const values = [];
    const add = value => { values.push(value); return `$${values.length}`; };
    if (sourceId) conditions.push(`source_id = ${add(String(sourceId).toLowerCase())}`);
    if (status) conditions.push(`source_status = ${add(String(status).toLowerCase())}`);
    if (query) {
      const placeholder = add(`%${String(query)}%`);
      conditions.push(`(source_product_id ILIKE ${placeholder} OR supplier_sku ILIKE ${placeholder} OR source_product_name ILIKE ${placeholder} OR source_category_path ILIKE ${placeholder})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await this.pool.query(`SELECT count(*)::int AS total FROM source_products ${where}`, values);
    const safeLimit = asLimit(limit);
    const safeOffset = asOffset(offset);
    const dataValues = [...values, safeLimit, safeOffset];
    const result = await this.pool.query(
      `SELECT * FROM source_products ${where} ORDER BY source_product_name, source_product_id LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues
    );
    return { total: countResult.rows[0].total, limit: safeLimit, offset: safeOffset, items: result.rows.map(mapSourceProductRow) };
  }

  async createHaarProduct(input) {
    const product = normalizeHaarProduct(input);
    try {
      const result = await this.pool.query(`
        INSERT INTO haar_products (
          haar_product_id, internal_sku, product_name, brand_name, product_category,
          product_type, status, canonical_attributes_json, canonical_content_json
        ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
        RETURNING *
      `, [
        product.haarProductId, product.internalSku, product.productName, product.brandName,
        product.productCategory, product.productType, product.status,
        JSON.stringify(product.canonicalAttributes), JSON.stringify(product.canonicalContent)
      ]);
      return mapHaarProductRow(result.rows[0]);
    } catch (error) {
      if (error?.code === '23505') {
        throw new MultiSourceCatalogError('HAAR_PRODUCT_SKU_CONFLICT', 'HAAR internalSku 또는 상품 ID가 이미 존재합니다.', { status: 409 });
      }
      throw error;
    }
  }

  async getHaarProduct(haarProductId) {
    const result = await this.pool.query('SELECT * FROM haar_products WHERE haar_product_id = $1::uuid', [haarProductId]);
    return mapHaarProductRow(result.rows[0]);
  }

  async listHaarProducts({ query, status, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const values = [];
    const add = value => { values.push(value); return `$${values.length}`; };
    if (status) conditions.push(`status = ${add(String(status).toLowerCase())}`);
    if (query) {
      const placeholder = add(`%${String(query)}%`);
      conditions.push(`(haar_product_id::text ILIKE ${placeholder} OR internal_sku ILIKE ${placeholder} OR product_name ILIKE ${placeholder} OR brand_name ILIKE ${placeholder} OR product_category ILIKE ${placeholder})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await this.pool.query(`SELECT count(*)::int AS total FROM haar_products ${where}`, values);
    const safeLimit = asLimit(limit);
    const safeOffset = asOffset(offset);
    const dataValues = [...values, safeLimit, safeOffset];
    const result = await this.pool.query(
      `SELECT * FROM haar_products ${where} ORDER BY created_at DESC LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues
    );
    return { total: countResult.rows[0].total, limit: safeLimit, offset: safeOffset, items: result.rows.map(mapHaarProductRow) };
  }

  async linkSourceProduct({
    haarProductId,
    sourceId,
    sourceProductId,
    relationType = 'supplier_listing',
    priority = 100,
    isPrimary = false,
    verifiedBy = null,
    metadata = {}
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (isPrimary) {
        await client.query(
          'UPDATE haar_product_source_links SET is_primary = false WHERE haar_product_id = $1::uuid AND is_primary = true AND valid_to IS NULL',
          [haarProductId]
        );
      }
      const result = await client.query(`
        INSERT INTO haar_product_source_links (
          haar_product_id, source_id, source_product_id, relation_type, priority,
          is_primary, valid_from, verified_at, verified_by, metadata_json
        ) VALUES ($1::uuid,$2,$3,$4,$5,$6,now(),CASE WHEN $7::text IS NULL THEN NULL ELSE now() END,$7,$8::jsonb)
        ON CONFLICT (haar_product_id, source_id, source_product_id) DO UPDATE SET
          relation_type = EXCLUDED.relation_type,
          priority = EXCLUDED.priority,
          is_primary = EXCLUDED.is_primary,
          valid_to = NULL,
          verified_at = COALESCE(EXCLUDED.verified_at, haar_product_source_links.verified_at),
          verified_by = COALESCE(EXCLUDED.verified_by, haar_product_source_links.verified_by),
          metadata_json = EXCLUDED.metadata_json
        RETURNING *
      `, [
        haarProductId, String(sourceId).toLowerCase(), String(sourceProductId), relationType,
        Number(priority || 100), Boolean(isPrimary), verifiedBy ? String(verifiedBy) : null,
        JSON.stringify(metadata || {})
      ]);
      await client.query('COMMIT');
      const row = result.rows[0];
      return {
        haarProductId: row.haar_product_id,
        sourceId: row.source_id,
        sourceProductId: row.source_product_id,
        relationType: row.relation_type,
        priority: row.priority,
        isPrimary: row.is_primary,
        validFrom: row.valid_from ? new Date(row.valid_from).toISOString() : null,
        validTo: row.valid_to ? new Date(row.valid_to).toISOString() : null,
        verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
        verifiedBy: row.verified_by,
        metadata: row.metadata_json || {},
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error?.code === '23503') {
        throw new MultiSourceCatalogError('HAAR_PRODUCT_OR_SOURCE_PRODUCT_NOT_FOUND', 'HAAR 상품 또는 공급처 상품을 찾을 수 없습니다.', { status: 404 });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listSourceLinks(haarProductId) {
    const result = await this.pool.query(
      'SELECT * FROM haar_product_source_links WHERE haar_product_id = $1::uuid ORDER BY is_primary DESC, priority, created_at',
      [haarProductId]
    );
    return result.rows.map(row => ({
      haarProductId: row.haar_product_id,
      sourceId: row.source_id,
      sourceProductId: row.source_product_id,
      relationType: row.relation_type,
      priority: row.priority,
      isPrimary: row.is_primary,
      validFrom: row.valid_from ? new Date(row.valid_from).toISOString() : null,
      validTo: row.valid_to ? new Date(row.valid_to).toISOString() : null,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      verifiedBy: row.verified_by,
      metadata: row.metadata_json || {},
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    }));
  }
}

export async function createCatalogPersistence(config, { logger = console, pool = null } = {}) {
  const mode = String(config.persistenceMode || 'memory').toLowerCase();
  if (mode === 'memory') {
    const persistence = new MemoryCatalogPersistence({ sources: config.sources, channels: config.channels });
    await persistence.initialize({ sources: config.sources, channels: config.channels });
    return persistence;
  }
  if (mode === 'postgres') {
    const persistence = new PostgresCatalogPersistence({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl,
      pool,
      logger
    });
    await persistence.initialize({ sources: config.sources, channels: config.channels });
    return persistence;
  }
  throw new MultiSourceCatalogError('CATALOG_PERSISTENCE_MODE_UNSUPPORTED', `지원하지 않는 persistence mode입니다: ${mode}`);
}

export const _internal = {
  canonicalize,
  hashJson,
  normalizeSourceProduct,
  normalizeHaarProduct,
  mapSourceProductRow,
  mapHaarProductRow
};
