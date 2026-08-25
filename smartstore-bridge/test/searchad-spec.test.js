import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchAdManifest, gitBlobSha, normalizeSwaggerPath } from '../src/naver/searchad/spec-sync.js';
import { SearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';

const sourceManifest = {
  repository: 'naver/searchad-apidoc', ref: 'pinned',
  sources: [{ id: 'ncc', file: 'ncc.json', gitBlobSha: 'x', size: 1 }]
};
const corrections = {
  baseUrl: 'https://api.searchad.naver.com',
  initiallyQuarantinedTags: ['nccmanagedkeyword'], quarantinedTagPatterns: ['controller$'], deprecatedReports: {}
};
const swagger = {
  swagger: '2.0', info: { title: 'test' }, definitions: { Campaign: { type: 'object', properties: { id: { type: 'string' } } } },
  paths: {
    '/api/ncc/campaigns': {
      get: { tags: ['Campaign'], summary: 'list', operationId: 'listCampaigns', responses: { 200: { description: 'ok' } } },
      post: { tags: ['Campaign'], summary: 'create', operationId: 'createCampaign', parameters: [{ in: 'body', name: 'body', required: true, schema: { $ref: '#/definitions/Campaign' } }], responses: { 200: { description: 'ok' } } }
    },
    '/api/ncc/managed-keywords{?ids}': {
      get: { tags: ['NccManagedKeyword'], summary: 'list', operationId: 'listManaged', responses: { 200: { description: 'ok' } } }
    }
  }
};

test('SearchAd path normalization removes /api and expands query template', () => {
  assert.deepEqual(normalizeSwaggerPath('/api/ncc/campaigns{?selector,recordSize}'), {
    path: '/ncc/campaigns', templateQuery: ['selector','recordSize']
  });
});

test('SearchAd manifest classifies public and internal operations without leaks', () => {
  const { manifest, coverage } = buildSearchAdManifest({ sources: { 'ncc.json': swagger }, sourceManifest, corrections });
  assert.equal(coverage.ok, true);
  assert.equal(manifest.operations.length, 3);
  assert.equal(manifest.operations.filter(item => item.runtimeAllowlisted).length, 2);
  const managed = manifest.operations.find(item => item.sourceOperationId === 'listManaged');
  assert.equal(managed.state, 'internal_quarantined');
  assert.equal(managed.runtimeAllowlisted, false);
  const registry = new SearchAdSpecRegistry(manifest);
  assert.equal(registry.list({ runtimeOnly: true }).total, 2);
});

test('git blob sha matches Git object format', () => {
  const content = Buffer.from('hello\n');
  assert.equal(gitBlobSha(content), 'ce013625030ba8dba906f756967f9e9ca394464a');
});
