import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapSearchAdCompletionRuntime } from '../src/naver/searchad/completion-bootstrap.js';
import { loadSearchAdReportingConfig } from '../src/naver/searchad/reporting/config.js';
import { createReportingRuntime } from '../src/naver/searchad/reporting/runtime.js';
import { reportingFixture, input, context, now } from './helpers/searchad-completion-fixture.js';
test('completion config disables reporting jobs and validates gates strictly', () => {
  assert.equal(loadSearchAdReportingConfig({}).allowReportingJobs, false);
  for (const value of ['truthy', '1', 'yes']) assert.throws(() => loadSearchAdReportingConfig({ ATELIER_SEARCHAD_REPORTING_ENABLED: value }));
});
test('completion bootstrap failure is sanitized and never closes a borrowed pool', async () => {
  const f = reportingFixture(); let closed = 0;
  const pool = { async query() { throw new Error('secret DB password'); }, async end() { closed += 1; } };
  const result = await bootstrapSearchAdCompletionRuntime({ app: { searchAdConfig: f.config, searchAdGateway: f.gateway, searchAdRegistry: f.registry, searchAdCredentials: f.credentialsRegistry, searchAdActivationRuntime: { repository: { pool } } }, env: {}, logger: { error() {} } });
  assert.equal(result.runtime, null); assert.equal(result.startupError.code, 'SEARCHAD_REPORTING_SCHEMA_NOT_READY');
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal(closed, 0);
});
test('completion close is idempotent, drains in-flight collection and closes only owned resources', async () => {
  let closed = 0, release, enter;
  const pending = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { enter = resolve; });
  const f = reportingFixture({ afterRequest: async () => { enter(); await pending; } });
  const runtime = await createReportingRuntime({ ...f, clock: () => now, closeOwnedResources: async () => { closed += 1; } });
  const collected = runtime.statsService.collect(input, context); await entered;
  const first = runtime.close(), second = runtime.close(); assert.equal(first, second); assert.equal(closed, 0);
  await assert.rejects(() => runtime.statsService.collect(input, context), { code: 'SEARCHAD_REPORTING_NOT_READY' });
  release(); assert.equal((await collected).metrics.spendGrossKrw, '1100'); await first;
  assert.equal(closed, 1); assert.equal(runtime.status().ready, false);
});
test('reporting runtime forces fixed-origin transport and denies redirect evidence', async () => {
  const f = reportingFixture(); let redirect;
  f.gateway.client.fetchImpl = async (_url, init) => { redirect = init.redirect; return new Response('{}', { status: 302, headers: { location: 'https://private.invalid?token=secret' } }); };
  const runtime = await createReportingRuntime({ ...f, clock: () => Date.parse('2026-10-05T03:00:00Z') });
  try {
    await assert.rejects(() => runtime.statsService.collect({ customerId: '1001', entityType: 'campaign', entityId: 'cmp-1', since: '2026-10-01', until: '2026-10-04' }, { principal: { principalId: 'operator', role: 'operator', customerIds: ['1001'] }, requestId: 'request' }), { code: 'SEARCHAD_STATS_UPSTREAM_FAILED' });
    assert.equal(redirect, 'error'); assert.equal(f.rows.length, 0);
  } finally { await runtime.close(); }
});

test('required ingestion storage is unready without durable storage and generation policy',async()=>{
  const f=reportingFixture();const runtime=await createReportingRuntime({...f,reportingConfig:{enabled:true,allowReportingJobs:false,ingestionRequired:true},clock:()=>now});
  assert.equal(runtime.status().ready,false);assert.equal(runtime.status().reporting.ingestion,false);await runtime.close();
});
