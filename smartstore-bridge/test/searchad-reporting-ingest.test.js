import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { SearchAdReportIngestService } from '../src/naver/searchad/reporting/report-ingest-service.js';
import { fingerprintOrderedColumns } from '../src/naver/searchad/reporting/report-schema.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const operator = customerIds => ({ principal: { principalId: 'op-1', role: 'operator', customerIds } });

class FakeRepository {
  constructor({ intent, schemas = [] } = {}) {
    this.intent = structuredClone(intent);
    this.schemas = new Map(schemas.map(item => [item.schemaSha256, structuredClone(item)]));
    this.blobs = new Map();
    this.links = [];
    this.events = [];
    this.updates = [];
    this.calls = [];
  }
  async getReportIntent(id) { this.calls.push(['getReportIntent', id]); return id === this.intent?.reportIntentId ? structuredClone(this.intent) : null; }
  async putBlob(row) { this.calls.push(['putBlob', row.sha256]); this.blobs.set(row.sha256, structuredClone(row)); return { sha256: row.sha256, byteLength: row.byteLength, contentType: row.contentType }; }
  async getSchema(id) { this.calls.push(['getSchema', id]); return structuredClone(this.schemas.get(id) || null); }
  async putSchema(row) { this.calls.push(['putSchema', row.schemaSha256]); if (!this.schemas.has(row.schemaSha256)) this.schemas.set(row.schemaSha256, structuredClone(row)); return structuredClone(this.schemas.get(row.schemaSha256)); }
  async linkJobBlob(row) { this.calls.push(['linkJobBlob', row.blobSha256]); this.links.push(structuredClone(row)); return structuredClone(row); }
  async appendReportEvent(row) { this.calls.push(['appendReportEvent', row.status]); this.events.push(structuredClone(row)); return structuredClone(row); }
  async updateReportIntent(id, patch, customerId) { this.calls.push(['updateReportIntent', patch.status]); assert.equal(customerId, this.intent.customerId); Object.assign(this.intent, structuredClone(patch)); this.updates.push(structuredClone(patch)); return structuredClone(this.intent); }
}

function statIntent(overrides = {}) {
  return {
    reportIntentId: '11111111-1111-4111-8111-111111111111',
    customerId: '100',
    reportKind: 'stat',
    request: { reportTp: 'AD_DETAIL' },
    status: 'registered',
    returnedJobId: '123',
    persistedDownloadUrl: 'https://api.searchad.naver.com/report-download?reportJobId=123',
    ...overrides
  };
}

function serviceFixture({ intent = statIntent(), bytes = Buffer.from('campaignId,adgroupId,salesAmt\n1,2,0\n'), schemas = [] } = {}) {
  const repository = new FakeRepository({ intent, schemas });
  const downloads = [];
  const downloadAdapter = {
    async download(input) {
      downloads.push(structuredClone(input));
      return { bytes, byteLength: bytes.length, contentType: 'text/csv', requestId: 'dl-1' };
    }
  };
  const service = new SearchAdReportIngestService({
    repository,
    downloadAdapter,
    clock: () => Date.parse('2026-09-11T08:40:00.000Z')
  });
  return { service, repository, downloads, bytes };
}

test('ingest accepts only a reportIntentId scalar and rejects caller URL/bytes/schema overrides before download', async () => {
  const { service, downloads } = serviceFixture();
  for (const input of [
    { reportIntentId: statIntent().reportIntentId },
    { reportIntentId: statIntent().reportIntentId, downloadUrl: 'https://evil.example/x' },
    ['11111111-1111-4111-8111-111111111111']
  ]) {
    await assert.rejects(
      () => service.ingest(input, operator(['100'])),
      error => error?.code === 'SEARCHAD_REPORT_INGEST_INPUT_INVALID'
    );
  }
  assert.equal(downloads.length, 0);
});

test('ingest requires Operator and explicit Customer access before download and hides missing/cross-Customer intent', async () => {
  const { service, downloads } = serviceFixture();
  await assert.rejects(() => service.ingest(statIntent().reportIntentId, { principal: { principalId: 'r', role: 'reader', customerIds: ['100'] } }), error => error?.code === 'SEARCHAD_OPERATOR_REQUIRED');
  await assert.rejects(() => service.ingest(statIntent().reportIntentId, operator(['200'])), error => error?.code === 'SEARCHAD_REPORT_INTENT_NOT_FOUND' && error?.status === 404);
  await assert.rejects(() => service.ingest('22222222-2222-4222-8222-222222222222', operator(['100'])), error => error?.code === 'SEARCHAD_REPORT_INTENT_NOT_FOUND' && error?.status === 404);
  assert.equal(downloads.length, 0);
});

test('known exact schema hashes bytes before blob persistence, links server-owned job and emits sanitized ingest event', async () => {
  const columns = ['campaignId', 'adgroupId', 'salesAmt'];
  const schemaSha256 = fingerprintOrderedColumns(columns);
  const known = {
    schemaSha256,
    reportKind: 'stat',
    reportType: 'AD_DETAIL',
    orderedColumns: columns,
    semanticMapping: { salesAmt: 'spend_krw_vat_included' },
    state: 'known',
    quarantineReason: null
  };
  const { service, repository, downloads, bytes } = serviceFixture({ schemas: [known] });
  const result = await service.ingest(statIntent().reportIntentId, operator(['100']));

  assert.deepEqual(downloads, [{ customerId: '100', persistedDownloadUrl: statIntent().persistedDownloadUrl }]);
  const digest = sha(bytes);
  assert.equal(repository.blobs.has(digest), true);
  assert.equal(repository.links.length, 1);
  assert.equal(repository.links[0].returnedJobId, '123');
  assert.equal(repository.links[0].blobSha256, digest);
  assert.equal(repository.links[0].schemaSha256, schemaSha256);
  assert.equal(result.trusted, true);
  assert.equal(result.schemaState, 'known');
  assert.deepEqual(result.semanticMapping, known.semanticMapping);
  assert.equal(repository.updates.length, 0);
  assert.equal(repository.events.length, 1);
  assert.deepEqual(repository.events[0].details, {
    blobSha256: digest,
    byteLength: bytes.length,
    schemaSha256,
    schemaState: 'known'
  });
  assert.equal(JSON.stringify(repository.events[0]).includes('report-download'), false);
  assert.equal(JSON.stringify(repository.events[0]).includes('campaignId,adgroupId'), false);
});

test('unknown or reordered schema is persisted quarantined, marks intent manual_review and never returns trusted semantics', async () => {
  const { service, repository } = serviceFixture({
    bytes: Buffer.from('adgroupId,campaignId,salesAmt\n2,1,0\n')
  });
  const result = await service.ingest(statIntent().reportIntentId, operator(['100']));
  assert.equal(result.trusted, false);
  assert.equal(result.schemaState, 'quarantined');
  assert.deepEqual(result.semanticMapping, {});
  assert.equal(repository.schemas.size, 1);
  const persisted = [...repository.schemas.values()][0];
  assert.equal(persisted.state, 'quarantined');
  assert.equal(persisted.quarantineReason, 'unknown_schema');
  assert.equal(repository.intent.status, 'manual_review');
  assert.equal(repository.events[0].status, 'quarantined');
});

test('ingest rejects non-ready intent or missing server-owned returned id/download URL before download', async () => {
  for (const intent of [
    statIntent({ status: 'planned' }),
    statIntent({ returnedJobId: null }),
    statIntent({ persistedDownloadUrl: null })
  ]) {
    const { service, downloads } = serviceFixture({ intent });
    await assert.rejects(
      () => service.ingest(intent.reportIntentId, operator(['100'])),
      error => error?.code === 'SEARCHAD_REPORT_INGEST_NOT_READY'
    );
    assert.equal(downloads.length, 0);
  }
});

test('UTF-8 BOM and quoted CSV header fields are parsed deterministically without reading data rows as schema', async () => {
  const columns = ['campaignId', 'label,with,comma', 'salesAmt'];
  const schemaSha256 = fingerprintOrderedColumns(columns);
  const known = { schemaSha256, reportKind: 'stat', reportType: 'AD_DETAIL', orderedColumns: columns, semanticMapping: { salesAmt: 'spend_krw_vat_included' }, state: 'known' };
  const bytes = Buffer.from('\uFEFFcampaignId,"label,with,comma",salesAmt\r\n1,"x,y",0\r\n', 'utf8');
  const { service } = serviceFixture({ bytes, schemas: [known] });
  const result = await service.ingest(statIntent().reportIntentId, operator(['100']));
  assert.equal(result.trusted, true);
  assert.equal(result.schemaSha256, schemaSha256);
});
