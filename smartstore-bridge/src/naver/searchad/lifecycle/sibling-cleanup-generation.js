import { SearchAdWriteError } from '../write/errors.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { resolveSiblingGenerationHistory } from './sibling-generation-contract.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message) {
  throw new SearchAdWriteError('SEARCHAD_CHILD_CLEANUP_GENERATION', message, {}, 409);
}

/**
 * Evaluate the COMPLETE locked history before selecting current cleanup leaves.
 * Historical never-dispatched objects remain in g.objects/signatures/inventory
 * fences; they are not rewritten as deleted or used as remote-absence evidence.
 * Legacy generation-1 snapshots keep their existing SQL ordering and verifier.
 */
export function selectSiblingCleanupGeneration(g, now) {
  const allLeaves = g.objects.filter(o => ['keyword', 'creative'].includes(o.object_type));
  const hasGeneration = g.events.some(e => e.phase === 'sibling_plan_retired') ||
    g.plans.some(p => ['haar_keywords_create_v1', 'haar_creative_create_v1'].includes(p.before_json?.kind) && p.before_json?.generation !== undefined);
  if (!hasGeneration) return { leaves: allLeaves, retiredObjectIds: [], history: null };

  const planning = g.events.filter(e => e.phase === 'sibling_plan');
  if (!planning.length || planning.some(e => !record(e.details_json)) ||
    new Set(planning.map(e => e.details_json.kind)).size !== 1) fail('Sibling history must have one exact recipe kind.');
  const kind = planning[0].details_json.kind;
  if (!['keywords', 'creative'].includes(kind)) fail('Unsupported sibling history kind.');
  const candidate = g.plans.find(p => p.plan_id === planning[0].details_json.planId);
  if (!candidate) fail('Original sibling planning history is missing.');
  const body = candidate.mutation_json?.body;
  let descriptor;
  try {
    let recipe;
    if (kind === 'keywords') {
      if (!Array.isArray(body) || body.some(item => !record(item) || typeof item.keyword !== 'string')) throw new Error();
      recipe = createHierarchyChildRecipe({ keywordTexts: body.map(item => item.keyword) });
    } else {
      if (!record(body) || body.type !== 'TEXT_45' || !record(body.ad) || !record(body.ad.pc) || !record(body.ad.mobile)) throw new Error();
      recipe = createHierarchyChildRecipe({ creative: { type: body.type, headline: body.ad.headline,
        description: body.ad.description, pcFinal: body.ad.pc.final, mobileFinal: body.ad.mobile.final } });
    }
    const args = { customerId: g.run.customer_id, hierarchyRunId: g.run.hierarchy_run_id,
      parent: { customerId: g.run.customer_id, hierarchyRunId: g.run.hierarchy_run_id,
        objectType: 'adgroup', state: 'owned', remoteId: g.child.remote_id } };
    descriptor = kind === 'keywords' ? recipe.createKeywords(args) : recipe.createCreative(args);
  } catch { fail('The stored sibling request is not an exact supported recipe.'); }

  const history = resolveSiblingGenerationHistory({ ...g, parent: g.child,
    rootPlan: g.rootCreate, parentPlan: g.childCreate }, { kind, descriptor, now });
  if (!history.predecessor || history.active?.generation !== 2) {
    fail('A retired plan alone cannot become a cleanup target or prove remote absence.');
  }
  const leaves = history.active.objectIds.map(id => g.objects.find(o => o.hierarchy_object_id === id));
  if (leaves.some(o => !o)) fail('The current sibling batch is incomplete.');
  return { leaves, retiredObjectIds: [...history.predecessor.objectIds], history };
}
