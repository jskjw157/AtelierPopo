import path from 'node:path';

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function loadCommerceGatewayConfig(env = process.env) {
  const manifestPath = path.resolve(env.NAVER_COMMERCE_MANIFEST_PATH || './specs/naver-commerce/current.json');
  return {
    enabled: asBoolean(env.ATELIER_COMMERCE_GATEWAY_ENABLED, true),
    manifestPath,
    allowReads: asBoolean(env.ATELIER_COMMERCE_ALLOW_READS, true),
    allowWrites: asBoolean(env.ATELIER_COMMERCE_ALLOW_WRITES, false),
    allowDeletes: asBoolean(env.ATELIER_COMMERCE_ALLOW_DELETES, false),
    allowOrders: asBoolean(env.ATELIER_COMMERCE_ALLOW_ORDERS, false),
    allowClaims: asBoolean(env.ATELIER_COMMERCE_ALLOW_CLAIMS, false),
    allowInquiries: asBoolean(env.ATELIER_COMMERCE_ALLOW_INQUIRIES, false),
    allowSolutions: asBoolean(env.ATELIER_COMMERCE_ALLOW_SOLUTIONS, false),
    allowSellerWrites: asBoolean(env.ATELIER_COMMERCE_ALLOW_SELLER_WRITES, false),
    allowMultipartUploads: asBoolean(env.ATELIER_COMMERCE_ALLOW_MULTIPART_UPLOADS, false),
    allowUnverifiedOperations: asBoolean(env.ATELIER_COMMERCE_ALLOW_UNVERIFIED_OPERATIONS, false),
    exposePersonalData: asBoolean(env.ATELIER_COMMERCE_EXPOSE_PERSONAL_DATA, false),
    maxJsonBodyBytes: asInteger(env.ATELIER_COMMERCE_MAX_JSON_BODY_BYTES, 16 * 1024 * 1024, {
      min: 64 * 1024,
      max: 64 * 1024 * 1024
    }),
    maxInlineUploadBytes: asInteger(env.ATELIER_COMMERCE_MAX_INLINE_UPLOAD_BYTES, 10 * 1024 * 1024, {
      min: 1024,
      max: 20 * 1024 * 1024
    }),
    maxUploadFiles: asInteger(env.ATELIER_COMMERCE_MAX_UPLOAD_FILES, 10, { min: 1, max: 20 }),
    backupDir: path.resolve(env.ATELIER_COMMERCE_BACKUP_DIR || './work/commerce-backups'),
    specAutoSync: asBoolean(env.NAVER_COMMERCE_SPEC_AUTO_SYNC, false),
    llmsUrl: env.NAVER_COMMERCE_LLMS_URL || 'https://apicenter.commerce.naver.com/llms/llms.txt'
  };
}

export function publicCommerceGatewayConfig(config, manifest) {
  return {
    enabled: Boolean(config.enabled),
    manifestPath: config.manifestPath,
    operationCount: manifest?.operations?.length || 0,
    commerceApiVersion: manifest?.commerceApiVersion || null,
    sourceUrl: manifest?.sourceUrl || null,
    gates: {
      reads: Boolean(config.allowReads),
      writes: Boolean(config.allowWrites),
      deletes: Boolean(config.allowDeletes),
      orders: Boolean(config.allowOrders),
      claims: Boolean(config.allowClaims),
      inquiries: Boolean(config.allowInquiries),
      solutions: Boolean(config.allowSolutions),
      seller: Boolean(config.allowSellerWrites),
      multipart: Boolean(config.allowMultipartUploads)
    },
    allowUnverifiedOperations: Boolean(config.allowUnverifiedOperations),
    exposePersonalData: Boolean(config.exposePersonalData)
  };
}
