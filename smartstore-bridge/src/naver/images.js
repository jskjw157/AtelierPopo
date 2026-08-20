import fs from 'node:fs';
import path from 'node:path';
import { openAsBlob } from 'node:fs';

async function getSharp() {
  const module = await import('sharp');
  return module.default;
}

async function encodeWithinLimit(sharp, inputPath, outputPath, width, initialQuality, maxBytes) {
  let quality = initialQuality;
  let targetWidth = width;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sharp(inputPath)
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toFile(outputPath);
    const size = fs.statSync(outputPath).size;
    if (size <= maxBytes) return { path: outputPath, size };
    quality = Math.max(55, quality - 8);
    if (attempt >= 3) targetWidth = Math.max(700, Math.floor(targetWidth * 0.88));
  }
  throw new Error(`이미지를 업로드 제한 이하로 압축하지 못했습니다: ${inputPath}`);
}

export async function normalizeProductImages(productId, imagePlan, config, workDir) {
  const sharp = await getSharp();
  const outputDir = path.join(workDir, 'normalized-images', String(productId));
  fs.mkdirSync(outputDir, { recursive: true });
  const quality = Number(config.jpegQuality ?? 88);
  const maxBytes = Math.max(1_000_000, Number(config.uploadBatchMaxBytes ?? 9_500_000));
  if (!imagePlan.representative) throw new Error('대표 이미지 파일이 없습니다.');

  const representativePath = path.join(outputDir, 'representative.jpg');
  await sharp(imagePlan.representative.path)
    .rotate()
    .resize(Number(config.representativeSize ?? 1000), Number(config.representativeSize ?? 1000), {
      fit: 'contain',
      background: '#ffffff'
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toFile(representativePath);

  const detail = [];
  for (const [index, source] of imagePlan.detail.entries()) {
    const outputPath = path.join(outputDir, `detail-${String(index + 1).padStart(3, '0')}.jpg`);
    detail.push(await encodeWithinLimit(
      sharp,
      source.path,
      outputPath,
      Number(config.detailImageWidth ?? 860),
      quality,
      maxBytes
    ));
  }
  return {
    outputDir,
    representative: { path: representativePath, size: fs.statSync(representativePath).size },
    detail
  };
}

function splitBatches(files, maxFiles, maxBytes) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    if (file.size > maxBytes) throw new Error(`단일 이미지가 업로드 배치 제한보다 큽니다: ${file.path}`);
    if (current.length && (current.length >= maxFiles || currentBytes + file.size > maxBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function uploadImages(client, files, imageConfig) {
  const batches = splitBatches(
    files,
    Number(imageConfig.uploadBatchMaxFiles ?? 10),
    Number(imageConfig.uploadBatchMaxBytes ?? 9_500_000)
  );
  const urls = [];
  for (const batch of batches) {
    const formData = new FormData();
    for (const file of batch) {
      const blob = await openAsBlob(file.path, { type: 'image/jpeg' });
      formData.append('imageFiles', blob, path.basename(file.path));
    }
    const response = await client.post('/v1/product-images/upload', { formData, retrySafe: false });
    const returned = (response.images || []).map(item => item.url).filter(Boolean);
    if (returned.length !== batch.length) {
      throw new Error(`이미지 업로드 응답 개수 불일치: 요청 ${batch.length}, 응답 ${returned.length}`);
    }
    urls.push(...returned);
  }
  return urls;
}

export async function prepareAndUploadProductImages(client, productId, imagePlan, config, workDir) {
  const normalized = await normalizeProductImages(productId, imagePlan, config.images || {}, workDir);
  try {
    const representativeUrls = await uploadImages(client, [normalized.representative], config.images || {});
    const detailUrls = await uploadImages(client, normalized.detail, config.images || {});
    return {
      representative: representativeUrls[0],
      optional: detailUrls.slice(1, 1 + Number(config.images?.maxOptionalImages ?? 9)),
      detail: detailUrls
    };
  } finally {
    if (config.images?.cleanupNormalizedAfterUpload !== false) {
      fs.rmSync(normalized.outputDir, { recursive: true, force: true });
    }
  }
}
