import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDescendantInventory } from '../src/naver/searchad/lifecycle/descendant-inventory-scan.js';

const KEYWORDS='ncc.get.get_by_adgroup_id_using_get_1__p_ncc_keywords__q_base_search_id_ncc_adgroup_id_record_size_selector';
const GROUPS='ncc.get.get_groups_using_get_2__p_ncc_adgroups__q_base_search_id_ncc_campaign_id_record_size_selector';
const ADS='ncc.get.get_by_adgroup_id_using_get__p_ncc_ads__q_ncc_adgroup_id';
const keywordScope={customerId:'1001',parentType:'adgroup',parentRemoteId:'grp-1',childType:'keyword'};
const envelope=(operationKey,data)=>({operation:{operationKey,sideEffect:false},upstream:{status:200},data});
const kw=id=>({customerId:'1001',nccAdgroupId:'grp-1',nccKeywordId:id});
const safe=async()=>{};
const options=(read,scope=keywordScope)=>({scope,read,assertCurrent:safe});

// Replacing the last-returned-ID cursor with a parent ID, or treating a short
// page as the end, must fail this test.
test('walks short pages with NEXT and the exact last returned child ID',async()=>{
  const calls=[],pages=[[kw('kw-z'),kw('kw-a')],[kw('kw-b')],[]];
  const result=await scanDescendantInventory(options(async descriptor=>{
    calls.push(structuredClone(descriptor));return envelope(KEYWORDS,pages.shift());
  }));
  assert.deepEqual(calls,[
    {operationKey:KEYWORDS,customerId:'1001',query:{nccAdgroupId:'grp-1',recordSize:1000}},
    {operationKey:KEYWORDS,customerId:'1001',query:{nccAdgroupId:'grp-1',recordSize:1000,baseSearchId:'kw-a',selector:'NEXT'}},
    {operationKey:KEYWORDS,customerId:'1001',query:{nccAdgroupId:'grp-1',recordSize:1000,baseSearchId:'kw-b',selector:'NEXT'}}
  ]);
  assert.deepEqual(result,{kind:'present_remote_descendants',count:3,remoteIds:['kw-z','kw-a','kw-b'],completeAbsence:false,
    scan:{requests:3,acceptedPages:3,termination:'empty_page_observed',snapshotConsistency:'unproven'}});
});

test('campaign scans use returned adgroup IDs, never the campaign ID',async()=>{
  const scope={customerId:'1001',parentType:'campaign',parentRemoteId:'cmp-1',childType:'adgroup'},calls=[];
  const result=await scanDescendantInventory(options(async descriptor=>{
    calls.push(descriptor);return envelope(GROUPS,calls.length===1?[{customerId:'1001',nccCampaignId:'cmp-1',nccAdgroupId:'grp-a'}]:[]);
  },scope));
  assert.deepEqual(calls[1].query,{nccCampaignId:'cmp-1',recordSize:1000,baseSearchId:'grp-a',selector:'NEXT'});
  assert.equal(result.scan.termination,'empty_page_observed');assert.equal(result.completeAbsence,false);
});

test('creative scans make one non-paginated request without invented cursor parameters',async()=>{
  const scope={...keywordScope,childType:'creative'},calls=[];
  const result=await scanDescendantInventory(options(async descriptor=>{
    calls.push(descriptor);return envelope(ADS,[{customerId:'1001',nccAdgroupId:'grp-1',nccAdId:'ad-a'}]);
  },scope));
  assert.deepEqual(calls,[{operationKey:ADS,customerId:'1001',query:{nccAdgroupId:'grp-1'}}]);
  assert.equal(result.scan.termination,'single_response_observed');assert.equal(result.completeAbsence,false);
});

test('an empty first page is still empty_unproven, including for creatives',async()=>{
  for(const scope of [keywordScope,{...keywordScope,childType:'creative'}]){
    const result=await scanDescendantInventory(options(async()=>envelope(scope.childType==='keyword'?KEYWORDS:ADS,[]),scope));
    assert.equal(result.kind,'empty_unproven');assert.equal(result.count,0);assert.equal(result.completeAbsence,false);
    assert.equal(result.scan.requests,1);assert.equal(result.scan.snapshotConsistency,'unproven');
  }
});

test('a repeated ID in any later page stops the scan without accepting that page',async()=>{
  let reads=0;
  const result=await scanDescendantInventory(options(async()=>envelope(KEYWORDS,++reads===1?[kw('kw-a')]:[kw('kw-b'),kw('kw-a')])));
  assert.equal(reads,2);assert.deepEqual(result.remoteIds,['kw-a']);
  assert.equal(result.scan.termination,'repeated_id');assert.equal(result.scan.acceptedPages,1);assert.equal(result.completeAbsence,false);
});

test('ten non-empty pages hit the fixed request budget without pretending exhaustion',async()=>{
  let reads=0;
  const result=await scanDescendantInventory(options(async()=>envelope(KEYWORDS,[kw(`kw-${++reads}`)])));
  assert.equal(reads,10);assert.equal(result.count,10);assert.equal(result.scan.termination,'request_limit');
  assert.equal(result.scan.acceptedPages,10);assert.equal(result.completeAbsence,false);
});

test('later read failure retains prior observed presence and never retries',async()=>{
  let reads=0;
  const result=await scanDescendantInventory(options(async()=>{
    if(++reads===2)throw new Error('private-key-and-upstream-body');return envelope(KEYWORDS,[kw('kw-a')]);
  }));
  assert.equal(reads,2);assert.deepEqual(result.remoteIds,['kw-a']);assert.equal(result.kind,'present_remote_descendants');
  assert.equal(result.scan.termination,'read_unavailable');assert.equal(JSON.stringify(result).includes('private-key'),false);
});

test('malformed or cross-scope pages are rejected without accepting partial page contents',async()=>{
  for(const invalid of [
    envelope(KEYWORDS,[kw('kw-a'),{...kw('kw-b'),customerId:'other'}]),
    envelope(KEYWORDS,[{...kw('kw-a'),nccAdgroupId:'grp-other'}]),
    envelope(KEYWORDS,[kw('kw-a'),kw('kw-a')]),
    envelope(KEYWORDS,Array.from({length:1001},(_,i)=>kw(`kw-${i}`))),
    envelope(KEYWORDS,[kw(123)]),envelope(KEYWORDS,[kw(' kw-a ')]),envelope(ADS,[]),null
  ]){
    const result=await scanDescendantInventory(options(async()=>invalid));
    assert.equal(result.kind,'unresolved');assert.deepEqual(result.remoteIds,[]);
    assert.equal(result.scan.termination,'invalid_page');assert.equal(result.scan.acceptedPages,0);
  }
});

test('caller scope cannot seed a cursor or change operation, query, or page size',async()=>{
  let reads=0;
  for(const extra of [{baseSearchId:'kw-victim'},{selector:'PREVIOUS'},{recordSize:1},{operationKey:ADS},{query:{}}]){
    await assert.rejects(scanDescendantInventory(options(async()=>{reads++;return envelope(KEYWORDS,[]);},{...keywordScope,...extra})));
  }
  assert.equal(reads,0);
});

test('identity checks surround every page and a changed identity is not swallowed as a read outage',async()=>{
  let checks=0,reads=0;
  const drift=new Error('identity changed');
  await assert.rejects(scanDescendantInventory({...options(async()=>{reads++;return envelope(KEYWORDS,[kw('kw-a')]);}),
    assertCurrent:async()=>{if(++checks===2)throw drift;}}),error=>error===drift);
  assert.equal(reads,1);assert.equal(checks,2);
});

test('every page uses an immutable fresh descriptor and a caller scope change cannot redirect a later read',async()=>{
  const scope={...keywordScope},calls=[];
  const result=await scanDescendantInventory(options(async descriptor=>{
    calls.push(descriptor);assert.ok(Object.isFrozen(descriptor));assert.ok(Object.isFrozen(descriptor.query));
    scope.parentRemoteId='grp-victim';
    return envelope(KEYWORDS,calls.length===1?[kw('kw-a')]:[]);
  },scope));
  assert.equal(calls[1].query.nccAdgroupId,'grp-1');assert.equal(result.scan.acceptedPages,2);
});

test('stored scan metadata rejects forged completion, bounds, raw cursors and inconsistent counts',async()=>{
  const {validateInventoryScan}=await import('../src/naver/searchad/lifecycle/descendant-inventory-scan.js');
  const valid={requests:2,acceptedPages:2,termination:'empty_page_observed',snapshotConsistency:'unproven'};
  assert.deepEqual(validateInventoryScan(valid,1,'keyword'),valid);
  for(const bad of [{...valid,completeAbsence:true},{...valid,snapshotConsistency:'proven'},{...valid,requests:11},
    {...valid,acceptedPages:3},{...valid,baseSearchId:'kw-a'},{...valid,termination:'complete'},
    {...valid,termination:'request_limit'}])assert.throws(()=>validateInventoryScan(bad,1,'keyword'));
  assert.throws(()=>validateInventoryScan(valid,1001,'keyword'));
  assert.throws(()=>validateInventoryScan(valid,1,'creative'));
});
