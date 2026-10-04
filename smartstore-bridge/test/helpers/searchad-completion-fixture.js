import { loadSearchAdSpecRegistry } from '../../src/naver/searchad/spec-registry.js';
import { SearchAdCredentialsRegistry } from '../../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../../src/naver/searchad/gateway.js';
import { currentReportingIdentity } from '../../src/naver/searchad/reporting/contracts.js';
export const now = Date.parse('2026-10-05T03:00:00Z');
export const input = { customerId: '1001', entityType: 'campaign', entityId: 'cmp-1', since: '2026-10-01', until: '2026-10-04' };
export const context = { principal: { principalId: 'fixture-operator', role: 'operator', customerIds: ['1001'] }, requestId: 'fixture-local-request' };
export function responseFixture() {
  return { summaryStatResponse: { cycleBaseTm: '202610051155', data: [{ id: 'cmp-1', salesAmt: 1100, impCnt: 20, clkCnt: 2, ccnt: 1, convAmt: 2000 }] } };
}
export function reportingFixture({ repository, response = responseFixture(), afterRequest = () => {} } = {}) {
  const rows = [];
  const calls = [];
  const registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
  const credentialsRegistry = new SearchAdCredentialsRegistry({ principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }], customers: [{ customerId: '1001', status: 'active' }], grants: [{ principalId: 'fixture', customerId: '1001', role: 'operator' }] });
  const config = { enabled: true, configured: true, allowReads: true, allowWrites: false, allowUnverifiedOperations: false, baseUrl: 'https://api.searchad.naver.com' };
  const client = new NaverSearchAdClient({ credentialsRegistry, clock: () => now, maxRetries: 0, logger: { info() {}, warn() {}, error() {} }, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    await afterRequest();
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-upstream-request' } });
  } });
  const gateway = new SearchAdOperationGateway({ registry, credentialsRegistry, config, client });
  return { rows, calls, gateway, registry, credentialsRegistry, config,
    repository: repository || {
      async appendObservation(row) { rows.push(structuredClone(row)); return structuredClone(row); },
      async getObservation({ customerId, observationId }) { return structuredClone(rows.find(row => row.customerId === customerId && row.observationId === observationId) || null); },
      async listObservations({ customerId, entityType, entityId, limit }) { return structuredClone(rows.filter(row => row.customerId === customerId && (!entityType || row.entityType === entityType) && (!entityId || row.entityId === entityId)).slice(0, limit)); }
    },
    identityResolver: customerId => currentReportingIdentity({ customerId, registry, credentialsRegistry, config }),
    rotate() { credentialsRegistry.principals.get('fixture').secretKey = 'rotated-fixture-secret'; } };
}
