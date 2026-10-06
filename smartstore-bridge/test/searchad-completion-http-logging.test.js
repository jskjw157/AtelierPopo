import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpApiV05 } from '../src/http/server-v05.js';
import { HttpError } from '../src/http/errors.js';
import { logger as applicationLogger } from '../src/infrastructure/logger.js';

test('actual HTTP handler preserves denial diagnostics without raw request or exception fields', async t => {
  // This tests the HTTP logging seam only. The composed native test separately
  // proves bootstrap/services/worker wiring; no listener or database opens here.
  const key = 'logging-reader-fixture-'.repeat(4), marker = 'private-http-log-fixture-value';
  const privateCode = marker.replaceAll('-', '_').toUpperCase();
  const temporaryUrl = `https://api.searchad.naver.com/report-download?authtoken=${marker}`;
  const id = '00000000-0000-0000-0000-000000000001', events = [], output = [];
  let lookups = 0, network = 0;
  const originalWrite = process.stderr.write, originalFetch = globalThis.fetch;
  const recordingLogger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, context) => {
    events.push({ level, message, context: structuredClone(context) }); applicationLogger[level](message, context);
  }]));
  process.stderr.write = function (chunk, ...args) {
    output.push(String(chunk)); return originalWrite.call(this, String(chunk).replaceAll(marker, '[fixture-private]').replaceAll(privateCode, '[fixture-private]'), ...args);
  };
  globalThis.fetch = async () => { network++; throw new Error('Unexpected external call'); };
  t.after(() => { process.stderr.write = originalWrite; globalThis.fetch = originalFetch; });
  const app = { config: { catalogRoot: '/fixture/catalog', workDir: '/fixture', databasePath: '/fixture/ledger.sqlite' }, ledger: {}, commerceGateway: {},
    searchAdCompletionRuntime: { status: () => ({ ready: true }), statsService: {}, repository: { async getReportJob() {
      lookups++;
      if (lookups > 1) throw new HttpError(502, privateCode, temporaryUrl);
      throw Object.assign(new Error(temporaryUrl), { name: marker, code: marker });
    } } } };
  const env = { ATELIER_API_KEY: key, ATELIER_SEARCHAD_READER_API_KEY: key, ATELIER_SEARCHAD_READER_CUSTOMERS: '1001', ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'logging-reader' };
  const api = createHttpApiV05({ app, env, logger: recordingLogger });
  assert.equal(api.server.listening, false);
  async function invoke(url, { token = key, requestId = undefined } = {}) {
    const req = Readable.from([]); Object.assign(req, { method: 'GET', url, headers: { authorization: `Bearer ${token}`, ...(requestId ? { 'x-request-id': requestId } : {}) }, socket: { remoteAddress: '127.0.0.1' } });
    const headers = new Map(); let result;
    const res = { statusCode: 200, headersSent: false,
      setHeader(name, value) { headers.set(name.toLowerCase(), value); }, hasHeader(name) { return headers.has(name.toLowerCase()); }, getHeader(name) { return headers.get(name.toLowerCase()); },
      writeHead(status, values = {}) { this.statusCode = status; this.headersSent = true; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); },
      end(body) { result = { status: this.statusCode, body: JSON.parse(body) }; }, destroy() { throw new Error('Unexpected response destruction'); }
    };
    await api.server.listeners('request')[0](req, res); return result;
  }
  for (const query of [`authtoken=${marker}`, `executionToken=${marker}`, `downloadUrl=${encodeURIComponent(temporaryUrl)}`]) {
    const result = await invoke(`/api/v1/searchad/reporting/jobs/${id}?customerId=1001&${query}`);
    assert.equal(result.status, 400); assert.equal(result.body.error.code, 'SEARCHAD_REPORTING_QUERY_INVALID');
  }
  assert.equal(lookups, 0, 'query validation runs before storage lookup');
  assert.equal((await invoke(`/api/v1/searchad/reporting/jobs/${id}?customerId=1001&authtoken=${marker}`, { token: marker })).status, 401);
  assert.equal((await invoke(`/unknown/${marker}?downloadUrl=${encodeURIComponent(temporaryUrl)}`)).status, 404);
  // Dynamic path and client correlation ID must not replace the rejected URL as
  // another source of private log data, including successful routing/info events.
  const thrown = await invoke(`/api/v1/searchad/reporting/jobs/${marker}?customerId=1001`, { requestId: marker });
  assert.equal(thrown.status, 500); assert.equal(thrown.body.error.code, 'INTERNAL_ERROR');
  assert.equal((await invoke(`/api/v1/searchad/reporting/jobs/${id}?customerId=1001`)).status, 502);
  assert.equal(lookups, 2); assert.equal(network, 0); assert.equal(api.server.listening, false);
  assert.ok(events.some(event => event.level === 'info' && event.message === 'HTTP request'));
  assert.equal(events.filter(event => event.level === 'error').length, 7);
  assert.deepEqual(events.filter(event => event.level === 'error').map(event => [event.context.status, event.context.code]), [
    [400, 'SEARCHAD_REPORTING_QUERY_INVALID'], [400, 'SEARCHAD_REPORTING_QUERY_INVALID'], [400, 'SEARCHAD_REPORTING_QUERY_INVALID'],
    [401, 'UNAUTHORIZED'], [404, 'ROUTE_NOT_FOUND'], [500, 'INTERNAL_ERROR'], [502, 'HTTP_REQUEST_FAILED']
  ]);
  for (const privateValue of [marker, privateCode, temporaryUrl, encodeURIComponent(temporaryUrl)]) {
    assert.equal(JSON.stringify(events).includes(privateValue), false, 'private value absent from actual logger context');
    assert.equal(output.join('').includes(privateValue), false, 'private value absent from emitted logger output');
  }
  for (const event of events) {
    assert.match(event.context.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(event.context.method, 'GET');
    assert.ok(event.context.route === null || event.context.route.startsWith('^'));
    assert.ok(!Object.hasOwn(event.context, 'url') && !Object.hasOwn(event.context, 'pathname') && !Object.hasOwn(event.context, 'message') && !Object.hasOwn(event.context, 'name'));
  }
});
