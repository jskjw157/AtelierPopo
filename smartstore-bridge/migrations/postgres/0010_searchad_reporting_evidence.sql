BEGIN;

CREATE TABLE IF NOT EXISTS searchad_stats_observations (
  observation_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  entity_id text NOT NULL,
  entity_type text,
  operation_key text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  since_date date NOT NULL,
  until_date date NOT NULL,
  fields_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  time_increment text NOT NULL CHECK (time_increment IN ('1','allDays')),
  breakdown text,
  raw_response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_response_sha256 text NOT NULL CHECK (length(raw_response_sha256)=64),
  sales_amt_krw numeric CHECK (sales_amt_krw IS NULL OR sales_amt_krw >= 0),
  vat_basis text NOT NULL DEFAULT 'VAT_INCLUDED' CHECK (vat_basis='VAT_INCLUDED'),
  cycle_base_tm text,
  observed_at timestamptz NOT NULL,
  source_request_id text,
  validity text NOT NULL CHECK (validity IN ('valid','missing','malformed','stale')),
  CHECK (until_date >= since_date)
);
CREATE INDEX IF NOT EXISTS searchad_stats_observations_customer_entity_idx
  ON searchad_stats_observations(customer_id, entity_id, until_date DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS searchad_stats_observations_customer_validity_idx
  ON searchad_stats_observations(customer_id, validity, observed_at DESC);

CREATE TABLE IF NOT EXISTS searchad_report_intents (
  report_intent_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  report_kind text NOT NULL CHECK (report_kind IN ('stat','master')),
  intent_key text NOT NULL,
  operation_key text NOT NULL,
  request_json jsonb NOT NULL,
  request_sha256 text NOT NULL CHECK (length(request_sha256)=64),
  status text NOT NULL CHECK (status IN ('planned','dispatching','registered','unknown_outcome','reconciled','manual_review','failed')),
  returned_job_id text,
  persisted_download_url text,
  created_by_principal_id text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_error_json jsonb,
  UNIQUE (customer_id, report_kind, intent_key)
);
CREATE INDEX IF NOT EXISTS searchad_report_intents_customer_status_idx
  ON searchad_report_intents(customer_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS searchad_report_intents_returned_job_idx
  ON searchad_report_intents(customer_id, report_kind, returned_job_id)
  WHERE returned_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS searchad_report_events (
  event_id uuid PRIMARY KEY,
  report_intent_id uuid NOT NULL REFERENCES searchad_report_intents(report_intent_id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  phase text NOT NULL,
  status text NOT NULL,
  operation_key text,
  request_id text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_json jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS searchad_report_events_intent_created_idx
  ON searchad_report_events(report_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS searchad_report_events_customer_created_idx
  ON searchad_report_events(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS searchad_report_blobs (
  blob_sha256 text PRIMARY KEY CHECK (length(blob_sha256)=64),
  content_bytes bytea NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  content_type text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (octet_length(content_bytes)=byte_length)
);

CREATE TABLE IF NOT EXISTS searchad_report_schemas (
  schema_sha256 text PRIMARY KEY CHECK (length(schema_sha256)=64),
  report_kind text NOT NULL CHECK (report_kind IN ('stat','master')),
  report_type text NOT NULL,
  ordered_columns_json jsonb NOT NULL,
  semantic_mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('known','quarantined')),
  quarantine_reason text,
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  reviewed_by_principal_id text
);
CREATE INDEX IF NOT EXISTS searchad_report_schemas_state_idx
  ON searchad_report_schemas(state, created_at DESC);

CREATE TABLE IF NOT EXISTS searchad_report_job_blobs (
  job_blob_id uuid PRIMARY KEY,
  report_intent_id uuid NOT NULL REFERENCES searchad_report_intents(report_intent_id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  returned_job_id text NOT NULL,
  blob_sha256 text NOT NULL REFERENCES searchad_report_blobs(blob_sha256),
  schema_sha256 text REFERENCES searchad_report_schemas(schema_sha256),
  downloaded_at timestamptz NOT NULL,
  UNIQUE (report_intent_id, blob_sha256)
);
CREATE INDEX IF NOT EXISTS searchad_report_job_blobs_customer_job_idx
  ON searchad_report_job_blobs(customer_id, returned_job_id, downloaded_at DESC);

CREATE TABLE IF NOT EXISTS searchad_stabilized_spend_evidence (
  evidence_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  entity_id text NOT NULL,
  stat_date date NOT NULL,
  d1_observation_id uuid REFERENCES searchad_stats_observations(observation_id),
  d2_observation_id uuid REFERENCES searchad_stats_observations(observation_id),
  d3_observation_id uuid NOT NULL REFERENCES searchad_stats_observations(observation_id),
  sales_amt_krw numeric NOT NULL CHECK (sales_amt_krw >= 0),
  vat_basis text NOT NULL CHECK (vat_basis='VAT_INCLUDED'),
  stabilized_by_policy boolean NOT NULL,
  stabilization_policy text NOT NULL CHECK (stabilization_policy='D3'),
  source_spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS searchad_stabilized_spend_customer_entity_idx
  ON searchad_stabilized_spend_evidence(customer_id, entity_id, stat_date DESC, created_at DESC);

DROP TRIGGER IF EXISTS searchad_stats_observations_immutable ON searchad_stats_observations;
CREATE TRIGGER searchad_stats_observations_immutable
BEFORE UPDATE OR DELETE ON searchad_stats_observations
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

DROP TRIGGER IF EXISTS searchad_report_events_immutable ON searchad_report_events;
CREATE TRIGGER searchad_report_events_immutable
BEFORE UPDATE OR DELETE ON searchad_report_events
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

DROP TRIGGER IF EXISTS searchad_stabilized_spend_evidence_immutable ON searchad_stabilized_spend_evidence;
CREATE TRIGGER searchad_stabilized_spend_evidence_immutable
BEFORE UPDATE OR DELETE ON searchad_stabilized_spend_evidence
FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

COMMENT ON TABLE searchad_stats_observations IS 'Immutable explicit-range SearchAd stats observations. salesAmt is KRW VAT_INCLUDED when numeric and valid.';
COMMENT ON TABLE searchad_report_intents IS 'Exactly-once local intent ledger for non-idempotent stat/master report registration.';
COMMENT ON TABLE searchad_report_events IS 'Append-only report registration/reconcile/download audit events.';
COMMENT ON TABLE searchad_report_blobs IS 'Content-addressed SearchAd report bytes keyed by SHA-256.';
COMMENT ON TABLE searchad_report_schemas IS 'Exact ordered-column report schema registry and quarantine state.';
COMMENT ON TABLE searchad_stabilized_spend_evidence IS 'Immutable D+3 policy-stabilized SearchAd spend evidence.';

COMMIT;
