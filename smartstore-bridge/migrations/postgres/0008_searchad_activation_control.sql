BEGIN;

ALTER TABLE searchad_verification_evidence
  ADD COLUMN IF NOT EXISTS details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by_principal_id text,
  ADD COLUMN IF NOT EXISTS source_request_id text;

CREATE TABLE IF NOT EXISTS searchad_activation_grants (
  activation_id uuid PRIMARY KEY,
  evidence_id text NOT NULL UNIQUE REFERENCES searchad_verification_evidence(evidence_id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('passive_capability','active_canary')),
  customer_id text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  operation_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  field_scope_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  activated_by_principal_id text NOT NULL,
  activated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS searchad_activation_grants_customer_expiry_idx
  ON searchad_activation_grants(customer_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS searchad_activation_grants_operations_gin_idx
  ON searchad_activation_grants USING gin(operation_keys_json);

CREATE TABLE IF NOT EXISTS searchad_account_state_events (
  event_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('suspend','resume')),
  actor_principal_id text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS searchad_account_state_events_customer_created_idx
  ON searchad_account_state_events(customer_id, created_at DESC);

DROP TRIGGER IF EXISTS searchad_activation_grants_immutable ON searchad_activation_grants;
CREATE TRIGGER searchad_activation_grants_immutable
BEFORE UPDATE OR DELETE ON searchad_activation_grants
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

DROP TRIGGER IF EXISTS searchad_account_state_events_immutable ON searchad_account_state_events;
CREATE TRIGGER searchad_account_state_events_immutable
BEFORE UPDATE OR DELETE ON searchad_account_state_events
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

COMMENT ON TABLE searchad_activation_grants IS 'Immutable evidence-ID SearchAd activation grants bound to Customer/spec/credential/upstream/operation/field scope.';
COMMENT ON TABLE searchad_account_state_events IS 'Append-only SearchAd Customer suspend/resume audit events bound to authenticated principals.';

COMMIT;
