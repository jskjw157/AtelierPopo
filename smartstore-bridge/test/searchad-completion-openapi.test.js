import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAdCompletionOpenApi } from '../src/http/openapi-searchad-completion.js';
import { createSearchAdReportingRoutes } from '../src/http/routes-searchad-reporting.js';
import { createSearchAdCircuitRoutes } from '../src/http/routes-searchad-circuit.js';
import { createSearchAdAutomationRoutes } from '../src/http/routes-searchad-automation.js';
import { createSearchAdWorkerRoutes } from '../src/http/routes-searchad-worker.js';
import { createSearchAdProfitabilityRoutes } from '../src/http/routes-searchad-profitability.js';
import { SEARCHAD_ROLE_RANK } from '../src/http/searchad-access-control.js';

const context = { app: {} };
const routes = [createSearchAdReportingRoutes, createSearchAdCircuitRoutes, createSearchAdAutomationRoutes,
  createSearchAdWorkerRoutes, createSearchAdProfitabilityRoutes].flatMap(factory => factory(context)).filter(route => route.searchAdRole);
const sample = path => path.replaceAll(/\{[^}]+\}/g, '00000000-0000-0000-0000-000000000001');
for (const role of ['reader', 'operator', 'executor', 'admin']) test(`${role} completion OpenAPI exactly matches owned HTTP methods and roles`, () => {
  const doc = searchAdCompletionOpenApi({ role }), documented = [];
  for (const [path, methods] of Object.entries(doc.paths)) for (const [method, operation] of Object.entries(methods)) {
    const matches = routes.filter(route => route.method === method.toUpperCase() && route.pattern.test(sample(path)));
    assert.equal(matches.length, 1, `${method} ${path} has exactly one runtime owner`);
    assert.equal(operation['x-minimum-role'], matches[0].searchAdRole);
    assert.ok(SEARCHAD_ROLE_RANK[role] >= SEARCHAD_ROLE_RANK[matches[0].searchAdRole]);
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    if (method === 'post') {
      const schema = operation.requestBody.content['application/json'].schema;
      for (const variant of schema.oneOf && !schema.properties ? schema.oneOf : [schema]) {
        assert.equal(variant.additionalProperties, false, `${path} exact request`);
        assert.ok(variant.required.includes('customerId'));
        assert.ok(new RegExp(variant.properties.customerId.pattern).test('1001'));
      }
    } else assert.ok(operation.parameters.some(parameter => parameter.name === 'customerId' && parameter.required));
    documented.push(matches[0]);
  }
  assert.equal(documented.length, routes.filter(route => SEARCHAD_ROLE_RANK[role] >= SEARCHAD_ROLE_RANK[route.searchAdRole]).length);
  assert.equal(new Set(documented).size, documented.length);
  assert.ok(Object.keys(doc.paths).every(path => !path.includes('cleanup') && !path.includes('activations')));
  assert.ok(Object.values(doc.paths).every(methods => !methods.delete));
});

test('completion role docs describe blockers without supplying activation or cleanup authority', () => {
  for (const role of ['reader', 'operator', 'executor', 'admin']) {
    const doc = searchAdCompletionOpenApi({ role });
    assert.equal(doc['x-execution-authority'], false);
    assert.deepEqual(doc['x-operational-blockers'], {
      source: 'runtime.status().blockers', descriptiveOnly: true, executionAuthority: false,
      parentCleanup: false, liveVerified: false, unsupportedSchemas: 'quarantined',
      providerFinances: 'partial_or_unknown', estimates: 'create_gated_post_unavailable',
      circuitBaseline: 'unavailable'
    });
  }
});

test('public automation request schemas keep delegated fields exact and raw tokens transient', () => {
  const doc = searchAdCompletionOpenApi({ role: 'admin' });
  const schema = path => doc.paths[path].post.requestBody.content['application/json'].schema;
  assert.deepEqual(Object.keys(schema('/api/v1/searchad/automation/runs/{runId}/execute-auto').properties), ['customerId']);
  assert.equal(schema('/api/v1/searchad/automation/runs/{runId}/execute-approved').properties.executionToken.writeOnly, true);
  const policy = schema('/api/v1/searchad/automation/policies');
  assert.equal(policy.properties.mode.default, 'observe');
  assert.equal(policy.properties.enabled.default, false);
  assert.equal(policy.properties.delegation.additionalProperties, false);
  assert.equal(policy.properties.delegation.properties.maxChangePercent.maximum, 20);
  assert.equal(policy.properties.delegation.properties.maxDailyOperations.maximum, 200);
  assert.deepEqual(policy.properties.recipe.oneOf[0].properties.userLock.enum, [true]);
});
