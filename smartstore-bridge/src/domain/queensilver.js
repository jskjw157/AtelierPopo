import fs from 'node:fs';
import path from 'node:path';

export function parseWon(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const match = String(value ?? '').replaceAll(',', '').match(/-?\d+/);
  if (!match) throw new Error(`금액을 해석할 수 없습니다: ${value}`);
  return Number.parseInt(match[0], 10);
}

export function numericImageIndex(fileName) {
  const match = path.basename(fileName).match(/^(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

export function sortDownloadedImages(files) {
  return [...files].sort((a, b) => {
    const indexDiff = numericImageIndex(a) - numericImageIndex(b);
    return indexDiff || a.localeCompare(b, 'ko');
  });
}

export function normalizeSourceFolder(localFolder) {
  return String(localFolder || '').split(/[\\/]+/).filter(Boolean);
}

export function resolveProductJson(inputPath) {
  const absolute = path.resolve(inputPath);
  const stat = fs.statSync(absolute);
  return stat.isDirectory() ? path.join(absolute, 'product_info.json') : absolute;
}

export function validateSourceProduct(product) {
  const errors = [];
  if (!product || typeof product !== 'object') errors.push('JSON 루트가 객체가 아닙니다.');
  if (!String(product?.product_id || '').trim()) errors.push('product_id가 없습니다.');
  if (!String(product?.name || '').trim()) errors.push('name이 없습니다.');
  if (!Array.isArray(product?.categories) || product.categories.length === 0) errors.push('categories가 없습니다.');
  try { parseWon(product?.sale_price_display); } catch (error) { errors.push(error.message); }
  if (!Array.isArray(product?.downloaded_images) || product.downloaded_images.length === 0) {
    errors.push('downloaded_images가 없습니다.');
  }
  if (Array.isArray(product?.options) && product.options.length > 3) {
    errors.push('네이버 조합형 옵션은 일반 상품 기준 최대 3개 옵션 그룹까지만 지원하도록 이 프로그램이 제한합니다.');
  }
  return errors;
}

export function loadProductInfo(inputPath) {
  const productJsonPath = resolveProductJson(inputPath);
  const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
  const errors = validateSourceProduct(product);
  return {
    product,
    productJsonPath,
    productDir: path.dirname(productJsonPath),
    errors
  };
}

export function resolveImagePlan(product, productDir, imageConfig = {}) {
  const imagesDir = path.join(productDir, 'images');
  const files = sortDownloadedImages(product.downloaded_images || [])
    .map(fileName => ({
      fileName,
      index: numericImageIndex(fileName),
      path: path.join(imagesDir, fileName)
    }))
    .filter(item => fs.existsSync(item.path));

  const representativeIndex = Number(imageConfig.representativeIndex ?? 1);
  const representative = files.find(item => item.index === representativeIndex) || files[0];
  const excluded = new Set((imageConfig.excludeDetailIndices || []).map(Number));
  const detail = files.filter(item => !excluded.has(item.index));

  return {
    imagesDir,
    representative,
    detail,
    missing: sortDownloadedImages(product.downloaded_images || [])
      .map(fileName => path.join(imagesDir, fileName))
      .filter(filePath => !fs.existsSync(filePath))
  };
}

export function loadCatalogManifest(catalogRoot) {
  const filePath = path.join(path.resolve(catalogRoot), 'catalog_manifest.json');
  if (!fs.existsSync(filePath)) throw new Error(`catalog_manifest.json을 찾을 수 없습니다: ${filePath}`);
  return { manifest: JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath };
}

export function productPathFromManifest(catalogRoot, productEntry) {
  const parts = normalizeSourceFolder(productEntry.local_folder);
  return path.join(path.resolve(catalogRoot), ...parts, 'product_info.json');
}

export function listProductJsonFiles(catalogRoot) {
  const { manifest } = loadCatalogManifest(catalogRoot);
  const entries = Object.values(manifest.products || {});
  return entries
    .filter(item => item.completed !== false)
    .map(item => productPathFromManifest(catalogRoot, item));
}

export function catalogStats(catalogRoot) {
  const { manifest } = loadCatalogManifest(catalogRoot);
  const entries = Object.values(manifest.products || {});
  const byCategory = {};
  for (const product of entries) {
    for (const category of product.categories || ['미분류']) {
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
  }
  return {
    source: manifest.source,
    totalProducts: manifest.total_products ?? entries.length,
    totalCompleted: manifest.total_completed ?? entries.filter(item => item.completed).length,
    byCategory
  };
}
