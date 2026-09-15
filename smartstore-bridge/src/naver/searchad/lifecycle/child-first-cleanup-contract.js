import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { fail, record } from './postgres-campaign-create-repository.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

export const IDENTITY = Object.freeze({ specSha: 'spec_sha', credentialFingerprint: 'credential_fingerprint', upstreamBaseUrl: 'upstream_base_url' });
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const REMOTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
export const problem = (code, message, status = 409) => fail(`SEARCHAD_CHILD_CLEANUP_${code}`, message, status);
export const epoch = value => value instanceof Date ? value.getTime() : Date.parse(value);
export const active = (start, end, now) => Number.isFinite(epoch(start)) && epoch(start) <= now && Number.isFinite(epoch(end)) && epoch(end) > now;
export const dayOf = value => value instanceof Date ? value.toISOString().slice(0,10) : value;
const sameSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));

export function cleanupScope(input, context, mode) {
  const keys = ['customerId','hierarchyRunId','hierarchyObjectId', ...(mode === 'prepare' ? ['activationId'] : ['planId']), ...(mode === 'execute' ? ['executionToken','confirmation','secondConfirmation'] : [])];
  if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) problem('INPUT','Only exact local scope and separately approved credentials are accepted.',400);
  const scope = Object.fromEntries(keys.map(key => [key,input[key]]));
  if (typeof scope.customerId !== 'string' || !/^\d{1,30}$/.test(scope.customerId) || keys.filter(key => key.endsWith('Id') && key !== 'customerId').some(key => typeof scope[key] !== 'string' || !UUID.test(scope[key]))) problem('INPUT','Invalid explicit Customer or local UUID.',400);
  const p = context?.principal;
  if (!record(p) || p.role !== 'admin' || typeof p.principalId !== 'string' || !p.principalId.trim() || p.principalId !== p.principalId.trim() || !Array.isArray(p.customerIds) || !p.customerIds.includes(scope.customerId)) problem('FORBIDDEN','Authenticated Admin with explicit Customer access is required.',403);
  if (mode === 'execute') {
    if (typeof scope.executionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(scope.executionToken) || typeof scope.confirmation !== 'string' || typeof scope.secondConfirmation !== 'string') problem('INPUT','Invalid token or destructive confirmation.',400);
    scope.tokenHash = createHash('sha256').update(scope.executionToken).digest('hex'); delete scope.executionToken;
  }
  for (const key of keys) if (key.endsWith('Id') && key !== 'customerId') scope[key] = scope[key].toLowerCase();
  return Object.freeze({ ...scope, actorPrincipalId: p.principalId });
}

export function oneEvent(g, object, phase, status, operation, kind) {
  const matches = g.events.filter(e => e.hierarchy_object_id === object.hierarchy_object_id && e.phase === phase);
  const e = matches[0];
  if (matches.length !== 1 || e.customer_id !== g.run.customer_id || e.hierarchy_run_id !== g.run.hierarchy_run_id || e.status !== status || e.operation_key !== operation || e.lifecycle_kind !== kind || !record(e.details_json)) problem('PROVENANCE','One exact immutable scoped event is required.');
  return e;
}

/** Campaign/adgroup creation provenance stays byte-for-byte compatible with the bounded two-node path. */
export function creationProof(g, node, descriptor) {
  const prefix = node.object_type === 'campaign' ? '' : 'adgroup_';
  const result = oneEvent(g,node,`${prefix}create_result`,'returned_id_recorded',OPS[node.object_type].create,'create');
  const verified = oneEvent(g,node,`${prefix}create_verification`,'verified',OPS[node.object_type].create,'create');
  const plan = g.plans.find(p => p.plan_id === result.details_json.planId);
  const snapshot = { customerId:g.run.customer_id, [node.object_type === 'campaign' ? 'nccCampaignId' : 'nccAdgroupId']:node.remote_id, ...descriptor.body };
  if (!plan || plan.customer_id !== g.run.customer_id || plan.status !== 'applied' || plan.mutation_operation_key !== OPS[node.object_type].create || !equal(plan.mutation_json,descriptor) || !equal(plan.expected_after_json,descriptor.body) || !equal(plan.applied_after_json,snapshot) || plan.applied_after_hash !== contentHash(snapshot) || !equal(plan.read_json,{}) || plan.rollback_json !== null || verified.details_json.planId !== plan.plan_id || result.details_json.returnedIdRecorded !== true || verified.details_json.returnedIdRecorded !== true) problem('PROVENANCE','Target must match the existing producer plan, response ID, snapshot hash and verification.');
  if (node.object_type === 'adgroup') {
    const planned = oneEvent(g,node,'adgroup_plan','planned',OPS.adgroup.create,'create');
    const meta = { kind:'haar_adgroup_create_v1', customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, hierarchyObjectId:node.hierarchy_object_id, parentObjectId:g.root.hierarchy_object_id, parentRemoteId:g.root.remote_id, parentCreatePlanId:g.rootCreate.plan_id, parentAfterHash:g.rootCreate.applied_after_hash, activationId:planned.details_json.activationId };
    if (!equal(plan.before_json,meta) || plan.before_hash !== contentHash(meta) || planned.details_json.planId !== plan.plan_id || planned.details_json.beforeHash !== plan.before_hash || planned.details_json.requestFingerprint !== contentHash(descriptor) || result.details_json.returnedSnapshotHash !== plan.applied_after_hash) problem('PROVENANCE','Adgroup creation must retain its exact immutable parent binding.');
  } else if (!equal(plan.before_json,{}) || plan.before_hash !== contentHash({})) problem('PROVENANCE','Unexpected root creation metadata.');
  return plan;
}

/** Verify one actual bounded sibling producer result. */
export function siblingCreationProof(g) {
  const leaves = g.leaves || [];
  if (!leaves.length) return null;
  const types = [...new Set(leaves.map(node => node.object_type))];
  if (types.length !== 1 || !['keyword','creative'].includes(types[0]) || (types[0] === 'creative' && leaves.length !== 1)) problem('PROVENANCE','Only one verified sibling producer result is supported.');
  const type = types[0], kind = type === 'keyword' ? 'keywords' : 'creative';
  const lifecycle = type === 'keyword' ? 'batch_create' : 'create', operation = OPS[type].create;
  const planned = g.events.filter(event => event.phase === 'sibling_plan' && event.status === 'planned' && event.operation_key === operation && event.lifecycle_kind === lifecycle && record(event.details_json));
  if (planned.length !== 1 || planned[0].details_json.kind !== kind || !UUID.test(String(planned[0].details_json.planId || ''))) problem('PROVENANCE','One exact sibling producer plan event is required.');
  const event = planned[0], plan = g.plans.find(item => item.plan_id === event.details_json.planId);
  const objectIds = leaves.map(node => node.hierarchy_object_id);
  if (!plan || plan.customer_id !== g.run.customer_id || plan.status !== 'applied' || !sameSet(event.details_json.objectIds,objectIds)) problem('PROVENANCE','Sibling producer plan and owned leaves must agree.');
  const parent = { customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, objectType:'adgroup', state:'owned', remoteId:g.child.remote_id };
  let recipe, descriptor;
  if (type === 'keyword') {
    if (!Array.isArray(plan.mutation_json?.body) || plan.mutation_json.body.length !== leaves.length || plan.mutation_json.body.some(item => !record(item) || Object.keys(item).length !== 1 || typeof item.keyword !== 'string' || !item.keyword.trim())) problem('PROVENANCE','Keyword producer request shape is invalid.');
    recipe = createHierarchyChildRecipe({keywordTexts:plan.mutation_json.body.map(item => item.keyword)});
    descriptor = recipe.createKeywords({customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,parent});
  } else {
    const body = plan.mutation_json?.body;
    if (!record(body) || body.type !== 'TEXT_45' || !record(body.ad) || !record(body.ad.pc) || !record(body.ad.mobile)) problem('PROVENANCE','Creative producer request shape is invalid.');
    recipe = createHierarchyChildRecipe({creative:{type:'TEXT_45',headline:body.ad.headline,description:body.ad.description,pcFinal:body.ad.pc.final,mobileFinal:body.ad.mobile.final}});
    descriptor = recipe.createCreative({customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,parent});
  }
  const meta = { kind:`haar_${kind}_create_v1`, customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, parentObjectId:g.child.hierarchy_object_id, parentRemoteId:g.child.remote_id, rootObjectId:g.root.hierarchy_object_id, rootRemoteId:g.root.remote_id, activationId:event.details_json.activationId, objectIds:event.details_json.objectIds };
  const applied = leaves.map(node => ({objectType:node.object_type,remoteId:node.remote_id,parentObjectId:g.child.hierarchy_object_id}));
  const result = g.events.filter(item => item.phase === 'sibling_create_result' && item.details_json?.planId === plan.plan_id);
  const verified = g.events.filter(item => item.phase === 'sibling_create_verification' && item.details_json?.planId === plan.plan_id);
  const firstObjectId = event.details_json.objectIds[0];
  if (plan.mutation_operation_key !== operation || !equal(plan.mutation_json,descriptor) || !equal(plan.expected_after_json,descriptor.body) || !equal(plan.before_json,meta) || plan.before_hash !== contentHash(meta) || !equal(plan.applied_after_json,applied) || plan.applied_after_hash !== contentHash(applied) || plan.rollback_json !== null || event.details_json.beforeHash !== plan.before_hash || event.details_json.requestFingerprint !== contentHash(descriptor) || result.length !== 1 || verified.length !== 1 || result[0].hierarchy_object_id !== firstObjectId || verified[0].hierarchy_object_id !== firstObjectId || result[0].customer_id !== g.run.customer_id || verified[0].customer_id !== g.run.customer_id || result[0].status !== 'returned_ids_recorded' || verified[0].status !== 'verified' || result[0].operation_key !== operation || verified[0].operation_key !== operation || result[0].lifecycle_kind !== lifecycle || verified[0].lifecycle_kind !== lifecycle || result[0].details_json?.kind !== kind || verified[0].details_json?.kind !== kind || result[0].details_json?.returnedIdsRecorded !== true || result[0].details_json?.count !== leaves.length || verified[0].details_json?.readOnly !== true) problem('PROVENANCE','Sibling returned IDs and read verification must exactly match the applied producer plan.');
  return Object.freeze({plan,descriptor,kind,lifecycle,partial:false});
}

/** A partial batch never becomes ownership. It can only prove exact returned IDs for leaf-only quarantine cleanup. */
export function siblingQuarantineProof(g) {
  const leaves=g.leaves||[];
  if(leaves.length<2||leaves.some(node=>node.object_type!=='keyword'))problem('PROVENANCE','Partial quarantine cleanup supports keyword batches only.');
  const operation=OPS.keyword.create,lifecycle='batch_create',kind='keywords';
  const planned=g.events.filter(event=>event.phase==='sibling_plan'&&event.status==='planned'&&event.operation_key===operation&&event.lifecycle_kind===lifecycle&&record(event.details_json));
  if(planned.length!==1||planned[0].details_json.kind!==kind||!UUID.test(String(planned[0].details_json.planId||''))||!Array.isArray(planned[0].details_json.objectIds)||planned[0].details_json.objectIds.length!==leaves.length)problem('PROVENANCE','One exact partial sibling producer plan is required.');
  const event=planned[0],plan=g.plans.find(item=>item.plan_id===event.details_json.planId),objectIds=leaves.map(node=>node.hierarchy_object_id);
  if(!plan||plan.customer_id!==g.run.customer_id||plan.status!=='manual_review'||!sameSet(event.details_json.objectIds,objectIds))problem('PROVENANCE','Partial producer plan and local leaves must agree.');
  if(!Array.isArray(plan.mutation_json?.body)||plan.mutation_json.body.length!==leaves.length||plan.mutation_json.body.some(item=>!record(item)||Object.keys(item).length!==1||typeof item.keyword!=='string'||!item.keyword.trim()))problem('PROVENANCE','Partial keyword producer request shape is invalid.');
  const parent={customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,objectType:'adgroup',state:'owned',remoteId:g.child.remote_id};
  const recipe=createHierarchyChildRecipe({keywordTexts:plan.mutation_json.body.map(item=>item.keyword)}),descriptor=recipe.createKeywords({customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,parent});
  const meta={kind:'haar_keywords_create_v1',customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,parentObjectId:g.child.hierarchy_object_id,parentRemoteId:g.child.remote_id,rootObjectId:g.root.hierarchy_object_id,rootRemoteId:g.root.remote_id,activationId:event.details_json.activationId,objectIds:event.details_json.objectIds};
  const results=g.events.filter(item=>item.phase==='sibling_create_result'&&item.details_json?.planId===plan.plan_id),verified=g.events.filter(item=>item.phase==='sibling_create_verification'&&item.details_json?.planId===plan.plan_id);
  const result=results[0],quarantined=result?.details_json?.quarantined;
  if(plan.mutation_operation_key!==operation||!equal(plan.mutation_json,descriptor)||!equal(plan.expected_after_json,descriptor.body)||!equal(plan.before_json,meta)||plan.before_hash!==contentHash(meta)||plan.rollback_json!==null||plan.applied_at!==null||plan.applied_after_json!==null||plan.applied_after_hash!==null||event.details_json.beforeHash!==plan.before_hash||event.details_json.requestFingerprint!==contentHash(descriptor)||results.length!==1||verified.length!==0||result.hierarchy_object_id!==event.details_json.objectIds[0]||result.customer_id!==g.run.customer_id||result.status!=='partial_ids_recorded'||result.operation_key!==operation||result.lifecycle_kind!==lifecycle||result.details_json?.kind!==kind||result.details_json?.returnedIdsRecorded!==true||result.details_json?.partial!==true||!Array.isArray(quarantined)||quarantined.length<1||quarantined.length>=leaves.length||result.details_json.count!==quarantined.length)problem('PROVENANCE','Partial result must remain manual-review and bind only explicit returned IDs.');
  const indexes=new Set(),localIds=new Set(),remoteIds=new Set(),known=new Map();
  for(const item of quarantined){
    if(!record(item)||Object.keys(item).length!==3||!Number.isInteger(item.index)||item.index<0||item.index>=descriptor.body.length||typeof item.objectId!=='string'||!UUID.test(item.objectId)||typeof item.remoteId!=='string'||!REMOTE.test(item.remoteId)||indexes.has(item.index)||localIds.has(item.objectId)||remoteIds.has(item.remoteId)||!event.details_json.objectIds.includes(item.objectId))problem('PROVENANCE','Partial quarantine mapping is malformed or ambiguous.');
    const leaf=leaves.find(node=>node.hierarchy_object_id===item.objectId),hold=g.holds.find(h=>h.hierarchy_object_id===item.objectId);
    const allowed=(leaf?.state==='manual_review'&&hold?.state==='manual_review')||(leaf?.state==='delete_pending'&&hold?.state==='delete_unknown')||(leaf?.state==='delete_unknown'&&hold?.state==='delete_unknown')||(leaf?.state==='deleted'&&hold?.state==='deleted');
    if(!leaf||leaf.remote_id!==item.remoteId||leaf.parent_object_id!==g.child.hierarchy_object_id||!hold||hold.customer_id!==g.run.customer_id||hold.object_type!=='keyword'||hold.remote_id!==item.remoteId||hold.owner_kind!=='hierarchy_canary'||hold.owner_run_id!==g.run.hierarchy_run_id||hold.hierarchy_object_id!==item.objectId||hold.parent_hierarchy_object_id!==g.child.hierarchy_object_id||hold.created_operation_key!==operation||!allowed||(leaf.state==='deleted')!==Number.isFinite(epoch(leaf.deleted_at)))problem('PROVENANCE','Known partial leaf must match its immutable quarantine mapping and hold.');
    indexes.add(item.index);localIds.add(item.objectId);remoteIds.add(item.remoteId);known.set(item.objectId,item);
  }
  const unresolved=[];
  for(const leaf of leaves){
    if(known.has(leaf.hierarchy_object_id))continue;
    if(leaf.remote_id!==null||leaf.state!=='manual_review'||leaf.deleted_at!==null||g.holds.some(h=>h.hierarchy_object_id===leaf.hierarchy_object_id))problem('PROVENANCE','Unreturned partial siblings must remain unresolved without invented ownership.');
    unresolved.push(leaf.hierarchy_object_id);
  }
  const leafHolds=g.holds.filter(h=>h.object_type==='keyword');
  if(leafHolds.length!==quarantined.length)problem('PROVENANCE','Only explicitly returned partial keyword IDs may have quarantine holds.');
  return Object.freeze({plan,descriptor,kind,lifecycle,partial:true,result,quarantined:Object.freeze(quarantined.map(item=>Object.freeze({...item}))),unresolvedObjectIds:Object.freeze(event.details_json.objectIds.filter(id=>unresolved.includes(id)))});
}

export function targetDescriptor(customerId, node, kind) {
  const pathKey = {campaign:'campaignId',adgroup:'adgroupId',keyword:'nccKeywordId',creative:'adId'}[node.object_type];
  if (!pathKey) problem('GRAPH','Unsupported cleanup object type.');
  return { operationKey:OPS[node.object_type][kind], customerId, pathParams:{ [pathKey]:node.remote_id } };
}
export function cleanupMetadata(g, node, activationId) {
  if (!g.leaves?.length) {
    const create = node.object_type === 'campaign' ? g.rootCreate : g.childCreate;
    return { kind:'haar_two_node_cleanup_v1', customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, hierarchyObjectId:node.hierarchy_object_id, objectType:node.object_type, remoteId:node.remote_id,
      rootObjectId:g.root.hierarchy_object_id, rootRemoteId:g.root.remote_id, rootCreatePlanId:g.rootCreate.plan_id, rootAfterHash:g.rootCreate.applied_after_hash,
      childObjectId:g.child.hierarchy_object_id, childRemoteId:g.child.remote_id, childCreatePlanId:g.childCreate.plan_id, childAfterHash:g.childCreate.applied_after_hash,
      createPlanId:create.plan_id, activationId };
  }
  if(g.siblingCreate?.partial===true){
    return {kind:'haar_partial_quarantine_cleanup_v1',customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,hierarchyObjectId:node.hierarchy_object_id,objectType:node.object_type,remoteId:node.remote_id,
      rootObjectId:g.root.hierarchy_object_id,rootRemoteId:g.root.remote_id,rootCreatePlanId:g.rootCreate.plan_id,rootAfterHash:g.rootCreate.applied_after_hash,
      childObjectId:g.child.hierarchy_object_id,childRemoteId:g.child.remote_id,childCreatePlanId:g.childCreate.plan_id,childAfterHash:g.childCreate.applied_after_hash,
      siblingKind:'keywords',siblingCreatePlanId:g.siblingCreate.plan.plan_id,siblingBeforeHash:g.siblingCreate.plan.before_hash,partialResultEventId:g.siblingCreate.result.event_id,partialResultHash:contentHash(g.siblingCreate.result.details_json),
      quarantined:g.siblingCreate.quarantined.map(item=>({...item})),unresolvedObjectIds:[...g.siblingCreate.unresolvedObjectIds],createPlanId:g.siblingCreate.plan.plan_id,activationId};
  }
  const create = node.object_type === 'campaign' ? g.rootCreate : node.object_type === 'adgroup' ? g.childCreate : g.siblingCreate.plan;
  return { kind:'haar_extended_child_cleanup_v1', customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, hierarchyObjectId:node.hierarchy_object_id, objectType:node.object_type, remoteId:node.remote_id,
    rootObjectId:g.root.hierarchy_object_id, rootRemoteId:g.root.remote_id, rootCreatePlanId:g.rootCreate.plan_id, rootAfterHash:g.rootCreate.applied_after_hash,
    childObjectId:g.child.hierarchy_object_id, childRemoteId:g.child.remote_id, childCreatePlanId:g.childCreate.plan_id, childAfterHash:g.childCreate.applied_after_hash,
    siblingKind:g.siblingCreate.kind, siblingCreatePlanId:g.siblingCreate.plan.plan_id, siblingAfterHash:g.siblingCreate.plan.applied_after_hash,
    leafObjects:g.leaves.map(leaf => ({objectId:leaf.hierarchy_object_id,objectType:leaf.object_type,remoteId:leaf.remote_id,parentObjectId:leaf.parent_object_id})),
    createPlanId:create.plan_id, activationId };
}
export const fullTarget = (customerId,node) => `searchad:${customerId}:${node.object_type}:${node.remote_id}`;

export function cleanupBinding(g,node,planId) {
  const event = oneEvent(g,node,'tree_cleanup_plan','planned',OPS[node.object_type].delete,'delete');
  const plan = g.plans.find(p => p.plan_id === planId);
  const meta = cleanupMetadata(g,node,event.details_json.activationId);
  const mutation = targetDescriptor(g.run.customer_id,node,'delete'), read = targetDescriptor(g.run.customer_id,node,'read');
  if (!plan || event.details_json.planId !== planId || plan.customer_id !== g.run.customer_id || plan.mutation_operation_key !== mutation.operationKey || !equal(plan.mutation_json,mutation) || !equal(plan.read_json,read) || !equal(plan.before_json,meta) || plan.before_hash !== contentHash(meta) || !equal(plan.expected_after_json,{absent:true,remoteId:node.remote_id}) || plan.rollback_json !== null || event.details_json.beforeHash !== plan.before_hash || event.details_json.requestFingerprint !== contentHash(mutation)) problem('PLAN','Exact server deletion plan and immutable target binding are required.');
  return { plan,meta,mutation,read };
}

export function claimedProof(g,node,binding) {
  const intent = oneEvent(g,node,'tree_cleanup_intent','attempt_once',OPS[node.object_type].delete,'delete');
  const d = intent.details_json, plan = binding.plan;
  const approval = g.approvals.find(a => a.approval_id === d.approvalId && a.plan_id === plan.plan_id);
  const risk = g.risks.find(r => r.intent_id === d.intentId);
  if (d.planId !== plan.plan_id || d.beforeHash !== plan.before_hash || d.requestFingerprint !== contentHash(binding.mutation) || d.intentId !== `hierarchy:tree:delete:${plan.plan_id}` || !approval || approval.confirmation !== 'APPROVE_SEARCHAD_CHANGE' || !Number.isFinite(epoch(approval.used_at)) || epoch(approval.used_at) !== epoch(intent.created_at) || !active(approval.created_at,approval.expires_at,epoch(intent.created_at)) || !active(plan.created_at,plan.expires_at,epoch(intent.created_at)) || !risk || risk.customer_id !== g.run.customer_id || risk.owner_run_id !== g.run.hierarchy_run_id || risk.owner_kind !== 'hierarchy_canary' || risk.state !== 'consumed' || risk.operation_key !== OPS[node.object_type].delete || risk.lifecycle_kind !== 'delete' || risk.units !== d.riskUnits || dayOf(risk.risk_date) !== d.riskDate || epoch(risk.consumed_at) !== epoch(intent.created_at)) problem('CLAIM','A matching committed approval/risk/deletion intent is required.');
  return intent;
}

export function deletedProof(g,node) {
  const hold = g.holds.find(h => h.hierarchy_object_id === node.hierarchy_object_id);
  if (node.state !== 'deleted' || hold?.state !== 'deleted' || !Number.isFinite(epoch(node.deleted_at))) problem('CHILD_PROOF','Every managed descendant must be deletion-proven before parent cleanup.');
  const event = oneEvent(g,node,'tree_cleanup_plan','planned',OPS[node.object_type].delete,'delete');
  const binding = cleanupBinding(g,node,event.details_json.planId); claimedProof(g,node,binding);
  const absent = g.events.filter(e => e.hierarchy_object_id === node.hierarchy_object_id && e.phase === 'tree_cleanup_observation' && e.status === 'absent');
  const e = absent[0];
  if (binding.plan.status !== 'applied' || !equal(binding.plan.applied_after_json,binding.plan.expected_after_json) || binding.plan.applied_after_hash !== contentHash(binding.plan.expected_after_json) || absent.length !== 1 || e.customer_id !== g.run.customer_id || e.operation_key !== OPS[node.object_type].delete || e.lifecycle_kind !== 'delete' || e.details_json?.planId !== binding.plan.plan_id || e.details_json.beforeHash !== binding.plan.before_hash || e.details_json.remoteId !== node.remote_id || e.details_json.readOnly !== true || e.details_json.upstreamStatus !== 404 || epoch(e.created_at) !== epoch(node.deleted_at) || epoch(binding.plan.applied_at) !== epoch(node.deleted_at)) problem('CHILD_PROOF','Deleted flags alone cannot authorize parent deletion.');
  return binding;
}
