import fs from 'node:fs';
import path from 'node:path';

export const NAVER_COMMERCE_LLMS_URL = 'https://apicenter.commerce.naver.com/llms/llms.txt';
export const DEFAULT_COMMERCE_MANIFEST_PATH = path.resolve('specs/naver-commerce/current.json');

const DOMAIN_API_GROUP = Object.freeze({
  N배송: 'LOGISTICS',
  문의: 'INQUIRY',
  상품: 'PRODUCT',
  인증: 'AUTH',
  정산: 'SETTLEMENT',
  주문: 'ORDER',
  커머스솔루션: 'COMMERCE_SOLUTION',
  판매자정보: 'SELLER',
  API데이터솔루션: 'DATA_SOLUTION'
});

const READ_POST_PATHS = new Set([
  '/v1/logistics/products/sellers/me/skus/query-paged-list',
  '/v1/products/search',
  '/v1/pay-order/seller/product-orders/query'
]);

function camelToSnake(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function slugSegment(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

export function commerceOperationId(method, apiPath) {
  const segments = String(apiPath).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(segment => {
    if (/^\{[^}]+\}$/.test(segment)) return `by_${camelToSnake(segment.slice(1, -1))}`;
    return slugSegment(segment);
  });
  return `${String(method).toLowerCase()}_${segments.join('_')}`;
}

export function officialDocUrl(method, apiPath) {
  const slug = `${String(method).toLowerCase()}-${String(apiPath)
    .replace(/^\/+|\/+$/g, '')
    .replaceAll('/', '-')
    .replaceAll('{', '')
    .replaceAll('}', '')}`;
  return `https://apicenter.commerce.naver.com/llms/${slug}.md`;
}

export function inferCommerceOperationMetadata({ domain, method, path: apiPath }) {
  const upperMethod = String(method).toUpperCase();
  const internal = domain === '인증' || apiPath === '/v1/oauth2/token';
  const readOnly = upperMethod === 'GET' || upperMethod === 'HEAD' || READ_POST_PATHS.has(apiPath) || internal;
  const sideEffect = !readOnly;
  const destructive = upperMethod === 'DELETE';
  const transport = internal ? 'form' : (apiPath === '/v1/product-images/upload' ? 'multipart' : 'json');
  const asynchronous = apiPath.startsWith('/v2/standard-group-products')
    && ['POST', 'PUT'].includes(upperMethod)
    && !apiPath.endsWith('/validate-conversion')
    && !apiPath.endsWith('/temp-detail-content');

  let risk = 'read';
  let confirmation = null;
  let gate = 'reads';
  if (internal) {
    risk = 'internal';
    gate = 'auth';
  } else if (destructive) {
    risk = 'destructive';
    confirmation = 'DELETE_COMMERCE_RESOURCE';
    gate = 'deletes';
  } else if (sideEffect && domain === '주문' && apiPath.includes('/claim/')) {
    risk = 'claim';
    confirmation = 'PROCESS_COMMERCE_CLAIM';
    gate = 'claims';
  } else if (sideEffect && domain === '주문') {
    risk = 'order';
    confirmation = 'PROCESS_COMMERCE_ORDER';
    gate = 'orders';
  } else if (sideEffect && domain === '문의') {
    risk = 'inquiry';
    confirmation = 'SEND_COMMERCE_RESPONSE';
    gate = 'inquiries';
  } else if (sideEffect && domain === '커머스솔루션') {
    risk = 'financial';
    confirmation = 'EXECUTE_COMMERCE_SOLUTION';
    gate = 'solutions';
  } else if (sideEffect && domain === '판매자정보') {
    risk = 'seller';
    confirmation = 'UPDATE_COMMERCE_SELLER';
    gate = 'seller';
  } else if (sideEffect) {
    risk = 'write';
    confirmation = 'EXECUTE_COMMERCE_WRITE';
    gate = 'writes';
  }

  return { internal, readOnly, sideEffect, destructive, transport, asynchronous, risk, confirmation, gate };
}

export function parseCommerceLlmsIndex(text, { commerceApiVersion = 'current', generatedAt = new Date().toISOString() } = {}) {
  const operations = [];
  let domain = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      domain = heading[1].trim();
      continue;
    }
    const match = /^- \[([A-Z]+)\s+([^\s]+)\s+-\s+([^\]]+)\]\((https:\/\/apicenter\.commerce\.naver\.com\/llms\/[^)]+\.md)\):/.exec(line);
    if (!match) continue;
    const [, method, apiPath, title, docUrl] = match;
    if (!apiPath.startsWith('/')) continue;
    const metadata = inferCommerceOperationMetadata({ domain, method, path: apiPath });
    operations.push({
      index: operations.length + 1,
      operationId: commerceOperationId(method, apiPath),
      domain,
      apiGroup: DOMAIN_API_GROUP[domain] || 'UNKNOWN',
      method,
      path: apiPath,
      title: title.trim(),
      docUrl,
      pathParams: [...apiPath.matchAll(/\{([^}]+)\}/g)].map(item => item[1]),
      ...metadata,
      official: true,
      status: 'implemented_unverified'
    });
  }
  const ids = new Set(operations.map(item => item.operationId));
  if (ids.size !== operations.length) throw new Error('공식 커머스API 인덱스에 중복 operationId가 있습니다.');
  return {
    schemaVersion: 1,
    commerceApiVersion,
    sourceUrl: NAVER_COMMERCE_LLMS_URL,
    generatedAt,
    totalOperations: operations.length,
    domains: Object.fromEntries([...new Set(operations.map(item => item.domain))].map(item => [
      item,
      operations.filter(operation => operation.domain === item).length
    ])),
    specPendingDomains: operations.some(item => item.domain === 'API데이터솔루션') ? [] : ['API데이터솔루션'],
    operations
  };
}

export function validateCommerceManifest(manifest, { expectedTotal } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('커머스API manifest가 객체가 아닙니다.');
  if (!Array.isArray(manifest.operations)) throw new Error('커머스API manifest.operations가 배열이 아닙니다.');
  if (expectedTotal !== undefined && manifest.operations.length !== expectedTotal) {
    throw new Error(`커머스API operation 수 불일치: expected=${expectedTotal}, actual=${manifest.operations.length}`);
  }
  const ids = new Set();
  for (const operation of manifest.operations) {
    if (!operation.operationId || !operation.method || !operation.path) {
      throw new Error('커머스API operation 필수 필드가 누락됐습니다.');
    }
    if (ids.has(operation.operationId)) throw new Error(`중복 operationId: ${operation.operationId}`);
    ids.add(operation.operationId);
  }
  if (Number(manifest.totalOperations) !== manifest.operations.length) {
    throw new Error('manifest.totalOperations와 operations 길이가 다릅니다.');
  }
  return manifest;
}

export function loadCommerceManifest(filePath = DEFAULT_COMMERCE_MANIFEST_PATH) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`네이버 커머스API manifest를 찾을 수 없습니다: ${resolved}`);
  return validateCommerceManifest(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

export function writeCommerceManifest(manifest, filePath = DEFAULT_COMMERCE_MANIFEST_PATH) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(validateCommerceManifest(manifest), null, 2)}\n`, 'utf8');
  return resolved;
}
