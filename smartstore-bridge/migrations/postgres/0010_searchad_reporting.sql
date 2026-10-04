BEGIN;

-- Extend the existing report intents; legacy rows retain their original state.
ALTER TABLE searchad_report_jobs
  ADD COLUMN report_kind text CHECK (report_kind IN ('stat','master')),
  ADD COLUMN intent_key text,
  ADD COLUMN intent_hash text,
  ADD COLUMN intent_json jsonb,
  ADD COLUMN dispatch_claim_id uuid,
  ADD COLUMN dispatch_claimed_at timestamptz,
  ADD COLUMN dispatched_at timestamptz,
  ADD COLUMN spec_sha text,
  ADD COLUMN credential_fingerprint text,
  ADD COLUMN upstream_base_url text,
  ADD COLUMN processing_state text CHECK (processing_state IN ('planned','dispatching','registered','polling','built','ingesting','ingested','unknown_outcome','manual_review','failed')),
  ADD COLUMN quality text CHECK (quality IN ('provisional','stabilized_by_policy','changed_after_generation','quarantined','failed')),
  ADD COLUMN from_time timestamptz,
  ADD COLUMN source_request_id text,
  ADD COLUMN registered_by_principal_id text,
  ADD COLUMN last_error_code text,
  ADD CONSTRAINT searchad_report_jobs_customer_id_unique UNIQUE (customer_id,report_job_id),
  ADD CONSTRAINT searchad_report_jobs_intent_unique UNIQUE (customer_id,report_kind,intent_key);

ALTER TABLE searchad_report_schema_registry
  ADD COLUMN report_kind text CHECK (report_kind IN ('stat','master')),
  ADD COLUMN column_mappings_json jsonb,
  ADD COLUMN ordered_schema_sha text,
  ADD COLUMN source_provenance_json jsonb,
  ADD COLUMN supported boolean NOT NULL DEFAULT false;

CREATE TABLE searchad_stats_observations (
  observation_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  entity_type text NOT NULL CHECK (entity_type IN ('campaign','adgroup','keyword','creative','criterion')),
  entity_id text NOT NULL,
  since_kst date NOT NULL,
  until_kst date NOT NULL CHECK (until_kst >= since_kst),
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  observed_at timestamptz NOT NULL,
  source_request_id text,
  collection_request_id text NOT NULL,
  collected_by_principal_id text NOT NULL,
  response_sha text NOT NULL CHECK (response_sha ~ '^[a-f0-9]{64}$'),
  cycle_base_tm text NOT NULL CHECK (cycle_base_tm ~ '^[0-9]{12}$'),
  cycle_at timestamptz NOT NULL CHECK (cycle_at <= observed_at),
  quality text NOT NULL CHECK (quality = 'provisional'),
  entity_type_basis text NOT NULL CHECK (entity_type_basis = 'server_request'),
  range_basis text NOT NULL CHECK (range_basis IN ('server_request','response_echo')),
  missing_metrics_json jsonb NOT NULL DEFAULT '[]',
  spend_gross_krw numeric NOT NULL CHECK (spend_gross_krw::text NOT IN ('NaN','Infinity','-Infinity') AND spend_gross_krw >= 0 AND spend_gross_krw = trunc(spend_gross_krw)),
  impressions numeric NOT NULL CHECK (impressions::text NOT IN ('NaN','Infinity','-Infinity') AND impressions >= 0 AND impressions = trunc(impressions)),
  clicks numeric NOT NULL CHECK (clicks::text NOT IN ('NaN','Infinity','-Infinity') AND clicks >= 0 AND clicks = trunc(clicks)),
  conversions numeric NOT NULL CHECK (conversions::text NOT IN ('NaN','Infinity','-Infinity') AND conversions >= 0 AND conversions = trunc(conversions)),
  conversion_amount_krw numeric CHECK (conversion_amount_krw::text NOT IN ('NaN','Infinity','-Infinity') AND conversion_amount_krw >= 0),
  currency text NOT NULL CHECK (currency = 'KRW'),
  spend_basis text NOT NULL CHECK (spend_basis = 'vat_included'),
  UNIQUE (customer_id,observation_id)
);
CREATE INDEX searchad_stats_observations_scope_idx ON searchad_stats_observations(customer_id,entity_type,entity_id,observed_at DESC,observation_id);
CREATE TRIGGER searchad_stats_observations_immutable BEFORE UPDATE OR DELETE ON searchad_stats_observations FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

CREATE TABLE searchad_report_blobs (
  blob_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  report_job_id uuid NOT NULL,
  blob_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL,
  UNIQUE (customer_id,blob_id),
  UNIQUE (customer_id,report_job_id,blob_id),
  UNIQUE (customer_id,report_job_id,sha256),
  FOREIGN KEY (customer_id,report_job_id) REFERENCES searchad_report_jobs(customer_id,report_job_id)
);
CREATE TRIGGER searchad_report_blobs_immutable BEFORE UPDATE OR DELETE ON searchad_report_blobs FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();

CREATE TABLE searchad_report_ingestions (
  ingestion_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  report_job_id uuid NOT NULL,
  blob_id uuid NOT NULL,
  report_kind text NOT NULL CHECK (report_kind IN ('stat','master')),
  report_type text NOT NULL,
  stat_date date,
  report_created_at timestamptz NOT NULL,
  schema_version text NOT NULL,
  ordered_schema_sha text NOT NULL,
  parser_version text NOT NULL,
  generation_sha text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  processing_state text NOT NULL CHECK (processing_state IN ('ingesting','ingested','quarantined','failed')),
  quality text NOT NULL CHECK (quality IN ('provisional','stabilized_by_policy','changed_after_generation','quarantined','failed')),
  row_count bigint NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  reasons_json jsonb NOT NULL DEFAULT '[]',
  provenance_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id,ingestion_id),
  UNIQUE (customer_id,report_job_id,generation_sha,parser_version,ordered_schema_sha),
  FOREIGN KEY (customer_id,report_job_id) REFERENCES searchad_report_jobs(customer_id,report_job_id),
  FOREIGN KEY (customer_id,report_job_id,blob_id) REFERENCES searchad_report_blobs(customer_id,report_job_id,blob_id),
  FOREIGN KEY (report_type,schema_version) REFERENCES searchad_report_schema_registry(report_type,schema_version)
);
CREATE TABLE searchad_report_rows_staging (
  staging_row_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  ingestion_id uuid NOT NULL,
  row_number bigint NOT NULL CHECK (row_number > 0),
  natural_key text NOT NULL,
  row_sha text NOT NULL,
  row_json jsonb NOT NULL,
  validation_errors_json jsonb NOT NULL DEFAULT '[]',
  UNIQUE (customer_id,staging_row_id),
  UNIQUE (customer_id,ingestion_id,row_number),
  FOREIGN KEY (customer_id,ingestion_id) REFERENCES searchad_report_ingestions(customer_id,ingestion_id)
);
CREATE TABLE searchad_daily_metrics (
  metric_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  ingestion_id uuid NOT NULL,
  stat_date date NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  dimensions_json jsonb NOT NULL DEFAULT '{}',
  natural_key text NOT NULL,
  row_sha text NOT NULL,
  metrics_json jsonb NOT NULL,
  cost_raw numeric,
  cost_basis text NOT NULL,
  cost_gross_krw numeric,
  cost_net_krw numeric,
  vat_policy_version text NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE (customer_id,metric_id),
  UNIQUE (customer_id,ingestion_id,natural_key),
  FOREIGN KEY (customer_id,ingestion_id) REFERENCES searchad_report_ingestions(customer_id,ingestion_id)
);
CREATE INDEX searchad_daily_metrics_scope_idx ON searchad_daily_metrics(customer_id,stat_date,entity_type,entity_id);
CREATE TRIGGER searchad_daily_metrics_immutable BEFORE UPDATE OR DELETE ON searchad_daily_metrics FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_conversion_metrics (
  conversion_metric_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  ingestion_id uuid NOT NULL,
  stat_date date NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  natural_key text NOT NULL,
  row_sha text NOT NULL,
  dimensions_json jsonb NOT NULL DEFAULT '{}',
  metrics_json jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE (customer_id,conversion_metric_id),
  UNIQUE (customer_id,ingestion_id,natural_key),
  FOREIGN KEY (customer_id,ingestion_id) REFERENCES searchad_report_ingestions(customer_id,ingestion_id)
);
CREATE TRIGGER searchad_conversion_metrics_immutable BEFORE UPDATE OR DELETE ON searchad_conversion_metrics FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_search_terms (
  search_term_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  ingestion_id uuid NOT NULL,
  stat_date date NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  natural_key text NOT NULL,
  row_sha text NOT NULL,
  term_json jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE (customer_id,search_term_id),
  UNIQUE (customer_id,ingestion_id,natural_key),
  FOREIGN KEY (customer_id,ingestion_id) REFERENCES searchad_report_ingestions(customer_id,ingestion_id)
);
CREATE TRIGGER searchad_search_terms_immutable BEFORE UPDATE OR DELETE ON searchad_search_terms FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_master_snapshots (
  master_snapshot_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  ingestion_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  natural_key text NOT NULL,
  row_sha text NOT NULL,
  snapshot_json jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE (customer_id,master_snapshot_id),
  UNIQUE (customer_id,ingestion_id,natural_key),
  FOREIGN KEY (customer_id,ingestion_id) REFERENCES searchad_report_ingestions(customer_id,ingestion_id)
);
CREATE TRIGGER searchad_master_snapshots_immutable BEFORE UPDATE OR DELETE ON searchad_master_snapshots FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_spend_evidence (
  spend_evidence_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_customer_accounts(customer_id),
  ingestion_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  stat_date date NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  generation_sha text NOT NULL,
  quality text NOT NULL CHECK (quality IN ('provisional','stabilized_by_policy','changed_after_generation','quarantined','failed')),
  cost_raw numeric NOT NULL,
  cost_basis text NOT NULL,
  cost_gross_krw numeric,
  cost_net_krw numeric,
  vat_policy_version text NOT NULL,
  policy_provenance_json jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  stabilized_at timestamptz,
  supersedes_evidence_id uuid,
  UNIQUE (customer_id,spend_evidence_id),
  UNIQUE (customer_id,ingestion_id,entity_type,entity_id,stat_date),
  FOREIGN KEY (customer_id,ingestion_id) REFERENCES searchad_report_ingestions(customer_id,ingestion_id),
  FOREIGN KEY (customer_id,supersedes_evidence_id) REFERENCES searchad_spend_evidence(customer_id,spend_evidence_id)
);
CREATE TRIGGER searchad_spend_evidence_immutable BEFORE UPDATE OR DELETE ON searchad_spend_evidence FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
COMMIT;
