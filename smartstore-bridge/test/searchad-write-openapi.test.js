import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchAdOpenApi } from '../src/http/openapi-searchad.js';
import { searchAdWriteOpenApi } from '../src/http/openapi-searchad-write.js';
import { createSearchAdWriteRoutesV3 } from '../src/http/routes-searchad-write-v3.js';

test('SearchAd write OpenAPI exposes plan approval execute reconcile and rollback only through official operation descriptors', () => {
  const document = searchAdWriteOpenApi({ version: '0.7.0' });
  const expected = [
    '/api/v1/searchad/write/status',
    '/api/v1/searchad/changes',
    '/api/v1/searchad/changes/{planId}',
    '/api/v1/searchad/changes/plan',
    '/api/v1/searchad/changes/{planId}/approve',
    '/api/v1/searchad/changes/{planId}/execute',
    '/api/v1/searchad/changes/{planId}/reconcile',
    '/api/v1/searchad/changes/{planId}/rollback'
  ];
  assert.deepEqual(Object.keys(document.paths), expected);
  const serialized = JSON.stringify(document);
  assert.match(serialized, /operationKey/);
  assert.match(serialized, /APPROVE_SEARCHAD_CHANGE/);
  assert.match(serialized, /ROLLBACK_SEARCHAD_CHANGE/);
  assert.doesNotMatch(serialized, /rawUrl|arbitraryUrl|syncNaverToCafe24|syncCafe24ToNaver/);
});

test('SearchAd write routes include authenticated status and write endpoints plus public OpenAPI', () => {
  const routes = createSearchAdWriteRoutesV3({ app: {}, env: {} });
  const openapi = routes.find(route => route.pattern.test('/openapi-searchad-write.json'));
  assert.equal(openapi.auth, false);
  const status = routes.find(route => route.pattern.test('/api/v1/searchad/write/status'));
  assert.equal(status.auth, true);
  assert.equal(status.write, false);
  const execute = routes.find(route => route.pattern.test('/api/v1/searchad/changes/abc/execute'));
  assert.equal(execute.auth, true);
  assert.equal(execute.write, true);
});

test('generic SearchAd OpenAPI documents approved-plan execution without advertising unsafe async writes', () => {
  const document = buildSearchAdOpenApi({ serverUrl: 'http://localhost' });
  const operation = document.paths['/api/v1/searchad/operations/{operationKey}/execute'].post;
  assert.ok(operation.responses['200']);
  assert.equal(operation.responses['202'], undefined);
  const approved = document.components.schemas.SearchAdApprovedPlanInput;
  assert.deepEqual(approved.required, ['planId', 'customerId', 'executionToken']);
  assert.equal(approved.additionalProperties, false);
  assert.equal(approved.properties.executionToken.writeOnly, true);
});
