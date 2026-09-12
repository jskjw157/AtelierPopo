import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';
import { PostgresSearchAdLifecycleRepository, _internal as rows } from './postgres-repository.js';
import { assertReconcileGraph, RECONCILABLE_STATES } from './hierarchy-reconcile-service.js';

const OBSERVATIONS = new Set(['absent', 'present', 'unavailable', 'mismatch', 'no_returned_id']);
const DELETE_STATES = new Set(['delete_pending', 'delete_unknown']);
function fail(code, message, status = 409) {
  throw new SearchAdWriteError(code, message, {}, status);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
async function transaction(pool, work, readOnly = false) {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

async function rawGraph(client, scope, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  // Lock order for this reconciliation coordinator: run -> objects -> holds.
  // Future dispatch must adopt compatible locking; this is NOT a dispatch gate.
  const result = await client.query(
    `SELECT *, xmin::text AS row_version FROM searchad_hierarchy_canary_runs
     WHERE hierarchy_run_id=$1 AND customer_id=$2${suffix}`,
    [scope.hierarchyRunId, scope.customerId]
  );
  if (!result.rows[0]) return null;
  // A scoped run is already selected. Include malformed cross-Customer children
  // in its graph so validation cannot silently ignore legacy raw-store mistakes.
  const objects = await client.query(
    `SELECT *, xmin::text AS row_version FROM searchad_hierarchy_objects
     WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id${suffix}`, [scope.hierarchyRunId]
  );
  const ownerships = await client.query(
    `SELECT *, xmin::text AS row_version FROM searchad_remote_object_ownership
     WHERE owner_kind='hierarchy_canary' AND owner_run_id=$1 ORDER BY ownership_id${suffix}`, [scope.hierarchyRunId]
  );
  if (!objects.rows.some(row => row.hierarchy_object_id === scope.hierarchyObjectId)) return null;
  return { run: result.rows[0], objects: objects.rows, ownerships: ownerships.rows };
}
function signature(graph) {
  return JSON.stringify([
    [graph.run.hierarchy_run_id, graph.run.row_version],
    graph.objects.map(row => [row.hierarchy_object_id, row.row_version]),
    graph.ownerships.map(row => [row.ownership_id, row.row_version])
  ]);
}
function view(graph, targetId) {
  return { run: rows.runRow(graph.run), objects: graph.objects.map(rows.objectRow),
    ownerships: graph.ownerships.map(rows.ownershipRow), targetId };
}

/** Transactional LOCAL observation settlement. Contains no upstream dispatcher. */
export class PostgresHierarchyReconcileRepository {
  #snapshots = new WeakMap();

  constructor({ pool } = {}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function') throw new TypeError('A real PostgreSQL pool is required');
    this.pool = pool;
  }

  async loadSnapshot(scope) {
    return transaction(this.pool, async client => {
      const graph = await rawGraph(client, scope);
      if (!graph) return null;
      const snapshot = freeze(view(graph, scope.hierarchyObjectId));
      this.#snapshots.set(snapshot, { scope: { ...scope }, signature: signature(graph) });
      return snapshot;
    }, true);
  }

  async recordObservation(snapshot, observation) {
    const receipt = this.#snapshots.get(snapshot);
    if (!receipt || !observation || typeof observation !== 'object' ||
        Object.keys(observation).some(key => !['kind', 'observedAt'].includes(key)) ||
        !OBSERVATIONS.has(observation.kind) || typeof observation.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(observation.observedAt))) {
      fail('SEARCHAD_HIERARCHY_RECONCILE_OBSERVATION_INVALID', 'An issued repository snapshot and bounded observation are required.', 400);
    }
    return transaction(this.pool, async client => {
      const graph = await rawGraph(client, receipt.scope, true);
      if (!graph || signature(graph) !== receipt.signature) {
        fail('SEARCHAD_HIERARCHY_RECONCILE_STALE', 'Hierarchy state changed during the read. Reconcile again without replaying a mutation.');
      }
      const current = view(graph, receipt.scope.hierarchyObjectId);
      const { object } = assertReconcileGraph(current);
      if (!RECONCILABLE_STATES.includes(object.state)) {
        fail('SEARCHAD_HIERARCHY_RECONCILE_STALE', 'The object no longer has a reconcilable state.');
      }
      const { kind, observedAt } = observation;
      if ((kind === 'no_returned_id') !== (object.remoteId === null || object.remoteId === undefined)) {
        fail('SEARCHAD_HIERARCHY_RECONCILE_OBSERVATION_INVALID', 'Observation does not match persisted returned-ID availability.');
      }
      const deleting = DELETE_STATES.has(object.state);
      let state = object.state;
      if (kind !== 'unavailable') {
        state = deleting && kind === 'absent' ? 'deleted' : deleting && kind === 'present' ? 'delete_unknown' : 'manual_review';
      }
      if (state === 'deleted') {
        // Do not scope away malformed cross-run/Customer children in legacy data.
        const children = await client.query(
          "SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE parent_object_id=$1 AND state <> 'deleted' LIMIT 1",
          [object.hierarchyObjectId]
        );
        if (children.rows.length) fail('SEARCHAD_HIERARCHY_RECONCILE_LIVE_CHILDREN', 'A parent with live children cannot be settled as deleted.');
      }

      const storage = new PostgresSearchAdLifecycleRepository({ pool: client });
      let runStatus = current.run.status;
      if (kind !== 'unavailable') {
        const patch = { state, updatedAt: observedAt };
        if (state === 'deleted') patch.deletedAt = observedAt;
        await storage.updateObject(object.hierarchyObjectId, patch, current.run.customerId);
        const hold = current.ownerships.find(o => o.hierarchyObjectId === object.hierarchyObjectId);
        if (hold) await storage.updateOwnership(hold.ownershipId, { state, updatedAt: observedAt }, current.run.customerId);
        const remaining = current.objects.filter(o => o.hierarchyObjectId !== object.hierarchyObjectId && o.state !== 'deleted');
        runStatus = state === 'manual_review' || remaining.some(o => o.state === 'manual_review') ? 'manual_review' :
          state === 'delete_unknown' || remaining.some(o => RECONCILABLE_STATES.includes(o.state)) ? 'unknown_outcome' : 'cleanup_pending';
        // Even if all objects are locally deleted, never manufacture Canary PASS
        // or activation evidence from a GET/404 alone.
        await storage.updateRun(current.run.hierarchyRunId, { status: runStatus }, current.run.customerId);
      }
      await storage.addEvent({ eventId: randomUUID(), hierarchyRunId: current.run.hierarchyRunId,
        hierarchyObjectId: object.hierarchyObjectId, customerId: current.run.customerId,
        phase: 'reconcile_read', status: state === 'deleted' ? 'deleted_verified' : `observed_${kind}`,
        operationKey: object.readOperationKey, lifecycleKind: null, requestId: null, error: null,
        details: { readOnly: true, observation: kind, previousState: object.state, state,
          returnedIdOnly: kind !== 'no_returned_id' }, createdAt: observedAt });
      // No approval, activation, risk reserve/consume/release, or remote-ID write.
      return { hierarchyRunId: current.run.hierarchyRunId, hierarchyObjectId: object.hierarchyObjectId,
        kind, state, previousState: object.state, runStatus, changed: state !== object.state };
    });
  }
}
