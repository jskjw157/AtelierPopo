BEGIN;

CREATE TABLE IF NOT EXISTS searchad_principals (
  principal_id text PRIMARY KEY,
  access_license_secret_ref text NOT NULL,
  secret_key_secret_ref text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  secret_rotated_at timestamptz,
  last_auth_success_at timestamptz
);

CREATE TABLE IF NOT EXISTS searchad_customer_accounts (
  customer_id text PRIMARY KEY,
  account_name text,
  manager_customer_id text,
  currency text NOT NULL DEFAULT 'KRW',
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS searchad_principal_grants (
  principal_id text NOT NULL REFERENCES searchad_principals(principal_id),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  role text NOT NULL DEFAULT 'operator',
  verified_at timestamptz,
  PRIMARY KEY (principal_id, customer_id)
);

CREATE TABLE IF NOT EXISTS searchad_spec_versions (
  spec_ref text PRIMARY KEY,
  repository text NOT NULL,
  generated_at timestamptz NOT NULL,
  source_count integer NOT NULL,
  raw_operation_count integer NOT NULL,
  runtime_operation_count integer NOT NULL,
  checksums_json jsonb NOT NULL,
  coverage_json jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS searchad_capability_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  spec_ref text NOT NULL,
  capability_key text NOT NULL,
  state text NOT NULL,
  tier text,
  evidence text NOT NULL,
  operation_key text,
  upstream_status integer,
  error_code text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, spec_ref, capability_key, checked_at)
);

CREATE INDEX IF NOT EXISTS searchad_capability_latest_idx
  ON searchad_capability_snapshots (customer_id, capability_key, checked_at DESC);

CREATE TABLE IF NOT EXISTS searchad_entity_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  entity_type text NOT NULL,
  remote_entity_id text NOT NULL,
  remote_parent_id text,
  remote_json jsonb NOT NULL,
  remote_hash text NOT NULL,
  source_operation_key text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, entity_type, remote_entity_id, remote_hash)
);

CREATE INDEX IF NOT EXISTS searchad_entity_lookup_idx
  ON searchad_entity_snapshots (customer_id, entity_type, remote_entity_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS searchad_change_plans (
  change_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  operation_key text NOT NULL,
  entity_type text,
  remote_entity_id text,
  expected_before_hash text,
  expected_after_hash text,
  before_json jsonb,
  requested_after_json jsonb,
  plan_data_cutoff_at timestamptz,
  approval_expires_at timestamptz,
  state text NOT NULL DEFAULT 'draft',
  actor text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS searchad_report_jobs (
  report_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  remote_job_id text,
  report_type text NOT NULL,
  stat_date date,
  report_created_at timestamptz,
  state text NOT NULL,
  schema_version text,
  blob_key text,
  raw_sha256 text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, remote_job_id)
);

CREATE TABLE IF NOT EXISTS searchad_report_schema_registry (
  report_type text NOT NULL,
  schema_version text NOT NULL,
  effective_from_kst timestamptz,
  effective_to_kst timestamptz,
  selection_basis text NOT NULL,
  expected_column_count integer,
  ordered_columns_json jsonb,
  source_notice text,
  source_spec_ref text,
  parser_version text NOT NULL,
  PRIMARY KEY (report_type, schema_version)
);

CREATE TABLE IF NOT EXISTS product_ad_mappings (
  mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  source_product_id text NOT NULL,
  seller_management_code text,
  origin_product_no text,
  channel_product_no text,
  remote_entity_type text NOT NULL,
  remote_entity_id text NOT NULL,
  mapping_method text NOT NULL,
  mapping_confidence numeric(5,4) NOT NULL CHECK (mapping_confidence >= 0 AND mapping_confidence <= 1),
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, source_product_id, remote_entity_type, remote_entity_id)
);

COMMIT;
