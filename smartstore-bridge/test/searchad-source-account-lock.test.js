import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { PostgresActiveCanaryRepository } from '../src/naver/searchad/canary/postgres-repository.js';

function fixture({account=null,plan=true,run=true}={}) {
  const sql=[];
  const client={async query(text){
    sql.push(text);
    if(text.includes('searchad_canary_accounts'))return {rows:account?[account]:[],rowCount:account?1:0};
    if(text.includes('searchad_write_change_plans'))return {rows:plan?[{customer_id:'1001',plan_id:'plan',status:'approved'}]:[]};
    if(text.includes('searchad_canary_runs'))return {rows:run?[{customer_id:'1001',canary_run_id:'run',status:'created'}]:[]};
    return {rows:[],rowCount:1};
  },release(){}};
  return {sql,pool:{query:client.query,async connect(){return client;}}};
}

test('ordinary source append rolls back instead of committing after locking zero account rows',async()=>{
  const f=fixture(),repo=new PostgresSearchAdWriteRepository(f);
  await assert.rejects(repo.addAttempt({attempt_id:'attempt',plan_id:'plan',phase:'execute',status:'unknown_outcome',created_at:new Date(0).toISOString()}),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
  assert.equal(f.sql.some(sql=>sql.includes('INSERT INTO searchad_write_attempts')),false);
  assert.equal(f.sql.includes('COMMIT'),false);assert.equal(f.sql.at(-1),'ROLLBACK');
});
for(const scope of [{customerId:'1001'},{canaryRunId:'run'}])test(`Canary source action requires a locked account for ${Object.keys(scope)[0]}`,async()=>{
  const f=fixture(),repo=new PostgresActiveCanaryRepository(f);let actions=0;
  await assert.rejects(repo.accountTransaction(scope,async()=>{actions++;}),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
  assert.equal(actions,0);assert.equal(f.sql.includes('COMMIT'),false);assert.equal(f.sql.at(-1),'ROLLBACK');
});
test('source locks verify exact scope while permitting present suspended accounts',async()=>{
  const wrong=fixture({account:{customer_id:'other',plan_customer_id:'1001',run_customer_id:'1001',suspended:true}});
  await assert.rejects(new PostgresSearchAdWriteRepository(wrong).accountTransaction('plan',async()=>{}),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
  await assert.rejects(new PostgresActiveCanaryRepository(wrong).accountTransaction({customerId:'1001'},async()=>{}),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
  const f=fixture({account:{customer_id:'1001',plan_customer_id:'1001',run_customer_id:'1001',suspended:true}});let actions=0;
  await new PostgresSearchAdWriteRepository(f).accountTransaction('plan',async()=>{actions++;});
  await new PostgresActiveCanaryRepository(f).accountTransaction({canaryRunId:'run'},async()=>{actions++;});
  assert.equal(actions,2);
});
test('missing plan remains 404 and missing Canary run update remains null',async()=>{
  const f=fixture({plan:false,run:false});
  await assert.rejects(new PostgresSearchAdWriteRepository(f).updatePlan('missing',{status:'failed'}),{code:'SEARCHAD_CHANGE_PLAN_NOT_FOUND',status:404});
  assert.equal(await new PostgresActiveCanaryRepository(f).updateRun('missing',{status:'failed'}),null);
});
test('neutral planning audit remains available without an account only while its owned plan is planned',async()=>{
  const f=fixture();
  const query=f.pool.query;
  f.pool.connect=async()=>({release(){},async query(sql,args){const result=await query(sql,args);if(sql.includes('searchad_write_change_plans'))result.rows=[{plan_id:'plan',customer_id:'1001',status:'planned'}];return result;}});
  await new PostgresSearchAdWriteRepository(f).addAttempt({attempt_id:'planning',plan_id:'plan',phase:'plan',status:'succeeded',created_at:new Date(0).toISOString()});
  assert.equal(f.sql.some(sql=>sql.includes('searchad_canary_accounts')),false);
  assert.ok(f.sql.some(sql=>sql.includes('INSERT INTO searchad_write_attempts')));
  await assert.rejects(new PostgresSearchAdWriteRepository(fixture()).addAttempt({attempt_id:'late-plan',plan_id:'plan',phase:'plan',status:'succeeded',created_at:new Date(0).toISOString()}),{code:'SEARCHAD_CHANGE_PLAN_STATE_CONFLICT'});
});
