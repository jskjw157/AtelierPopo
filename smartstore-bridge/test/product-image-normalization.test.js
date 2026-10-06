import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeProductImages } from '../src/naver/images.js';

// Decode the JPEG dimensions without using the encoder under test.
function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  for (let offset = 2; offset < bytes.length;) {
    assert.equal(bytes[offset++], 0xff);
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  assert.fail('Expected a JPEG image with dimensions');
}

test('product registration can normalize representative and detail images using installed production dependencies', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-product-images-'));
  try {
    const source = path.join(directory, 'source.svg');
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>';
    await fs.writeFile(source, input);
    const normalized = await normalizeProductImages('regression-product', {
      representative: { path: source }, detail: [{ path: source }]
    }, { representativeSize: 100, detailImageWidth: 8 }, directory);
    const representative = await fs.readFile(normalized.representative.path);
    assert.deepEqual(jpegDimensions(representative), { width: 100, height: 100 });
    assert.equal(normalized.representative.size, representative.length);
    assert.equal(normalized.detail.length, 1);
    const detail = await fs.readFile(normalized.detail[0].path);
    assert.deepEqual(jpegDimensions(detail), { width: 8, height: 4 });
    assert.equal(normalized.detail[0].size, detail.length);
    assert.ok(detail.length <= 9_500_000);
    assert.equal(await fs.readFile(source, 'utf8'), input);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
