import path from 'node:path';

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function localUrlBasename(value) {
  const text = String(value || '');
  if (!text.startsWith('local://')) return text;
  const raw = text.slice('local://'.length);
  try {
    return `local://catalog/${encodeURIComponent(path.basename(decodeURI(raw)))}`;
  } catch {
    return 'local://catalog/image';
  }
}

function sanitizeDetailContent(value) {
  return String(value || '').replace(/local:\/\/[^"'<>\s]+/g, match => localUrlBasename(match));
}

function redactServerPaths(value, roots = []) {
  let text = String(value || '');
  for (const root of roots.filter(Boolean)) {
    const variants = [String(root), String(root).replaceAll('\\', '/'), String(root).replaceAll('/', '\\')];
    for (const variant of variants) {
      if (variant) text = text.split(variant).join('<server-path>');
    }
  }
  return text;
}

function sanitizePayload(payload) {
  if (!payload) return payload;
  const cloned = structuredClone(payload);
  const origin = cloned.originProduct;
  if (origin?.images?.representativeImage?.url) {
    origin.images.representativeImage.url = localUrlBasename(origin.images.representativeImage.url);
  }
  for (const image of origin?.images?.optionalImages || []) {
    if (image?.url) image.url = localUrlBasename(image.url);
  }
  if (origin?.detailContent) origin.detailContent = sanitizeDetailContent(origin.detailContent);
  return cloned;
}

export function publicPreview(preview, { includePayload = false } = {}) {
  return {
    source: {
      productId: preview.source?.productId,
      name: preview.source?.name,
      categories: preview.source?.categories || [],
      soldOut: Boolean(preview.source?.soldOut),
      sourceUrl: preview.source?.sourceUrl || null
    },
    sellerManagementCode: preview.sellerManagementCode,
    categoryId: preview.categoryId,
    price: preview.price,
    options: preview.options,
    imagePlan: {
      representative: preview.imagePlan?.representative
        ? path.basename(preview.imagePlan.representative)
        : null,
      detailCount: Number(preview.imagePlan?.detailCount || 0),
      detail: (preview.imagePlan?.detail || []).map(item => path.basename(item))
    },
    ...(includePayload ? { payload: sanitizePayload(preview.payload) } : {}),
    validationErrors: preview.validationErrors || [],
    executable: Boolean(preview.executable)
  };
}

export function publicJob(row, { includeDetails = false, redactionRoots = [] } = {}) {
  if (!row) return null;
  return {
    sourceProductId: row.source_product_id,
    sellerManagementCode: row.seller_management_code,
    status: row.status,
    attempts: Number(row.attempts || 0),
    originProductNo: row.origin_product_no || null,
    channelProductNo: row.channel_product_no || null,
    lastError: row.last_error ? redactServerPaths(row.last_error, redactionRoots) : null,
    ...(includeDetails ? {
      payload: sanitizePayload(parseJson(row.payload_json)),
      result: parseJson(row.result_json)
    } : {}),
    updatedAt: row.updated_at
  };
}

export function publicOperation(row, { includeDetails = true, redactionRoots = [] } = {}) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    idempotencyKey: row.idempotency_key,
    operationType: row.operation_type,
    sourceProductId: row.source_product_id || null,
    status: row.status,
    ...(includeDetails ? {
      request: parseJson(row.request_json),
      result: parseJson(row.result_json),
      error: (() => {
        const error = parseJson(row.error_json);
        if (error?.message) error.message = redactServerPaths(error.message, redactionRoots);
        return error;
      })()
    } : {}),
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at
  };
}

export function publicCreateResult(result) {
  if (!result || typeof result !== 'object') return result;
  const sanitized = structuredClone(result);
  if (sanitized.preview) sanitized.preview = publicPreview(sanitized.preview, { includePayload: false });
  return sanitized;
}
