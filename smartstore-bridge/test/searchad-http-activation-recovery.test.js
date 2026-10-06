import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startWriteComponentFixture as startWriteFixture, API_KEY, CUSTOMER_ID } from './helpers/searchad-write-http-fixture.js';

const keys = Object.fromEntries(['reader', 'operator', 'executor', 'admin'].map(role => [role, `recovery-${role}-`.repeat(4)]));

async function harness(t) {
  const h = await startWriteFixture(t);
  for (const role of Object.keys(keys)) {
    h.api.searchAdAccessControl.entries.push({ apiKey: keys[role], tokenFingerprint: `test-${role}`, principal: {
      principalId: `authenticated-${role}`, role, customerIds: [CUSTOMER_ID]
    } });
  }
  h.request = async (role, method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${h.api.server.address().port}${route}`, {
      method, headers: { Authorization: `Bearer ${keys[role] || role}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  return h;
}

function activationFixture(h) {
  const calls = [];
  let closes = 0;
  const evidence = { evidenceId: 'e-1', evidenceType: 'passive', customerId: CUSTOMER_ID,
    result: 'verified', operationKeys: [], fieldScope: [], credentialFingerprint: 'must-not-leak',
    details: { requestId: 'safe-id', secretKey: 'must-not-leak' } };
  // Control-plane route fixture only, not real activation or live evidence.
  h.app.searchAdActivationRuntime = {
    status: () => ({ ready: true, storage: { runtime: 'postgres', schemaReady: true } }),
    guard: { assertMutationAllowed: async () => ({ allowed: true }) },
    repository: {
      async listEvidence(input) { calls.push(['list', input]); return [evidence]; },
      async getEvidence(id) { return id === 'e-1' ? evidence : id === 'e-other' ? { ...evidence, customerId: '9999' } : null; },
      async listActivations() { return []; }, async getActivation() { return null; }
    },
    passiveEvidenceService: { async issue(body, context) { calls.push(['issue', body, context]); return evidence; } },
    activationService: { async activate(body, context) { calls.push(['activate', body, context]); return { activationId: 'a-1', evidenceId: body.evidenceId, customerId: CUSTOMER_ID, activatedByPrincipalId: context.principal.principalId }; } },
    accountControlService: {
      async list() { return [{ customerId: CUSTOMER_ID, suspended: false }]; },
      async suspend(customerId, context) { calls.push(['suspend', customerId, context]); return { customerId, suspended: true }; },
      async resume(customerId) { return { customerId, suspended: false }; }
    },
    async close() { closes += 1; }
  };
  return { calls, closes: () => closes };
}

async function approved(h) {
  const result = await h.request('operator', 'POST', '/api/v1/searchad/changes/plan', { ...h.planInput(), createdBy: 'forged' });
  assert.equal(result.status, 201, JSON.stringify(result));
  const planId = result.body.plan_id;
  const approval = await h.request('executor', 'POST', `/api/v1/searchad/changes/${planId}/approve`, { actor: 'forged', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
  assert.equal(approval.status, 200, JSON.stringify(approval));
  return { planId, executionToken: approval.body.executionToken, customerId: CUSTOMER_ID, idempotencyKey: `test-${planId}` };
}

test('application bootstrap includes the recovered activation bootstrap and exposes its startup outcome', () => {
  const source = fs.readFileSync('src/bootstrap-v05.js', 'utf8');
  assert.match(source, /await bootstrapSearchAdActivationRuntime\(/);
  assert.match(source, /searchAdActivationStartupError/);
});

test('actual HTTP exposes scoped sanitized evidence and enforces activation roles', async t => {
  const h = await harness(t);
  const f = activationFixture(h);
  const listed = await h.request('reader', 'GET', '/api/v1/searchad/evidence');
  assert.equal(listed.status, 200, JSON.stringify(listed));
  assert.deepEqual(f.calls[0], ['list', { customerIds: [CUSTOMER_ID], evidenceType: undefined, limit: 100 }]);
  assert.equal(JSON.stringify(listed).includes('must-not-leak'), false);
  assert.equal((await h.request(API_KEY, 'GET', '/api/v1/searchad/evidence')).status, 401);
  assert.equal((await h.request('reader', 'POST', '/api/v1/searchad/capabilities/passive-evidence', { customerId: CUSTOMER_ID })).status, 403);
  assert.equal((await h.request('operator', 'POST', '/api/v1/searchad/capabilities/passive-evidence', { customerId: CUSTOMER_ID })).status, 201);
  assert.equal(f.calls.find(c => c[0] === 'issue')[2].principal.principalId, 'authenticated-operator');
  assert.equal((await h.request('executor', 'POST', '/api/v1/searchad/activations', { evidenceId: 'e-1' })).status, 403);
  assert.equal((await h.request('admin', 'POST', '/api/v1/searchad/activations', { evidenceId: 'e-1' })).status, 201);
  assert.equal((await h.request('admin', 'POST', '/api/v1/searchad/activations', { evidenceId: 'e-1', passed: true })).status, 400);
  assert.equal((await h.request('admin', 'POST', '/api/v1/searchad/accounts/9999/suspend', {})).status, 403);
  const hidden = await h.request('reader', 'GET', '/api/v1/searchad/evidence/e-other');
  const absent = await h.request('reader', 'GET', '/api/v1/searchad/evidence/missing');
  assert.equal(hidden.status, 404);
  assert.equal(hidden.body.error.code, absent.body.error.code);
});

test('activation readiness and shutdown are connected without claiming a missing runtime is ready', async t => {
  const h = await harness(t);
  h.app.searchAdActivationRuntime = null;
  assert.equal(h.api.readiness().searchAdActivation?.status?.ready, false);
  assert.equal((await h.request('reader', 'GET', '/api/v1/searchad/evidence')).status, 503);
  const f = activationFixture(h);
  assert.equal(h.api.readiness().searchAdActivation.status.ready, true);
  await h.api.close();
  assert.equal(f.closes(), 1);
});

test('role write HTTP awaits plan and approval, binds actors, scopes list/detail and denies cross-Customer execution', async t => {
  const h = await harness(t);
  const input = await approved(h);
  const runtime = h.app.searchAdWriteRuntime;
  const plan = await runtime.repository.getPlan(input.planId);
  assert.equal(plan.created_by, 'authenticated-operator');
  assert.equal(typeof input.executionToken, 'string');
  const listed = await h.request('reader', 'GET', '/api/v1/searchad/changes');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 1);
  const other = await runtime.planService.create({ ...h.planInput(), customerId: CUSTOMER_ID, reason: 'hidden-plan-fixture' });
  // Use the durable repository to bind an otherwise normal fixture plan to another Customer.
  runtime.repository.database.prepare('UPDATE searchad_write_change_plans SET customer_id=? WHERE plan_id=?').run('9999', other.plan_id);
  assert.equal((await h.request('reader', 'GET', `/api/v1/searchad/changes/${other.plan_id}`)).status, 404);
  assert.equal((await h.request('executor', 'POST', `/api/v1/searchad/changes/${other.plan_id}/execute`, input)).status, 404);
  assert.equal((await h.request('reader', 'GET', '/api/v1/searchad/changes?customerId=9999')).status, 403);
  assert.equal((await h.request('reader', 'POST', `/api/v1/searchad/changes/${input.planId}/execute`, input)).status, 403);
  const result = await h.request('executor', 'POST', `/api/v1/searchad/changes/${input.planId}/execute`, input);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.status, 'applied');
  assert.equal(h.mutations().length, 1);
});

test('generic operation execution cannot bypass the role and Customer boundary', async t => {
  const h = await harness(t);
  const input = await approved(h);
  const route = `/api/v1/searchad/operations/${encodeURIComponent(h.update.operationKey)}/execute`;
  assert.equal((await h.request(API_KEY, 'POST', route, input)).status, 401);
  assert.equal((await h.request('reader', 'POST', route, input)).status, 403);
  assert.equal((await h.request('executor', 'POST', route, { ...input, customerId: '9999' })).status, 403);
  assert.equal(h.mutations().length, 0);
  const result = await h.request('executor', 'POST', route, input);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.result.status, 'applied');
  assert.equal(h.mutations().length, 1);
});

test('role-specific activation OpenAPI does not expose Admin actions to Reader or Executor', async t => {
  const h = await harness(t);
  const reader = await h.request('reader', 'GET', '/openapi-searchad-activation-reader.json');
  assert.equal(reader.status, 200);
  assert.equal(reader.body.paths['/api/v1/searchad/activations'].post, undefined);
  const admin = await h.request('admin', 'GET', '/openapi-searchad-activation-admin.json');
  assert.equal(admin.status, 200);
  assert.ok(admin.body.paths['/api/v1/searchad/activations'].post);
});
