import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';
import { contentHash } from '../write/canonical.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { PostgresSearchAdLifecycleRepository, _internal as rows } from './postgres-repository.js';
import { buildDescendantInventoryDescriptor } from './descendant-inventory-contract.js';

const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const OBSERVATIONS = new Set(['present_remote_descendants', 'empty_unproven', 'unresolved']);
const RUN_STATES = new Set(['cleanup_pending', 'manual_review']);
const PARENT = Object.freeze({ campaign: null, adgroup: 'campaign', keyword: 'adgroup', creative: 'adgroup' });

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
  } finally {
    client.release();
  }
}

async function rawGraph(client, scope, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const run = await client.query(
    `SELECT *, xmin::text AS row_version FROM searchad_hierarchy_canary_runs
     WHERE hierarchy_run_id=$1 AND customer_id=$2${suffix}`,
    [scope.hierarchyRunId, scope.customerId]
  );
  if (!run.rows[0]) return null;

  const objects = await client.query(
    `SELECT *, xmin::text AS row_version FROM searchad_hierarchy_objects
     WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id${suffix}`,
    [scope.hierarchyRunId]
  );
  const ownerships = await client.query(
    `SELECT *, xmin::text AS row_version FROM searchad_remote_object_ownership
     WHERE owner_kind='hierarchy_canary' AND owner_run_id=$1 ORDER BY ownership_id${suffix}`,
    [scope.hierarchyRunId]
  );
  const events = await client.query(
    'SELECT count(*)::bigint AS event_count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1',
    [scope.hierarchyRunId]
  );

  if (!objects.rows.some(row => row.hierarchy_object_id === scope.parentObjectId)) return null;

  return {
    run: run.rows[0],
    objects: objects.rows,
    ownerships: ownerships.rows,
    eventCount: String(events.rows[0]?.event_count ?? '0')
  };
}

function signature(graph) {
  return JSON.stringify([
    [graph.run.hierarchy_run_id, graph.run.row_version],
    graph.objects.map(row => [row.hierarchy_object_id, row.row_version]),
    graph.ownerships.map(row => [row.ownership_id, row.row_version]),
    graph.eventCount
  ]);
}

function view(graph, scope) {
  return {
    run: rows.runRow(graph.run),
    objects: graph.objects.map(rows.objectRow),
    ownerships: graph.ownerships.map(rows.ownershipRow),
    parentObjectId: scope.parentObjectId,
    childType: scope.childType
  };
}

function validRemoteId(value) {
  return typeof value === 'string' && REMOTE_ID.test(value);
}

function matchingHold(snapshot, object) {
  const holds = snapshot.ownerships.filter(item => item.hierarchyObjectId === object.hierarchyObjectId);

  if (object.remoteId == null) {
    if (holds.length !== 0) {
      fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'An object without a returned ID must not have an ownership hold.');
    }
    return null;
  }

  if (holds.length !== 1) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Persisted returned IDs require exactly one ownership hold.');
  }

  const hold = holds[0];
  if (hold.customerId !== snapshot.run.customerId ||
      hold.objectType !== object.objectType ||
      hold.remoteId !== object.remoteId ||
      hold.ownerKind !== 'hierarchy_canary' ||
      hold.ownerRunId !== snapshot.run.hierarchyRunId ||
      hold.parentHierarchyObjectId !== object.parentObjectId ||
      hold.createdOperationKey !== object.createOperationKey) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Ownership does not match the persisted hierarchy object.');
  }

  return hold;
}

function assertInventoryGraph(snapshot) {
  if (!snapshot?.run || !Array.isArray(snapshot.objects) || !Array.isArray(snapshot.ownerships)) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Persisted hierarchy graph is incomplete.');
  }
  if (!RUN_STATES.has(snapshot.run.status) || snapshot.run.completedAt !== null) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Inventory requires an active cleanup or manual-review hierarchy run.');
  }

  const byId = new Map();
  for (const object of snapshot.objects) {
    if (!object || byId.has(object.hierarchyObjectId) ||
        object.customerId !== snapshot.run.customerId ||
        object.hierarchyRunId !== snapshot.run.hierarchyRunId ||
        !Object.hasOwn(OPS, object.objectType)) {
      fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Hierarchy object scope is invalid.');
    }

    const operations = OPS[object.objectType];
    if (object.createOperationKey !== operations.create ||
        object.readOperationKey !== operations.read ||
        object.deleteOperationKey !== operations.delete) {
      fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Hierarchy operation binding is invalid.');
    }

    if (object.remoteId != null && !validRemoteId(object.remoteId)) {
      fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Persisted remote ID is not a safe opaque string.');
    }

    byId.set(object.hierarchyObjectId, object);
  }

  for (const ownership of snapshot.ownerships) {
    if (ownership.customerId !== snapshot.run.customerId ||
        ownership.ownerKind !== 'hierarchy_canary' ||
        ownership.ownerRunId !== snapshot.run.hierarchyRunId ||
        !validRemoteId(ownership.remoteId) ||
        !byId.has(ownership.hierarchyObjectId)) {
      fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Hierarchy ownership scope is invalid.');
    }
  }

  for (const object of snapshot.objects) {
    const expectedParentType = PARENT[object.objectType];
    if (expectedParentType === null) {
      if (object.parentObjectId !== null) {
        fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Campaign parent relationship is invalid.');
      }
    } else {
      const parent = byId.get(object.parentObjectId);
      if (!parent || parent.objectType !== expectedParentType) {
        fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'Hierarchy parent relationship is invalid.');
      }
    }
    matchingHold(snapshot, object);
  }

  const parent = byId.get(snapshot.parentObjectId);
  if (!parent || !['campaign', 'adgroup'].includes(parent.objectType) ||
      parent.state !== 'owned' || parent.deletedAt !== null || !validRemoteId(parent.remoteId)) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'A verified owned parent is required.');
  }

  const parentHold = matchingHold(snapshot, parent);
  if (parentHold?.state !== 'owned') {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'The selected parent ownership hold must remain owned.');
  }

  if (parent.objectType === 'adgroup') {
    const campaign = byId.get(parent.parentObjectId);
    const campaignHold = campaign ? matchingHold(snapshot, campaign) : null;
    if (!campaign || campaign.objectType !== 'campaign' ||
        campaign.state !== 'owned' || campaign.deletedAt !== null ||
        !validRemoteId(campaign.remoteId) || campaignHold?.state !== 'owned') {
      fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'A verified owned campaign ancestor is required.');
    }
  }

  let descriptor;
  try {
    descriptor = buildDescendantInventoryDescriptor({
      customerId: snapshot.run.customerId,
      parentType: parent.objectType,
      parentRemoteId: parent.remoteId,
      childType: snapshot.childType
    });
  } catch {
    fail('SEARCHAD_DESCENDANT_INVENTORY_GRAPH_INVALID', 'The selected parent-child inventory relation is unsupported.');
  }

  return { parent, descriptor };
}

function observationInput(observation) {
  const keys = ['kind', 'count', 'remoteIds', 'completeAbsence', 'observedAt'];
  if (!observation || typeof observation !== 'object' || Array.isArray(observation) ||
      Object.keys(observation).length !== keys.length ||
      Object.keys(observation).some(key => !keys.includes(key)) ||
      !OBSERVATIONS.has(observation.kind) ||
      !Number.isInteger(observation.count) || observation.count < 0 ||
      !Array.isArray(observation.remoteIds) || observation.remoteIds.length !== observation.count ||
      observation.completeAbsence !== false ||
      typeof observation.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(observation.observedAt))) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_OBSERVATION_INVALID', 'A bounded inventory observation is required.', 400);
  }

  const ids = observation.remoteIds.map(id => String(id));
  if (new Set(ids).size !== ids.length ||
      ids.some(id => !validRemoteId(id)) ||
      (observation.kind === 'present_remote_descendants') !== (ids.length > 0) ||
      (observation.kind !== 'present_remote_descendants' && ids.length !== 0)) {
    fail('SEARCHAD_DESCENDANT_INVENTORY_OBSERVATION_INVALID', 'Inventory observation IDs are invalid.', 400);
  }

  return { ...observation, remoteIds: ids };
}

/**
 * Persists read-only descendant inventory as one immutable sanitized hierarchy
 * event. It never mutates hierarchy, ownership, plan, approval, risk or attempt
 * state and never emits cleanup authority.
 */
export class PostgresDescendantInventoryRepository {
  #snapshots = new WeakMap();

  constructor({ pool } = {}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function') {
      throw new TypeError('A real PostgreSQL pool is required');
    }
    this.pool = pool;
  }

  async loadSnapshot(scope) {
    return transaction(this.pool, async client => {
      const graph = await rawGraph(client, scope);
      if (!graph) return null;

      const base = view(graph, scope);
      const { parent, descriptor } = assertInventoryGraph(base);

      const snapshot = freeze({
        ...base,
        parentType: parent.objectType,
        parentRemoteId: parent.remoteId,
        operationKey: descriptor.operationKey
      });

      this.#snapshots.set(snapshot, {
        scope: { ...scope },
        signature: signature(graph),
        parentType: parent.objectType,
        parentRemoteId: parent.remoteId,
        operationKey: descriptor.operationKey
      });

      return snapshot;
    }, true);
  }

  async recordObservation(snapshot, rawObservation) {
    const receipt = this.#snapshots.get(snapshot);
    if (!receipt) {
      fail('SEARCHAD_DESCENDANT_INVENTORY_OBSERVATION_INVALID', 'An issued repository snapshot is required.', 400);
    }

    const observation = observationInput(rawObservation);

    return transaction(this.pool, async client => {
      const graph = await rawGraph(client, receipt.scope, true);
      if (!graph || signature(graph) !== receipt.signature) {
        fail('SEARCHAD_DESCENDANT_INVENTORY_STALE', 'Hierarchy state changed during the inventory read.');
      }

      const current = view(graph, receipt.scope);
      const { parent, descriptor } = assertInventoryGraph(current);
      if (parent.objectType !== receipt.parentType ||
          parent.remoteId !== receipt.parentRemoteId ||
          descriptor.operationKey !== receipt.operationKey) {
        fail('SEARCHAD_DESCENDANT_INVENTORY_STALE', 'Parent identity or inventory relation changed during the remote read.');
      }

      const storage = new PostgresSearchAdLifecycleRepository({ pool: client });
      await storage.addEvent({
        eventId: randomUUID(),
        hierarchyRunId: current.run.hierarchyRunId,
        hierarchyObjectId: parent.hierarchyObjectId,
        customerId: current.run.customerId,
        phase: 'descendant_inventory',
        status: `observed_${observation.kind}`,
        operationKey: descriptor.operationKey,
        lifecycleKind: null,
        requestId: null,
        error: null,
        details: {
          readOnly: true,
          parentType: parent.objectType,
          childType: receipt.scope.childType,
          observation: observation.kind,
          count: observation.count,
          completeAbsence: false,
          remoteIdsHash: contentHash([...observation.remoteIds].sort()),
          localMapping: false,
          cleanupAuthority: false
        },
        createdAt: observation.observedAt
      });

      return {
        hierarchyRunId: current.run.hierarchyRunId,
        parentObjectId: parent.hierarchyObjectId,
        parentType: parent.objectType,
        childType: receipt.scope.childType,
        kind: observation.kind,
        count: observation.count,
        remoteIds: [...observation.remoteIds],
        completeAbsence: false,
        changed: false
      };
    });
  }
}

export const _internal = { assertInventoryGraph, observationInput };
