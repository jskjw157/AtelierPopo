import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresCircuitRepository } from '../src/naver/searchad/circuit/postgres-repository.js';
import { CircuitService, createCircuitDispatch } from '../src/naver/searchad/circuit/service.js';
import { CircuitProjectionService } from '../src/naver/searchad/circuit/projection-service.js';
import { PostgresAccountSendFence } from '../src/naver/searchad/lifecycle/postgres-account-send-fence.js';
import { postgresCompletionFixture } from './helpers/postgres-searchad-completion-fixture.js';
for (const purpose of ['ordinary', 'lifecycle', 'canary']) test(`${purpose} final fence rejects pause committed by competitor before initiation`, async t => {
  if (!process.env.TEST_DATABASE_URL) { assert.notEqual(process.env.CI, 'true', 'CI requires native Circuit writer competitors'); return t.skip('TEST_DATABASE_URL is required'); }
  const f = await postgresCompletionFixture(t); await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id) VALUES('1001')");
  const repository = new PostgresCircuitRepository({ pool: f.pool }); const projection = new CircuitProjectionService({ repository, sources: [], clock: () => Date.now() });
  const circuit = new CircuitService({ repository, projection });
  const blocker = await f.pool.connect(); let started = 0;
  try {
    await blocker.query('BEGIN'); await blocker.query("SELECT * FROM searchad_canary_accounts WHERE customer_id='1001' FOR UPDATE");
    await blocker.query("INSERT INTO searchad_circuit_state(customer_id,manual_paused) VALUES('1001',true) ON CONFLICT(customer_id) DO UPDATE SET manual_paused=true");
    const dispatch = createCircuitDispatch({ customerId: '1001', purpose, operationKey: 'fixture', entityType: 'campaign', entityId: 'c1', actionClass: 'decrease' });
    const fence = new PostgresAccountSendFence({ pool: f.pool, fetchImpl() { started++; return new Response('{}'); } });
    const sending = fence.run('1001', () => {}, () => fence.fetch('https://api.searchad.naver.com/ncc/campaigns/c1', { method: 'PUT', headers: { 'X-Customer': '1001' }, body: '{}' }), 'PUT', { dispatch, beforeSend: (client, d) => circuit.assertDispatchAllowed(d, { client, now: Date.now() }) });
    const denied = assert.rejects(sending, { code: 'SEARCHAD_CIRCUIT_DENIED' });
    await blocker.query('COMMIT'); await denied; assert.equal(started, 0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
});
test('ordinary durable outcome append waits for the authoritative account lock before source commit', async t => {
  if (!process.env.TEST_DATABASE_URL) { assert.notEqual(process.env.CI, 'true'); return t.skip('TEST_DATABASE_URL is required'); }
  const { randomUUID } = await import('node:crypto');
  const { setTimeout } = await import('node:timers/promises');
  const { PostgresSearchAdWriteRepository } = await import('../src/naver/searchad/write/postgres-repository.js');
  const f = await postgresCompletionFixture(t); await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id) VALUES('1001')");
  const planId = randomUUID(), attemptId = randomUUID();
  const writer = new PostgresSearchAdWriteRepository({ pool: f.pool });
  await writer.createPlan({plan_id:planId,customer_id:'1001',mutation_operation_key:'fixture',mutation_json:{},read_json:{},before_json:{},before_hash:'fixture',expected_after_json:{},reason:'fixture',status:'failed',created_by:'fixture',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()});
  const blocker = await f.pool.connect(); let pending, committed = false, writerPid;
  try {
    await blocker.query('BEGIN'); await blocker.query("SELECT customer_id FROM searchad_canary_accounts WHERE customer_id='1001' FOR UPDATE");
    const sourcePool = { query: f.pool.query.bind(f.pool), async connect() { const c = await f.pool.connect(); writerPid = c.processID; return c; } };
    pending = new PostgresSearchAdWriteRepository({pool:sourcePool}).addAttempt({attempt_id:attemptId,plan_id:planId,phase:'execute',status:'failed',created_at:'2000-01-01T00:00:00Z'}).then(() => { committed = true; });
    let waiting = false;
    for (let i=0;i<200&&!waiting&&!committed;i++) {
      if (writerPid) waiting = (await f.pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[writerPid])).rows[0]?.wait_event_type === 'Lock';
      if (!waiting) await setTimeout(10);
    }
    assert.equal(waiting,true,'Primary source append must wait for account lock'); assert.equal(committed,false);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_attempts WHERE attempt_id=$1',[attemptId])).rows[0].n,0);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending; }
  assert.equal(committed,true);
});

test('missing-account ordinary source rejects even if registration and final fence race after its empty lock read', {timeout:10000}, async t=>{
  if (!process.env.TEST_DATABASE_URL) { assert.notEqual(process.env.CI,'true'); return t.skip('TEST_DATABASE_URL is required'); }
  const {randomUUID}=await import('node:crypto');
  const {PostgresSearchAdWriteRepository}=await import('../src/naver/searchad/write/postgres-repository.js');
  const f=await postgresCompletionFixture(t),planId=randomUUID(),attemptId=randomUUID();
  const writer=new PostgresSearchAdWriteRepository({pool:f.pool});
  await writer.createPlan({plan_id:planId,customer_id:'1001',mutation_operation_key:'fixture',mutation_json:{},read_json:{},before_json:{},before_hash:'fixture',expected_after_json:{},reason:'legacy planning without account',status:'planned',created_by:'fixture',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()});
  assert.equal((await writer.getPlan(planId)).status,'planned');assert.equal((await writer.listPlans({customerId:'1001'})).length,1);
  let emptyRead,resume;const reached=new Promise(resolve=>{emptyRead=resolve;}),blocked=new Promise(resolve=>{resume=resolve;});
  const sourcePool={query:f.pool.query.bind(f.pool),async connect(){const client=await f.pool.connect();return {release:()=>client.release(),async query(sql,params){const result=await client.query(sql,params);if(sql.includes('searchad_canary_accounts')&&sql.includes('FOR UPDATE')){assert.equal(result.rows.length,0);emptyRead();await blocked;}return result;}};}};
  const source=new PostgresSearchAdWriteRepository({pool:sourcePool}).addAttempt({attempt_id:attemptId,plan_id:planId,phase:'execute',status:'unknown_outcome',created_at:'2000-01-01T00:00:00Z'}).then(()=>({committed:true}),error=>({error}));
  let observed,started=0;
  try {
    await reached;
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    const repository=new PostgresCircuitRepository({pool:f.pool});
    const circuit=new CircuitService({repository,projection:new CircuitProjectionService({repository,sources:repository.sources()})});
    const dispatch=createCircuitDispatch({customerId:'1001',purpose:'ordinary',operationKey:'fixture',entityId:'other',actionClass:'mutation'});
    const fence=new PostgresAccountSendFence({pool:f.pool,fetchImpl(){started++;return new Response('{}');}});
    await fence.run('1001',()=>{},()=>fence.fetch('https://api.searchad.naver.com/ncc/campaigns/fixture',{method:'PUT',headers:{'X-Customer':'1001'},body:'{}'}),'PUT',{dispatch,async beforeSend(client,d){
      const finalValidate=await circuit.assertDispatchAllowed(d,{client});
      resume();observed=await source; // Fence still holds the newly registered account.
      return finalValidate;
    }});
  } finally {resume();await source;}
  assert.equal(observed.error?.code,'SEARCHAD_SOURCE_ACCOUNT_REQUIRED');assert.equal(started,1);
  assert.equal((await writer.listAttempts(planId)).length,0,'zero-row source cannot commit behind the final check');
});

test('ordinary primary commits require account presence; suspended account permits local source bookkeeping',async t=>{
  if(!process.env.TEST_DATABASE_URL){assert.notEqual(process.env.CI,'true');return t.skip('TEST_DATABASE_URL is required');}
  const {randomUUID}=await import('node:crypto');const {PostgresSearchAdWriteRepository}=await import('../src/naver/searchad/write/postgres-repository.js');
  const f=await postgresCompletionFixture(t),repo=new PostgresSearchAdWriteRepository({pool:f.pool}),id=randomUUID(),approvalId=randomUUID(),at=new Date().toISOString();
  await repo.createPlan({plan_id:id,customer_id:'1001',mutation_operation_key:'fixture',mutation_json:{},read_json:{},before_json:{},before_hash:'fixture',expected_after_json:{},reason:'legacy',status:'planned',created_by:'fixture',created_at:at,expires_at:new Date(Date.now()+600000).toISOString()});
  await repo.createApproval({approval_id:approvalId,plan_id:id,actor:'fixture',confirmation:'APPROVE_SEARCHAD_CHANGE',token_hash:'hash',created_at:at,expires_at:new Date(Date.now()+600000).toISOString()});
  const append=()=>repo.addAttempt({attempt_id:randomUUID(),plan_id:id,phase:'execute',status:'unknown_outcome',created_at:at});
  for(const action of [()=>repo.updatePlan(id,{status:'approved'}),()=>repo.claimApproval({planId:id,tokenHash:'hash',now:at}),append,()=>repo.claimRollbackDispatch({planId:id,attemptId:randomUUID(),now:at})])await assert.rejects(action(),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
  assert.equal((await repo.getPlan(id)).status,'planned');assert.equal((await repo.getApproval(approvalId)).used_at,null);assert.equal((await repo.listAttempts(id)).length,0);
  await assert.rejects(repo.updatePlan(randomUUID(),{status:'failed'}),{code:'SEARCHAD_CHANGE_PLAN_NOT_FOUND',status:404});
  await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',true)");
  await repo.updatePlan(id,{status:'approved'});await repo.claimApproval({planId:id,tokenHash:'hash',now:at});await append();
  assert.ok((await repo.getApproval(approvalId)).used_at);assert.equal((await repo.listAttempts(id)).length,1);
  assert.equal((await f.pool.query("SELECT suspended FROM searchad_canary_accounts WHERE customer_id='1001'")).rows[0].suspended,true);
});

test('Canary missing-account primary writes reject while read and suspended-account settlement remain available',async t=>{
  if(!process.env.TEST_DATABASE_URL){assert.notEqual(process.env.CI,'true');return t.skip('TEST_DATABASE_URL is required');}
  const {randomUUID}=await import('node:crypto');const {PostgresActiveCanaryRepository}=await import('../src/naver/searchad/canary/postgres-repository.js');
  const f=await postgresCompletionFixture(t),repo=new PostgresActiveCanaryRepository({pool:f.pool}),runId=randomUUID(),evidenceId=randomUUID(),at=new Date().toISOString();
  await repo.createEvidence({evidenceId,customerId:'1001',evidenceType:'passive_capability',specSha:'fixture',credentialFingerprint:'fixture',upstreamBaseUrl:'https://api.searchad.naver.com',result:'verified',createdAt:at,expiresAt:new Date(Date.now()+600000).toISOString()});
  const run={canaryRunId:runId,customerId:'1001',passiveEvidenceId:evidenceId,recipeId:'fixture',status:'created',startedByPrincipalId:'fixture',specSha:'fixture',credentialFingerprint:'fixture',upstreamBaseUrl:'https://api.searchad.naver.com',startedAt:at};
  await assert.rejects(repo.createRun(run),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});assert.equal(await repo.getRun(runId),null);
  // Legacy 0007 rows have no account FK; exercise that real schema possibility.
  await f.pool.query("INSERT INTO searchad_canary_runs(canary_run_id,customer_id,passive_evidence_id,recipe_id,status,started_by_principal_id,spec_sha,credential_fingerprint,upstream_base_url,started_at) VALUES($1,'1001',$2,'fixture','created','fixture','fixture','fixture','https://api.searchad.naver.com',$3)",[runId,evidenceId,at]);
  await f.pool.query("INSERT INTO searchad_canary_events(event_id,canary_run_id,customer_id,phase,status,operation_key,created_at) VALUES($1,$2,'1001','campaign_create','send_intent','fixture',$3)",[randomUUID(),runId,at]);
  const event=()=>({eventId:randomUUID(),canaryRunId:runId,customerId:'1001',phase:'campaign_create',status:'unknown_outcome',operationKey:'fixture',createdAt:at});
  for(const action of [()=>repo.updateRun(runId,{status:'unknown_outcome'}),()=>repo.addEvent(event()),()=>repo.settleMutation(runId,{status:'unknown_outcome'},event())])await assert.rejects(action(),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
  assert.equal((await repo.getRun(runId)).status,'created');assert.equal((await repo.listRuns({customerId:'1001'})).length,1);assert.equal(await repo.updateRun(randomUUID(),{status:'failed'}),null);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_canary_events WHERE canary_run_id=$1',[runId])).rows[0].n,1);
  await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',true)");
  await repo.settleMutation(runId,{status:'unknown_outcome'},event());
  assert.equal((await repo.getRun(runId)).status,'unknown_outcome');assert.equal((await repo.getAccount('1001')).suspended,true);
});
