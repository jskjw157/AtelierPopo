import { AsyncLocalStorage } from 'node:async_hooks';
import { SearchAdWriteError } from '../write/errors.js';

const ORIGIN = 'https://api.searchad.naver.com';
const CUSTOMER = /^\d{1,30}$/;
function fault(code, message, status = 409) {
  return new SearchAdWriteError(`SEARCHAD_SEND_FENCE_${code}`, message, {}, status);
}
function check(validate) {
  let result;
  try { result = validate(); }
  catch { throw fault('CONTEXT', 'The current handoff is no longer valid.'); }
  if (result !== undefined) {
    // Reject asynchronous validators, including rejected promises, without
    // allowing their continuation to become a future send permission.
    if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    throw fault('VALIDATOR', 'A synchronous handoff validator is required.', 400);
  }
}

/**
 * Coordinates fetch IMPLEMENTATION ENTRY with the actual account row UPDATE.
 * Not a delivery guarantee, cancellation of in-flight requests, retry permit,
 * durable lease or a fence against remote writers / undetectable DB loss.
 * All existing claim/token/risk/provenance checks remain upstream of this class.
 */
export class PostgresAccountSendFence {
  #pool; #fetch; #contexts = new AsyncLocalStorage();
  constructor({ pool, fetchImpl } = {}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function' || typeof fetchImpl !== 'function') {
      throw new TypeError('PostgreSQL and an explicit transport implementation are required');
    }
    this.#pool = pool; this.#fetch = fetchImpl;
  }

  async run(customerId, validate, task) {
    if (typeof customerId !== 'string' || !CUSTOMER.test(customerId) || typeof validate !== 'function' || typeof task !== 'function') {
      throw fault('INPUT', 'An internal Customer scope and synchronous validator are required.', 400);
    }
    check(validate);
    const scope = { customerId, validate, open: true, attempted: false };
    return this.#contexts.run(scope, async () => {
      try {
        const result = await task();
        if (!scope.attempted) throw fault('UNUSED', 'The send scope did not enter its transport boundary.');
        return result;
      } finally { scope.open = false; }
    });
  }

  async fetch(url, init = {}) {
    const target = new URL(url);
    if (target.origin !== ORIGIN || target.username || target.password) throw fault('ORIGIN', 'Unexpected upstream origin.', 400);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = { ...init.headers };
    const request = { ...init, method, headers, redirect: 'error' };
    const address = target.href;
    // Observation must remain available with account suspended and writes OFF.
    if (method === 'GET' || method === 'HEAD') return this.#fetch(address, request);
    const scope = this.#contexts.getStore();
    const customerId = new Headers(headers).get('X-Customer');
    if (!scope?.open || scope.attempted || customerId !== scope.customerId ||
        !['POST', 'DELETE'].includes(method) ||
        (request.body !== undefined && typeof request.body !== 'string')) {
      throw fault('SCOPE', 'A matching unused internal mutation scope is required.');
    }
    scope.attempted = true;
    if (request.signal?.aborted) throw fault('ABORTED', 'The request was cancelled before initiation.');
    let client, discard = false, outcome, failure, lost = false;
    const onError = () => { lost = true; discard = true; };
    try {
      client = await this.#pool.connect();
      client.on?.('error', onError);
      const query = async (sql, args) => {
        try { return await client.query(sql, args); }
        catch { discard = true; throw fault('STORE', 'Account send ordering is unavailable.', 503); }
      };
      await query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await query("SET LOCAL lock_timeout = '5000ms'");
      await query("SET LOCAL statement_timeout = '5000ms'");
      const result = await query('SELECT customer_id,suspended FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE', [customerId]);
      if (result.rows.length !== 1 || result.rows[0].customer_id !== customerId || result.rows[0].suspended !== false) {
        throw fault('SUSPENDED', 'An existing, non-suspended account is required.', 403);
      }
      if (lost || !scope.open || request.signal?.aborted) throw fault('ABORTED', 'The request cannot initiate after waiting.');
      check(scope.validate);
      if (lost || request.signal?.aborted) throw fault('ABORTED', 'The request was cancelled before initiation.');
      // NO await between the final check and invoking fetch. Attach both promise
      // handlers immediately; never keep the row lock while awaiting the reply.
      try {
        outcome = Promise.resolve(this.#fetch(address, request)).then(
          value => ({ value }), error => ({ failed: true, error })
        );
      } catch (error) { outcome = Promise.resolve({ failed: true, error }); }
    } catch (error) {
      failure = error instanceof SearchAdWriteError ? error : fault('STORE', 'Account send ordering is unavailable.', 503);
    } finally {
      if (client) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        client.removeListener?.('error', onError);
        try { client.release(discard); } catch { /* Do not discard a known remote result. */ }
      }
    }
    if (outcome) {
      const settled = await outcome;
      if (settled.failed) throw settled.error;
      return settled.value;
    }
    throw failure || fault('STORE', 'Transport did not initiate.', 503);
  }
}
