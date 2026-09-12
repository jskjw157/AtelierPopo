BEGIN;

ALTER TABLE searchad_verification_evidence
  ADD COLUMN IF NOT EXISTS lifecycle_kinds_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE searchad_activation_grants
  ADD COLUMN IF NOT EXISTS lifecycle_kinds_json jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS searchad_hierarchy_canary_runs (
  hierarchy_run_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  recipe_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'created',
    'preflight_verified',
    'active',
    'cleanup_pending',
    'unknown_outcome',
    'manual_review',
    'failed',
    'passed'
  )),
  started_by_principal_id text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  activation_id uuid REFERENCES searchad_activation_grants(activation_id),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_error_json jsonb
);
CREATE INDEX IF NOT EXISTS searchad_hierarchy_runs_customer_started_idx
  ON searchad_hierarchy_canary_runs(customer_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS searchad_hierarchy_one_unresolved_per_customer_idx
  ON searchad_hierarchy_canary_runs(customer_id)
  WHERE status NOT IN ('failed','passed');

CREATE TABLE IF NOT EXISTS searchad_hierarchy_objects (
  hierarchy_object_id uuid PRIMARY KEY,
  hierarchy_run_id uuid NOT NULL REFERENCES searchad_hierarchy_canary_runs(hierarchy_run_id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('campaign','adgroup','keyword','creative')),
  parent_object_id uuid REFERENCES searchad_hierarchy_objects(hierarchy_object_id),
  create_operation_key text NOT NULL,
  read_operation_key text NOT NULL,
  delete_operation_key text NOT NULL,
  remote_id text,
  state text NOT NULL CHECK (state IN (
    'planned',
    'dispatching',
    'owned',
    'create_unknown',
    'delete_pending',
    'delete_unknown',
    'deleted',
    'manual_review'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS searchad_hierarchy_objects_run_idx
  ON searchad_hierarchy_objects(hierarchy_run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS searchad_hierarchy_objects_parent_idx
  ON searchad_hierarchy_objects(parent_object_id);
CREATE UNIQUE INDEX IF NOT EXISTS searchad_hierarchy_objects_customer_remote_idx
  ON searchad_hierarchy_objects(customer_id, object_type, remote_id)
  WHERE remote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS searchad_hierarchy_events (
  event_id uuid PRIMARY KEY,
  hierarchy_run_id uuid NOT NULL REFERENCES searchad_hierarchy_canary_runs(hierarchy_run_id) ON DELETE CASCADE,
  hierarchy_object_id uuid REFERENCES searchad_hierarchy_objects(hierarchy_object_id) ON DELETE SET NULL,
  customer_id text NOT NULL,
  phase text NOT NULL,
  status text NOT NULL,
  operation_key text,
  lifecycle_kind text CHECK (lifecycle_kind IS NULL OR lifecycle_kind IN ('create','batch_create','delete')),
  request_id text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_json jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS searchad_hierarchy_events_run_created_idx
  ON searchad_hierarchy_events(hierarchy_run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS searchad_hierarchy_events_customer_created_idx
  ON searchad_hierarchy_events(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS searchad_remote_object_ownership (
  ownership_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('campaign','adgroup','keyword','creative')),
  remote_id text NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('active_canary','hierarchy_canary')),
  owner_run_id text NOT NULL,
  hierarchy_object_id uuid REFERENCES searchad_hierarchy_objects(hierarchy_object_id) ON DELETE SET NULL,
  parent_hierarchy_object_id uuid REFERENCES searchad_hierarchy_objects(hierarchy_object_id) ON DELETE SET NULL,
  created_operation_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('owned','delete_unknown','deleted','manual_review')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(customer_id, object_type, remote_id)
);
CREATE INDEX IF NOT EXISTS searchad_remote_ownership_owner_idx
  ON searchad_remote_object_ownership(owner_kind, owner_run_id);
CREATE INDEX IF NOT EXISTS searchad_remote_ownership_live_idx
  ON searchad_remote_object_ownership(customer_id, object_type, remote_id)
  WHERE state IN ('owned','delete_unknown','manual_review');

CREATE TABLE IF NOT EXISTS searchad_daily_risk_capacity (
  customer_id text NOT NULL,
  risk_date date NOT NULL,
  capacity_units integer NOT NULL CHECK (capacity_units >= 0),
  reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  consumed_units integer NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (customer_id, risk_date),
  CONSTRAINT searchad_daily_risk_within_capacity CHECK (reserved_units + consumed_units <= capacity_units)
);

CREATE TABLE IF NOT EXISTS searchad_risk_reservations (
  reservation_id uuid PRIMARY KEY,
  intent_id text NOT NULL UNIQUE,
  customer_id text NOT NULL,
  risk_date date NOT NULL,
  operation_key text NOT NULL,
  lifecycle_kind text NOT NULL CHECK (lifecycle_kind IN ('create','batch_create','delete')),
  units integer NOT NULL CHECK (units > 0),
  state text NOT NULL CHECK (state IN ('reserved','consumed','released')),
  owner_kind text NOT NULL CHECK (owner_kind IN ('active_canary','hierarchy_canary')),
  owner_run_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  consumed_at timestamptz,
  released_at timestamptz,
  FOREIGN KEY (customer_id, risk_date) REFERENCES searchad_daily_risk_capacity(customer_id, risk_date)
);
CREATE INDEX IF NOT EXISTS searchad_risk_reservations_customer_date_idx
  ON searchad_risk_reservations(customer_id, risk_date, created_at ASC);
CREATE INDEX IF NOT EXISTS searchad_risk_reservations_owner_idx
  ON searchad_risk_reservations(owner_kind, owner_run_id);

DROP TRIGGER IF EXISTS searchad_hierarchy_events_immutable ON searchad_hierarchy_events;
CREATE TRIGGER searchad_hierarchy_events_immutable
BEFORE UPDATE OR DELETE ON searchad_hierarchy_events
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

COMMENT ON COLUMN searchad_verification_evidence.lifecycle_kinds_json IS
  'Exact lifecycle kinds verified by trusted Canary evidence; kept separate from mutable field scope.';
COMMENT ON COLUMN searchad_activation_grants.lifecycle_kinds_json IS
  'Immutable lifecycle create/batch_create/delete scope copied from trusted evidence.';
COMMENT ON TABLE searchad_hierarchy_canary_runs IS
  'Durable SearchAd hierarchy Canary run state; unresolved runs are unique per Customer.';
COMMENT ON TABLE searchad_hierarchy_objects IS
  'Hierarchy Canary objects; remote_id may only be populated from a successful server-observed create response.';
COMMENT ON TABLE searchad_hierarchy_events IS
  'Append-only sanitized hierarchy dispatch/read/reconcile audit events.';
COMMENT ON TABLE searchad_remote_object_ownership IS
  'Canary ownership hold preventing generic writes from mutating server-owned remote fixtures.';
COMMENT ON TABLE searchad_daily_risk_capacity IS
  'Shared per-Customer daily SearchAd side-effect risk capacity.';
COMMENT ON TABLE searchad_risk_reservations IS
  'Durable idempotent SearchAd risk reservations and consume/release state.';

COMMIT;
