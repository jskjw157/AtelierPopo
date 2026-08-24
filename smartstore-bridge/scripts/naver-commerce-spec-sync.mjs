#!/usr/bin/env node
import { parseCommerceLlmsIndex, writeCommerceManifest, NAVER_COMMERCE_LLMS_URL } from '../src/naver/commerce/spec.js';

const sourceUrl = process.env.NAVER_COMMERCE_LLMS_URL || NAVER_COMMERCE_LLMS_URL;
const outputPath = process.env.NAVER_COMMERCE_MANIFEST_PATH || './specs/naver-commerce/current.json';
const expectedMinimum = Number(process.env.NAVER_COMMERCE_EXPECTED_MIN_OPERATIONS || 115);
const version = process.env.NAVER_COMMERCE_API_VERSION || 'current';

const response = await fetch(sourceUrl, {
  headers: { Accept: 'text/plain;charset=UTF-8', 'User-Agent': 'haar-smartstore-bridge-spec-sync/0.4.0' },
  signal: AbortSignal.timeout(30_000)
});
if (!response.ok) throw new Error(`공식 llms.txt 다운로드 실패: HTTP ${response.status}`);
const text = await response.text();
const manifest = parseCommerceLlmsIndex(text, { commerceApiVersion: version });
if (manifest.operations.length < expectedMinimum) {
  throw new Error(`공식 operation 수가 예상보다 적습니다: ${manifest.operations.length} < ${expectedMinimum}`);
}
const written = writeCommerceManifest(manifest, outputPath);
console.log(JSON.stringify({ ok: true, sourceUrl, written, totalOperations: manifest.totalOperations, domains: manifest.domains }, null, 2));
