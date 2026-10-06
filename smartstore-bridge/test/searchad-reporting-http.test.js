import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportingRuntime } from '../src/naver/searchad/reporting/runtime.js';
import { reportingFixture, input, now } from './helpers/searchad-completion-fixture.js';
import { startWriteFixture } from './helpers/searchad-write-http-fixture.js';
const reader = 'completion-reader-'.repeat(4), operator = 'completion-operator-'.repeat(4);
const httpEnv = { ATELIER_SEARCHAD_READER_API_KEY: reader, ATELIER_SEARCHAD_READER_CUSTOMERS: '1001', ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'completion-reader', ATELIER_SEARCHAD_OPERATOR_API_KEY: operator, ATELIER_SEARCHAD_OPERATOR_CUSTOMERS: '1001', ATELIER_SEARCHAD_OPERATOR_PRINCIPAL_ID: 'completion-operator' };
async function roleCall(h, token, method, route, body) { const response = await fetch(`http://127.0.0.1:${h.api.server.address().port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; }
test('reporting HTTP authenticates roles and Customer before returning unavailable state', async t => {
  const h = await startWriteFixture(t, { httpEnv });
  assert.equal((await roleCall(h, reader, 'POST', '/api/v1/searchad/reporting/stats', { customerId: '1001', entityType: 'campaign', entityId: 'cmp-1', since: '2026-10-01', until: '2026-10-04' })).status, 403);
  assert.equal((await roleCall(h, reader, 'GET', '/api/v1/searchad/reporting/observations?customerId=2002')).status, 403);
  assert.equal((await roleCall(h, reader, 'GET', '/api/v1/searchad/reporting/observations?customerId=1001')).status, 503);
  assert.equal((await roleCall(h, operator, 'POST', '/api/v1/searchad/reporting/stats', { customerId: '1001', entityType: 'campaign', entityId: 'cmp-1', since: '2026-10-01', until: '2026-10-04' })).status, 503);
  assert.equal(h.calls.length, 0);
});
test('completion OpenAPI role documents expose exact collection inputs and explicit unavailable metrics', async t => {
  const h = await startWriteFixture(t, { httpEnv });
  for (const role of ['reader','operator','executor','admin']) {
    const result = await h.call('GET', `/openapi-searchad-completion-${role}.json`, undefined, { authenticated: false });
    assert.equal(result.status, 200);
    assert.ok(result.body.paths['/api/v1/searchad/reporting/metrics']);
    const post = result.body.paths['/api/v1/searchad/reporting/stats']?.post;
    assert.equal(Boolean(post), role !== 'reader');
    if (post) assert.equal(post.requestBody.content['application/json'].schema.additionalProperties, false);
    assert.equal(JSON.stringify(result.body).includes('credentialFingerprint'), false);
  }
});
test('completion readiness is required only when composition requests it and exposes no private fields', async t => {
  const h = await startWriteFixture(t);
  h.app.searchAdConfig.configured = false;
  h.app.searchAdCompletionRequired = true;
  h.app.searchAdCompletionRuntime = { status: () => ({ ready: false, credentialFingerprint: 'private-fingerprint' }) };
  let result = await h.call('GET', '/health/ready', undefined, { authenticated: false });
  assert.equal(result.status, 503); assert.deepEqual(result.body.searchAdCompletion, { required: true, initialized: true, ready: false });
  h.app.searchAdCompletionRuntime.status = () => ({ ready: true, credentialFingerprint: 'private-fingerprint' });
  result = await h.call('GET', '/health/ready', undefined, { authenticated: false });
  assert.equal(result.status, 200); assert.equal(JSON.stringify(result.body).includes('private-'), false); assert.equal(h.calls.length, 0);
});

test('actual reporting HTTP collects scoped observations and redacts upstream errors', async t => {
  const h = await startWriteFixture(t, { httpEnv });
  const f = reportingFixture();
  h.app.searchAdCompletionRuntime = await createReportingRuntime({ ...f, clock: () => now });
  const result = await roleCall(h, operator, 'POST', '/api/v1/searchad/reporting/stats', input);
  assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.quality, 'provisional');
  assert.equal(result.body.metrics.spendGrossKrw, '1100'); assert.equal(result.body.metrics.spendBasis, 'vat_included');
  assert.equal(JSON.stringify(result.body).includes('credentialFingerprint'), false);
  const read = await roleCall(h, reader, 'GET', `/api/v1/searchad/reporting/observations/${result.body.observationId}?customerId=1001`);
  assert.equal(read.status, 200); assert.deepEqual(read.body, result.body);
  const metrics = await roleCall(h, reader, 'GET', '/api/v1/searchad/reporting/metrics?customerId=1001');
  assert.deepEqual(metrics.body, { available: false, status: 'unavailable', reason: 'REPORT_INGESTION_REQUIRED', items: [] });
  for (const route of ['/api/v1/searchad/reporting/observations?customerId=1001&customerId=2002', '/api/v1/searchad/reporting/observations?customerId=1001&limit=10junk', '/api/v1/searchad/reporting/observations?customerId=1001&identity=caller']) assert.equal((await roleCall(h, reader, 'GET', route)).status, 400);
  assert.equal((await roleCall(h, operator, 'POST', '/api/v1/searchad/reporting/stats', { ...input, spend: 0 })).status, 400); assert.equal(f.calls.length, 1);
  await h.app.searchAdCompletionRuntime.close();
  const failing = reportingFixture({ response: new Error('private-password private-token https://private.invalid') });
  h.app.searchAdCompletionRuntime = await createReportingRuntime({ ...failing, clock: () => now });
  const failure = await roleCall(h, operator, 'POST', '/api/v1/searchad/reporting/stats', input);
  assert.equal(failure.status, 502); assert.equal(failure.body.error.code, 'SEARCHAD_STATS_UPSTREAM_FAILED'); assert.equal(JSON.stringify(failure.body).includes('private-'), false);
});
test('new ingestion and archive routes enforce roles and exact Customer scope before availability',async t=>{const h=await startWriteFixture(t,{httpEnv});const job='11111111-1111-1111-1111-111111111111';for(const action of ['ingest','evaluate']){assert.equal((await roleCall(h,reader,'POST',`/api/v1/searchad/reporting/jobs/${job}/${action}`,{customerId:'1001'})).status,403);assert.equal((await roleCall(h,operator,'POST',`/api/v1/searchad/reporting/jobs/${job}/${action}`,{customerId:'1001',evidence:'invented'})).status,400);assert.equal((await roleCall(h,operator,'POST',`/api/v1/searchad/reporting/jobs/${job}/${action}`,{customerId:'1001'})).status,503);}assert.equal((await roleCall(h,reader,'GET',`/api/v1/searchad/reporting/jobs/${job}/content?customerId=2002`)).status,403);for(const role of ['reader','operator','executor','admin']){const result=await h.call('GET',`/openapi-searchad-completion-${role}.json`,undefined,{authenticated:false});assert.ok(result.body.paths['/api/v1/searchad/reporting/jobs/{reportJobId}/content'].get);for(const action of ['ingest','evaluate'])assert.equal(Boolean(result.body.paths[`/api/v1/searchad/reporting/jobs/{reportJobId}/${action}`]),role!=='reader');}assert.equal(h.calls.length,0);});
