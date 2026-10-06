import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationService } from '../src/naver/searchad/automation/service.js';
import { CircuitService } from '../src/naver/searchad/circuit/service.js';
import { autoFacts, autoNow } from './helpers/searchad-limited-auto-fixture.js';

const context = { principal: { principalId: 'assessment-fixture', role: 'operator', customerIds: ['1001'] } };
const iso = value => new Date(value).toISOString();
// Closed synthetic collaborators supply facts, never an eligibility/approval
// result. Both production services and their real predicates run unchanged.
function fixture({ start = autoNow, getMs = 0, sourceMs = 0, circuitMs = 0, commitMs = 0, patch = () => {}, afterAppend = at => at } = {}) {
  let time = start, observation, sourceAt;
  const facts = autoFacts(start); patch(facts);
  const policy = { ...facts.policy, policyId: '00000000-0000-0000-0000-000000000001', ruleId: 'assessment-rule' };
  const circuit = new CircuitService({ clock: () => time, projection: { async catchUp() { return { ready: true }; } },
    repository: { async transaction(customerId, task) { const result = await task({ query() {} }); time += commitMs; return result; },
      async hasBacklog() { return false; }, async unresolved() { return false; }, async getState() { return {}; },
      async getPolicy() { return { customerDailySpendCeilingGrossKrw: 100000 }; } },
    spendEvidence: { async select() { time += circuitMs; return { spendGrossKrw: 100, baselineGrossKrw: 100, validUntil: start + 1000 }; } }
  });
  const service = new AutomationService({ clock: () => time, circuit, identityResolver: () => facts.evidence.identity,
    repository: { async findPolicy() { return policy; }, async appendCurrent(value) { observation = structuredClone(value); time = afterAppend(time); },
      async selectAutoFacts({ selected, now }) { sourceAt = now; time += sourceMs; return { ...structuredClone(facts), evidence: { ...structuredClone(facts.evidence), identity: selected.identity, current: selected.current } }; },
      async createDecisionOnce(row) { return row; } },
    evidenceSelector: { async select() { return { stats: facts.evidence.stats }; } },
    getWriteRuntime: () => ({ remote: { async read() { time += getMs; return { value: { nccCampaignId: 'cmp-1', dailyBudget: 1000, userLock: false } }; } } })
  });
  return { evaluate: () => service.evaluate({ customerId: '1001', policyId: policy.policyId }, context), get time() { return time; }, get observation() { return observation; }, get sourceAt() { return sourceAt; } };
}

for (const getMs of [0, 1, 100]) test(`actual automation assesses acknowledged GET after ${getMs}ms without backdating its observation`, async () => {
  const f = fixture({ getMs, sourceMs: 1, circuitMs: 1, commitMs: 1 }), result = await f.evaluate();
  assert.equal(result.state, 'ready', JSON.stringify(result.decision.reasons));
  assert.equal(result.now, f.time); assert.equal(f.sourceAt, autoNow + getMs);
  assert.equal(result.decision.slotAt, iso(autoNow));
  assert.equal(f.observation.observedAt, autoNow + getMs);
  assert.deepEqual(result.decision.selected.current, f.observation);
  assert.deepEqual(result.decision.selected.auto.evidence.current, f.observation);
  assert.equal(result.decision.selected.auto.evidence.commerce[0].observedAt, iso(autoNow));
});

for (const [name, options, reason] of [
  ['genuine future current observation', { getMs: 100, afterAppend: at => at - 1 }, 'CURRENT_VALUE_UNAVAILABLE'],
  ['stale current observation after source wait', { sourceMs: 1800001 }, 'CURRENT_VALUE_UNAVAILABLE'],
  ['mapping deadline equality after source wait', { sourceMs: 100, patch: f => { f.mapping.validUntil = iso(autoNow + 100); } }, 'MAPPING_UNAVAILABLE'],
  ['delegation deadline equality during Circuit COMMIT', { commitMs: 100, patch: f => { f.policy.delegation.expiresAt = iso(autoNow + 100); } }, 'DELEGATION_UNAVAILABLE'],
  ['stale stock and sales after source wait', { sourceMs: 900001 }, 'STOCK_SALES_UNAVAILABLE'],
  ['Circuit spend expiry during read', { circuitMs: 1001 }, 'EVIDENCE_EXPIRED'],
  ['Circuit spend expiry during COMMIT', { commitMs: 1001 }, 'EVIDENCE_EXPIRED'],
  ['KST window crosses during source wait', { start: Date.parse('2026-10-05T14:59:59.999Z'), sourceMs: 1 }, 'EVIDENCE_WINDOW_CHANGED'],
  ['KST day crosses during Circuit read', { start: Date.parse('2026-10-05T14:59:59.999Z'), circuitMs: 1 }, 'EVIDENCE_EXPIRED']
]) test(`actual automation denies ${name}`, async () => {
  const f = fixture(options), result = await f.evaluate();
  assert.equal(result.state, 'blocked'); assert.ok(result.decision.reasons.includes(reason), JSON.stringify(result.decision.reasons));
  assert.equal(result.decision.allowed, false); assert.equal(result.decision.selected.current.observedAt, f.observation.observedAt);
  assert.equal(result.decision.recipe.mutation.body.dailyBudget, 800);
});

test('actual Circuit retains inclusive spend deadline and original denials without returning its private closure', async () => {
  const f = fixture({ circuitMs: 1000 }), result = await f.evaluate();
  assert.equal(result.state, 'ready');
  const circuit = new CircuitService({ clock: () => autoNow, projection: { async catchUp() { return { ready: true }; } },
    repository: { async transaction(customerId, task) { return task({ query() {} }); }, async hasBacklog() { return true; }, async unresolved() { throw new Error('denial must finish first'); } } });
  assert.deepEqual(await circuit.evaluate({ customerId: '1001', ruleId: 'r' }, context), { allowed: false, reasons: ['PROJECTION_BACKLOG'] });
});

test('actual Circuit propagates unexpected source failures instead of returning allowed', async () => {
  const failure = Object.assign(new Error('closed synthetic source failure'), { code: 'FIXTURE_UNEXPECTED_SOURCE_FAILURE' });
  const circuit = new CircuitService({ clock: () => autoNow, projection: { async catchUp() { return { ready: true }; } },
    repository: { async transaction(customerId, task) { return task({ query() {} }); }, async hasBacklog() { return false; },
      async unresolved() { return false; }, async getState() { return {}; }, async getPolicy() { throw failure; } } });
  await assert.rejects(circuit.evaluate({ customerId: '1001', ruleId: 'r' }, context), error => error === failure);
});
