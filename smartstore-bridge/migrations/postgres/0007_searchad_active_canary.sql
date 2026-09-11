BEGIN;

CREATE TABLE IF NOT EXISTS searchad_canary_accounts (
  customer_id text PRIMARY KEY,
  suspended boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS searchad_verification_evidence (
  evidence_id text PRIMARY KEY,
  evidence_type text NOT NULL CHECK (evidence_type IN ('passive_capability','active_canary')),
  customer_id text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  operation_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  field_scope_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  result text NOT NULL,
  source_run_id text,
  recipe_id text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS searchad_verification_evidence_customer_idx
  ON searchad_verification_evidence(customer_id, evidence_type, expires_at DESC);

CREATE TABLE IF NOT EXISTS searchad_canary_runs (
  canary_run_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  passive_evidence_id text NOT NULL REFERENCES searchad_verification_evidence(evidence_id),
  recipe_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'created','preflight_verified','campaign_create_sent','campaign_verified_off',
    'mutation_test_sent','mutation_verified','rollback_verified','cleanup_pending',
    'cleanup_required','cleanup_unknown_outcome','spend_check_pending','spend_detected',
    'unknown_outcome','blocked','failed','expired','passed'
  )),
  started_by_principal_id text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  verified_operation_scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  before_spend numeric,
  after_spend numeric,
  spend_delta numeric,
  remote_id text,
  cleanup_verified_at timestamptz,
  evidence_id text REFERENCES searchad_verification_evidence(evidence_id),
  completed_at timestamptz,
  last_error_json jsonb
);
CREATE INDEX IF NOT EXISTS searchad_canary_runs_customer_started_idx
  ON searchad_canary_runs(customer_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS searchad_canary_one_active_per_customer_idx
  ON searchad_canary_runs(customer_id)
  WHERE status NOT IN ('passed','failed','blocked','spend_detected','expired');

CREATE TABLE IF NOT EXISTS searchad_canary_objects (
  canary_run_id uuid NOT NULL REFERENCES searchad_canary_runs(canary_run_id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  object_type text NOT NULL,
  remote_id text NOT NULL,
  cleanup_status text NOT NULL,
  created_at timestamptz NOT NULL,
  cleaned_at timestamptz,
  PRIMARY KEY (canary_run_id, remote_id)
);
CREATE INDEX IF NOT EXISTS searchad_canary_objects_customer_remote_idx
  ON searchad_canary_objects(customer_id, remote_id);

CREATE TABLE IF NOT EXISTS searchad_canary_events (
  event_id uuid PRIMARY KEY,
  canary_run_id uuid NOT NULL REFERENCES searchad_canary_runs(canary_run_id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  phase text NOT NULL,
  status text NOT NULL,
  operation_key text,
  request_id text,
  error_json jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS searchad_canary_events_run_created_idx
  ON searchad_canary_events(canary_run_id, created_at ASC);

CREATE OR REPLACE FUNCTION searchad_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable SearchAd verification/audit record cannot be changed' USING ERRCODE='P0001';
END;
$$;

DROP TRIGGER IF EXISTS searchad_verification_evidence_immutable ON searchad_verification_evidence;
CREATE TRIGGER searchad_verification_evidence_immutable
BEFORE UPDATE OR DELETE ON searchad_verification_evidence
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

DROP TRIGGER IF EXISTS searchad_canary_events_immutable ON searchad_canary_events;
CREATE TRIGGER searchad_canary_events_immutable
BEFORE UPDATE OR DELETE ON searchad_canary_events
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

COMMENT ON TABLE searchad_verification_evidence IS 'Immutable Passive Capability and Active Canary verification evidence, scoped to Customer/spec/credential/upstream/operation fields.';
COMMENT ON TABLE searchad_canary_runs IS 'Durable Active Canary state; one unresolved run per SearchAd Customer.';
COMMENT ON TABLE searchad_canary_objects IS 'Returned-ID-only Canary objects and cleanup state.';
COMMENT ON TABLE searchad_canary_events IS 'Append-only Active Canary mutation/read audit events.';

COMMIT;
