import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchAdWriteRoutesV3 } from '../src/http/routes-searchad-write-v3.js';
import { startWriteFixture, API_KEY, CUSTOMER_ID } from './helpers/searchad-write-http-fixture.js';

function routeFor(routes, method, pathname) {
  return routes.find(item => item.method === method && item.pattern.test(pathname));
}

test('SearchAd write control-plane route metadata enforces Reader Operator Executor roles', () => {
  const context = { app: {}, env: {}, httpConfig: {} };
  const routes = createSearchAdWriteRoutesV3(context);
  const cases = [
    ['GET', '/api/v1/searchad/write/status', 'reader'],
    ['GET', '/api/v1/searchad/changes', 'reader'],
    ['GET', '/api/v1/searchad/changes/plan-1', 'reader'],
    ['POST', '/api/v1/searchad/changes/plan', 'operator'],
    ['POST', '/api/v1/searchad/changes/plan-1/approve', 'executor'],
    ['POST', '/api/v1/searchad/changes/plan-1/execute', 'executor'],
    ['POST', '/api/v1/searchad/changes/plan-1/reconcile', 'executor'],
    ['POST', '/api/v1/searchad/changes/plan-1/rollback', 'executor']
  ];
  for (const [method, pathname, role] of cases) {
    const route = routeFor(routes, method, pathname);
    assert.ok(route, `${method} ${pathname} route missing`);
    assert.equal(route.searchAdRole, role, `${method} ${pathname}`);
  }
});

test('generic HAAR API key cannot authenticate the SearchAd write control plane', async t => {
  const f = await startWriteFixture(t);
  assert.ok(API_KEY);
  const result = await f.call('GET', '/api/v1/searchad/changes');
  assert.equal(result.status, 401, JSON.stringify(result));
});

test('Reader can list and get granted plans but cannot create a plan', async t => {
  const f = await startWriteFixture(t);

  const readerList = await f.call('GET', '/api/v1/searchad/changes', undefined, { role: 'reader' });
  assert.equal(readerList.status, 200, JSON.stringify(readerList));
  assert.deepEqual(readerList.body.items, []);

  const readerPlan = await f.call('POST', '/api/v1/searchad/changes/plan', f.planInput(), { role: 'reader' });
  assert.equal(readerPlan.status, 403, JSON.stringify(readerPlan));
  assert.equal(readerPlan.body.error.code, 'SEARCHAD_ROLE_FORBIDDEN');
});

test('Operator creates a Customer-scoped plan with server-authenticated actor, not body createdBy', async t => {
  const f = await startWriteFixture(t);
  const input = { ...f.planInput(), createdBy: 'attacker-controlled-createdBy' };
  const planned = await f.call('POST', '/api/v1/searchad/changes/plan', input, { role: 'operator' });

  assert.equal(planned.status, 201, JSON.stringify(planned));
  assert.equal(planned.body.customer_id, CUSTOMER_ID);
  assert.equal(planned.body.created_by, 'fixture-operator');

  const readerGet = await f.call('GET', `/api/v1/searchad/changes/${planned.body.plan_id}`, undefined, { role: 'reader' });
  assert.equal(readerGet.status, 200, JSON.stringify(readerGet));
  assert.equal(readerGet.body.created_by, 'fixture-operator');

  const outsiderGet = await f.call('GET', `/api/v1/searchad/changes/${planned.body.plan_id}`, undefined, { role: 'admin' });
  assert.equal(outsiderGet.status, 404, JSON.stringify(outsiderGet));
  assert.equal(outsiderGet.body.error.code, 'SEARCHAD_CHANGE_PLAN_NOT_FOUND');

  const outsiderList = await f.call('GET', '/api/v1/searchad/changes', undefined, { role: 'admin' });
  assert.equal(outsiderList.status, 200, JSON.stringify(outsiderList));
  assert.deepEqual(outsiderList.body.items, []);
});

test('Operator cannot approve or execute; Executor approval actor is principal-bound and execution is allowed', async t => {
  const f = await startWriteFixture(t);
  const planned = await f.call('POST', '/api/v1/searchad/changes/plan', f.planInput(), { role: 'operator' });
  assert.equal(planned.status, 201, JSON.stringify(planned));
  const planId = planned.body.plan_id;

  const operatorApproval = await f.call('POST', `/api/v1/searchad/changes/${planId}/approve`, {
    actor: 'attacker-actor', confirmation: 'APPROVE_SEARCHAD_CHANGE'
  }, { role: 'operator' });
  assert.equal(operatorApproval.status, 403, JSON.stringify(operatorApproval));
  assert.equal(operatorApproval.body.error.code, 'SEARCHAD_ROLE_FORBIDDEN');

  const approved = await f.call('POST', `/api/v1/searchad/changes/${planId}/approve`, {
    actor: 'attacker-actor', confirmation: 'APPROVE_SEARCHAD_CHANGE'
  }, { role: 'executor' });
  assert.equal(approved.status, 200, JSON.stringify(approved));
  const storedApproval = f.app.searchAdWriteRuntime.repository.getApproval(approved.body.approvalId);
  assert.equal(storedApproval.actor, 'fixture-executor');

  const operatorExecute = await f.call('POST', `/api/v1/searchad/changes/${planId}/execute`, {
    executionToken: approved.body.executionToken,
    idempotencyKey: `operator-${planId}`
  }, { role: 'operator' });
  assert.equal(operatorExecute.status, 403, JSON.stringify(operatorExecute));
  assert.equal(f.mutations().length, 0);
  assert.equal(storedApproval.used_at, null);

  const executed = await f.call('POST', `/api/v1/searchad/changes/${planId}/execute`, {
    executionToken: approved.body.executionToken,
    idempotencyKey: `executor-${planId}`
  }, { role: 'executor' });
  assert.equal(executed.status, 200, JSON.stringify(executed));
  assert.equal(executed.body.status, 'applied');
  assert.equal(f.mutations().length, 1);
});

test('Executor reconcile remains available as a read-only recovery path', async t => {
  const f = await startWriteFixture(t);
  const planned = await f.call('POST', '/api/v1/searchad/changes/plan', f.planInput(), { role: 'operator' });
  const planId = planned.body.plan_id;
  const approved = await f.call('POST', `/api/v1/searchad/changes/${planId}/approve`, {
    confirmation: 'APPROVE_SEARCHAD_CHANGE'
  }, { role: 'executor' });
  f.failMutation();
  const executed = await f.call('POST', `/api/v1/searchad/changes/${planId}/execute`, {
    executionToken: approved.body.executionToken,
    idempotencyKey: `ambiguous-${planId}`
  }, { role: 'executor' });
  assert.equal(executed.status, 409, JSON.stringify(executed));
  assert.equal(executed.body.error.code, 'SEARCHAD_UNKNOWN_OUTCOME');
  assert.equal(f.mutations().length, 1);

  f.api.httpConfig.allowWrites = false;
  const reconciled = await f.call('POST', `/api/v1/searchad/changes/${planId}/reconcile`, {}, { role: 'executor' });
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled));
  assert.equal(reconciled.body.status, 'applied_reconciled');
  assert.equal(f.mutations().length, 1);
});
