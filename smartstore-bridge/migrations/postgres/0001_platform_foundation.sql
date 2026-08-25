BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS platform_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  namespace text NOT NULL,
  customer_scope text NOT NULL DEFAULT 'global',
  operation_type text NOT NULL,
  resource_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','interrupted','unknown_outcome','reconciling','rolled_back')),
  request_fingerprint text NOT NULL,
  request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb,
  error_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  verified_at timestamptz,
  UNIQUE (namespace, customer_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS platform_operations_status_idx
  ON platform_operations (namespace, customer_scope, status, created_at);

CREATE TABLE IF NOT EXISTS platform_approvals (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  customer_scope text NOT NULL,
  change_plan_id uuid,
  actor text NOT NULL,
  approval_state text NOT NULL CHECK (approval_state IN ('pending','approved','rejected','expired','consumed','revoked')),
  approved_before_hash text,
  approved_after_hash text,
  expires_at timestamptz,
  consumed_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  audit_id bigserial PRIMARY KEY,
  namespace text NOT NULL,
  customer_scope text NOT NULL,
  request_id text,
  actor text,
  source text,
  action text NOT NULL,
  operation_key text,
  entity_type text,
  entity_id text,
  before_hash text,
  after_hash text,
  request_fingerprint text,
  outcome text,
  remote_status integer,
  remote_error_code text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_logs_scope_idx
  ON platform_audit_logs (namespace, customer_scope, created_at DESC);

COMMIT;
