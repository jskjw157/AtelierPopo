import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';
function service(context) {
  const result = context.app.searchAdCompletionRuntime?.circuitService;
  if (!result) throw new HttpError(503, 'SEARCHAD_CIRCUIT_UNAVAILABLE', 'SearchAd Circuit is unavailable.');
  return result;
}
export function createSearchAdCircuitRoutes(context) {
  return [
    { method: 'GET', pattern: /^\/api\/v1\/searchad\/circuit$/, auth: true, write: false, searchAdRole: 'reader', handler: async ({ req, res, url, principal }) => {
      if ([...url.searchParams.keys()].some(key => key !== 'customerId') || url.searchParams.getAll('customerId').length !== 1) throw new HttpError(400, 'SEARCHAD_CIRCUIT_INPUT', 'An exact Customer scope is required.');
      sendJson(req, res, 200, await service(context).status({ customerId: url.searchParams.get('customerId') }, { principal }));
    } },
    ...['pause','resume','recover-rule'].map(action => ({ method: 'POST', pattern: new RegExp(`^/api/v1/searchad/circuit/${action}$`), auth: true, write: true, searchAdRole: 'admin', handler: async ({ req, res, body, url, principal }) => {
      if (url.searchParams.size || !body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'SEARCHAD_CIRCUIT_INPUT', 'Customer and reason are required.');
      sendJson(req, res, 200, await service(context)[action==='recover-rule'?'recoverRule':action](body, { principal }));
    } }))
  ];
}
