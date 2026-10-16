import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fail } from './policy.js';

export async function readChannelMedia(uploadDir, asset) {
  if (!asset.file_name || path.basename(asset.file_name) !== asset.file_name) throw fail('CHANNEL_MEDIA_INVALID', '저장된 미디어 경로가 올바르지 않습니다.');
  const root = await fs.realpath(uploadDir);
  const file = await fs.realpath(path.join(root, asset.file_name));
  if (path.dirname(file) !== root) throw fail('CHANNEL_MEDIA_INVALID', '미디어 경로를 확인해 주세요.');
  const bytes = await fs.readFile(file);
  if (bytes.length !== Number(asset.bytes) || createHash('sha256').update(bytes).digest('hex') !== asset.checksum) throw fail('CHANNEL_MEDIA_CHANGED', '미디어 파일이 변경되었습니다. 다시 검토해 주세요.');
  return bytes;
}
