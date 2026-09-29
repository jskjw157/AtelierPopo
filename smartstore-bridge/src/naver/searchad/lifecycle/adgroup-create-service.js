import { isDeepStrictEqual as equal } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { PostgresAccountSendFence } from './postgres-account-send-fence.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { PostgresAdgroupCreateRepository } from './postgres-adgroup-create-repository.js';
import { adgroupScope, problem } from './adgroup-create-contract.js';

const ORIGIN = 'https://api.searchad.naver.com';
/** One internal stopped adgroup under a verified root. Deliberately no HTTP wiring. */
export class AdgroupCreateService {
  #enabled; #config; #registry; #credentials; #clock; #gateway; #store; #sendFence;
  constructor({ pool, registry, credentialsRegistry, config, enabled = false, dailyBudget, riskUnits, dailyCapacityUnits, planTtlSeconds = 300, preflightMaxAgeMs = 5000, clock = Date.now, fetchImpl = globalThis.fetch, logger = console } = {}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function' || typeof registry?.get !== 'function' || typeof registry?.status !== 'function' || typeof credentialsRegistry?.resolve !== 'function') throw new TypeError('PostgreSQL, pinned registry and current credentials are required');
    if (typeof enabled !== 'boolean' || typeof clock !== 'function' || typeof fetchImpl !== 'function' || config?.baseUrl !== ORIGIN) throw new TypeError('Explicit gate, clock, transport and official origin required');
    for (const value of [dailyBudget, riskUnits, dailyCapacityUnits]) if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new TypeError('Positive bounded server policy required');
    if (riskUnits > dailyCapacityUnits || !Number.isSafeInteger(planTtlSeconds) || planTtlSeconds < 60 || planTtlSeconds > 3600 || !Number.isSafeInteger(preflightMaxAgeMs) || preflightMaxAgeMs < 100 || preflightMaxAgeMs > 30000) throw new TypeError('Invalid TTL, observation age or risk policy');
    this.#enabled = enabled; this.#config = config; this.#registry = registry; this.#credentials = credentialsRegistry; this.#clock = clock;
    this.#sendFence = new PostgresAccountSendFence({pool,fetchImpl});
    const safeFetch = async (url, init) => {
      if (new URL(url).origin !== ORIGIN) throw new Error('Unexpected adgroup origin');
      const response = await this.#sendFence.fetch(url, { ...init, redirect: 'error' });
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('Adgroup redirects forbidden');
      return response;
    };
    const client = new NaverSearchAdClient({ baseUrl: ORIGIN, credentialsRegistry, fetchImpl: safeFetch, maxRetries: 0, clock, logger });
    this.#gateway = new SearchAdOperationGateway({ client, registry, credentialsRegistry, config, logger });
    this.#store = new PostgresAdgroupCreateRepository({ pool, dailyBudget, riskUnits, dailyCapacityUnits, planTtlSeconds, preflightMaxAgeMs, clock, current: id => this.#identity(id), gate: d => this.#gate(d) });
  }
  #on() { if (!this.#enabled) problem('DISABLED', 'Adgroup creation is disabled.', 403); }
  #identity(customerId) {
    try {
      if (this.#config.baseUrl !== ORIGIN) throw new Error();
      for (const [key, method, path, gate] of [[OPS.campaign.read,'GET','/ncc/campaigns/{campaignId}','reads'],[OPS.adgroup.create,'POST','/ncc/adgroups','creates'],[OPS.adgroup.read,'GET','/ncc/adgroups/{adgroupId}','reads']]) {
        const op = this.#registry.get(key);
        if (op.operationKey !== key || op.method !== method || op.path !== path || op.requiredGate !== gate || op.sideEffect !== (method === 'POST') || op.runtimeAllowlisted !== true || op.state !== 'public_documented' || op.tier !== 'B') throw new Error();
      }
      const specSha = this.#registry.status().specRef;
      if (typeof specSha !== 'string' || !specSha) throw new Error();
      return { specSha, credentialFingerprint:credentialFingerprintForCustomer(this.#credentials,customerId), upstreamBaseUrl:ORIGIN };
    } catch { problem('CONTEXT', 'Current pinned operations or credential identity are unavailable.', 503); }
  }
  #gate(descriptor) {
    this.#identity(descriptor.customerId);
    this.#gateway.canaryExecutionCheck(this.#registry.get(OPS.adgroup.create), { ...descriptor, confirmation: this.#registry.get(OPS.adgroup.create).confirmation });
    for (const key of [OPS.campaign.read,OPS.adgroup.read]) this.#gateway.executionCheck(this.#registry.get(key), { customerId: descriptor.customerId });
  }
  async prepare(input = {}, context = {}) { this.#on(); return this.#store.prepare(adgroupScope(input,context)); }
  async execute(input = {}, context = {}) {
    this.#on(); const s = adgroupScope(input,context,true);
    const preflight = await this.#store.executionSnapshot(s);
    let parent;
    try { parent = await this.#gateway.execute(OPS.campaign.read,preflight.descriptor); }
    catch { problem('PREFLIGHT', 'Stopped parent observation is unavailable; no token/risk was consumed.'); }
    const handoff = await this.#store.claim(preflight.ticket,parent);
    let result, unavailable = false;
    try {
      result = await this.#sendFence.run(s.customerId, () => {
        this.#gate(handoff.descriptor);
        if (!equal(this.#identity(s.customerId),handoff.identity) || this.#clock() >= handoff.validUntil || new Date(this.#clock()).toISOString().slice(0,10) !== handoff.riskDate) throw new Error('Handoff context changed');
      }, () => this.#gateway.executeCanary(OPS.adgroup.create, { ...handoff.descriptor, confirmation:this.#registry.get(OPS.adgroup.create).confirmation }));
    } catch { unavailable = true; }
    const captured = await this.#store.capture(handoff.ticket,result,unavailable);
    if (!captured.ticket) return captured.projection;
    let read, readUnavailable = false, contextMismatch = false;
    try {
      if (!equal(this.#identity(s.customerId),handoff.identity)) throw new Error('Changed identity');
      read = await this.#gateway.execute(OPS.adgroup.read, { customerId: s.customerId, pathParams: { adgroupId: captured.projection.remoteId } });
    } catch { readUnavailable = true; }
    try { contextMismatch = !equal(this.#identity(s.customerId),handoff.identity); } catch { contextMismatch = true; }
    return this.#store.verify(captured.ticket,read,{ unavailable: readUnavailable, contextMismatch });
  }
}
