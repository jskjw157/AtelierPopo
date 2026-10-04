import test from 'node:test';
import assert from 'node:assert/strict';

import { searchAdHierarchyOpenApi } from '../src/http/openapi-searchad-hierarchy.js';
import { createSearchAdHierarchyRoutes } from '../src/http/routes-searchad-hierarchy.js';

const EXPECTED_ADMIN_PATHS = [
  '/api/v1/searchad/hierarchy/campaigns/prepare',
  '/api/v1/searchad/hierarchy/campaigns/{hierarchyRunId}/{hierarchyObjectId}/{planId}/execute',
  '/api/v1/searchad/hierarchy/adgroups/prepare',
  '/api/v1/searchad/hierarchy/adgroups/{hierarchyRunId}/{parentObjectId}/{hierarchyObjectId}/{planId}/execute',
  '/api/v1/searchad/hierarchy/keywords/prepare',
  '/api/v1/searchad/hierarchy/keywords/{hierarchyRunId}/{parentObjectId}/{planId}/execute',
  '/api/v1/searchad/hierarchy/creatives/prepare',
  '/api/v1/searchad/hierarchy/creatives/{hierarchyRunId}/{parentObjectId}/{planId}/execute',
  '/api/v1/searchad/hierarchy/leaves/cleanup/prepare',
  '/api/v1/searchad/hierarchy/leaves/cleanup/{hierarchyRunId}/{hierarchyObjectId}/{planId}/execute',
  '/api/v1/searchad/hierarchy/leaves/cleanup/{hierarchyRunId}/{hierarchyObjectId}/{planId}/reconcile',
  '/api/v1/searchad/hierarchy/inventory/scan',
  '/api/v1/searchad/hierarchy/reconcile'
];

test('Hierarchy OpenAPI is role-scoped and exposes only the bounded Admin surface', () => {
  for (const role of ['reader', 'operator', 'executor']) {
    const doc = searchAdHierarchyOpenApi({ role });
    assert.deepEqual(Object.keys(doc.paths), []);
  }

  const admin = searchAdHierarchyOpenApi({ role: 'admin' });
  assert.deepEqual(Object.keys(admin.paths), EXPECTED_ADMIN_PATHS);
  for (const path of EXPECTED_ADMIN_PATHS) assert.ok(admin.paths[path]?.post);

  const serialized = JSON.stringify(admin);
  assert.doesNotMatch(serialized, /rawUrl|remoteId|keywordText|adCopy|arbitraryRecipe|cleanup\/campaign|cleanup\/adgroup/i);
  assert.match(admin.paths['/api/v1/searchad/hierarchy/inventory/scan'].post.summary, /read-only/i);
  assert.match(admin.paths['/api/v1/searchad/hierarchy/reconcile'].post.summary, /GET-only/i);
});

test('Hierarchy OpenAPI preserves exact server-owned request shapes and does not document parent deletion', () => {
  const admin = searchAdHierarchyOpenApi({ role: 'admin' });

  const keywordPrepare = admin.paths['/api/v1/searchad/hierarchy/keywords/prepare'].post
    .requestBody.content['application/json'].schema;
  assert.deepEqual(keywordPrepare.required, ['customerId', 'hierarchyRunId', 'parentObjectId', 'activationId']);
  assert.equal(keywordPrepare.additionalProperties, false);

  const inventory = admin.paths['/api/v1/searchad/hierarchy/inventory/scan'].post
    .requestBody.content['application/json'].schema;
  assert.deepEqual(inventory.required, ['customerId', 'hierarchyRunId', 'parentObjectId', 'childType']);
  assert.deepEqual(inventory.properties.childType.enum, ['keyword', 'creative', 'adgroup']);

  const reconcile = admin.paths['/api/v1/searchad/hierarchy/reconcile'].post
    .requestBody.content['application/json'].schema;
  assert.deepEqual(reconcile.required, ['customerId', 'hierarchyRunId', 'hierarchyObjectId']);
  assert.equal(reconcile.additionalProperties, false);

  const paths = Object.keys(admin.paths).join('\n');
  assert.doesNotMatch(paths, /campaigns\/.*cleanup|adgroups\/.*cleanup/);
});

test('Hierarchy routes publish unauthenticated role-specific OpenAPI documents', () => {
  const routes = createSearchAdHierarchyRoutes({ app: {} });
  for (const role of ['reader', 'operator', 'executor', 'admin']) {
    const path = `/openapi-searchad-hierarchy-${role}.json`;
    const route = routes.find(item => item.method === 'GET' && item.pattern.test(path));
    assert.ok(route, `missing ${path}`);
    assert.equal(route.auth, false);
    assert.equal(route.write, false);
  }
});
