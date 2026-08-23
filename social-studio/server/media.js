import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import multer from 'multer';
import sharp from 'sharp';
import { fileTypeFromFile } from 'file-type';
import { config } from './config.js';
import { query, audit } from './db.js';
import { AppError } from './http.js';
import { signMedia, verifyMediaSignature } from './security.js';

const tempDir = path.join(config.uploadDir, '.tmp');
await fsp.mkdir(tempDir, { recursive: true });
await fsp.mkdir(config.uploadDir, { recursive: true });

export const upload = multer({
  dest: tempDir,
  limits: { fileSize: config.maxUploadBytes, files: 1 }
});

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime'
]);

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function probeVideo(filePath) {
  return new Promise((resolve) => {
    const child = spawn(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.on('close', () => {
      try {
        const data = JSON.parse(output);
        const video = (data.streams || []).find((stream) => stream.codec_type === 'video') || {};
        resolve({
          width: video.width || null,
          height: video.height || null,
          duration: Number(data.format?.duration || video.duration || 0) || null
        });
      } catch {
        resolve({});
      }
    });
    child.on('error', () => resolve({}));
  });
}

export async function saveUploadedAsset(file, userId, altText = '') {
  if (!file) throw new AppError(400, 'FILE_REQUIRED', '업로드할 이미지 또는 영상을 선택해 주세요.');
  let finalPath = null;
  try {
    const detected = await fileTypeFromFile(file.path);
    const mimeType = detected?.mime || file.mimetype;
    if (!allowedMimeTypes.has(mimeType)) {
      throw new AppError(400, 'UNSUPPORTED_MEDIA', 'JPEG, PNG, WebP, MP4, MOV 파일만 업로드할 수 있습니다.');
    }

    const id = randomUUID();
    let mediaType;
    let width = null;
    let height = null;
    let duration = null;
    let finalName;

    if (mimeType.startsWith('image/')) {
      mediaType = 'image';
      finalName = `${id}.jpg`;
      finalPath = path.join(config.uploadDir, finalName);
      const image = sharp(file.path).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 94, mozjpeg: true });
      const info = await image.toFile(finalPath);
      width = info.width;
      height = info.height;
    } else {
      mediaType = 'video';
      const extension = mimeType === 'video/quicktime' ? '.mov' : '.mp4';
      finalName = `${id}${extension}`;
      finalPath = path.join(config.uploadDir, finalName);
      await fsp.rename(file.path, finalPath);
      const metadata = await probeVideo(finalPath);
      width = metadata.width || null;
      height = metadata.height || null;
      duration = metadata.duration || null;
    }

    const checksum = await sha256File(finalPath);
    const existing = await query('SELECT * FROM media_assets WHERE checksum = $1', [checksum]);
    if (existing.rowCount) {
      await fsp.rm(finalPath, { force: true });
      throw new AppError(409, 'DUPLICATE_MEDIA', '같은 파일이 이미 미디어 라이브러리에 있습니다.', {
        existingAssetId: existing.rows[0].id
      });
    }

    const stat = await fsp.stat(finalPath);
    const storedMime = mediaType === 'image' ? 'image/jpeg' : mimeType;
    const result = await query(
      `INSERT INTO media_assets
        (id, file_name, original_name, mime_type, media_type, bytes, width, height, duration_seconds,
         checksum, alt_text, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ready', $12)
       RETURNING *`,
      [
        id,
        finalName,
        file.originalname,
        storedMime,
        mediaType,
        stat.size,
        width,
        height,
        duration,
        checksum,
        String(altText || '').trim() || null,
        userId
      ]
    );
    await audit(userId, 'media.created', 'media_asset', id, { mediaType, bytes: stat.size });
    return result.rows[0];
  } finally {
    await fsp.rm(file.path, { force: true }).catch(() => {});
  }
}

export async function listMediaAssets() {
  const result = await query(
    `SELECT id, original_name, mime_type, media_type, bytes, width, height, duration_seconds,
            checksum, alt_text, status, created_at
     FROM media_assets ORDER BY created_at DESC LIMIT 500`
  );
  return result.rows;
}

export async function getMediaAsset(id) {
  const result = await query('SELECT * FROM media_assets WHERE id = $1 AND status = $2', [id, 'ready']);
  if (!result.rowCount) throw new AppError(404, 'MEDIA_NOT_FOUND', '미디어 파일을 찾지 못했습니다.');
  return result.rows[0];
}

export function createSignedMediaUrl(asset, ttlSeconds = null) {
  const ttl = ttlSeconds || (asset.media_type === 'video' ? 24 * 60 * 60 : 6 * 60 * 60);
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const signature = signMedia(asset.id, expiresAt);
  const url = new URL(`/public-media/${asset.id}`, config.appBaseUrl);
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

export async function serveSignedMedia(req, res) {
  const { id } = req.params;
  const expiresAt = req.query.exp;
  const signature = req.query.sig;
  if (!verifyMediaSignature(id, expiresAt, signature)) {
    throw new AppError(403, 'MEDIA_SIGNATURE_INVALID', '미디어 링크가 만료되었거나 유효하지 않습니다.');
  }
  const asset = await getMediaAsset(id);
  const filePath = path.join(config.uploadDir, asset.file_name);
  try {
    await fsp.access(filePath);
  } catch {
    throw new AppError(404, 'MEDIA_FILE_MISSING', '저장된 미디어 파일을 찾지 못했습니다.');
  }
  res.set({
    'Content-Type': asset.mime_type,
    'Content-Length': String(asset.bytes),
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(filePath).pipe(res);
}
