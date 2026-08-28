BEGIN;

ALTER TABLE haar_products DROP CONSTRAINT IF EXISTS haar_products_status_check;
ALTER TABLE haar_products ADD CONSTRAINT haar_products_status_check
  CHECK (status IN ('draft','imported_unverified','active','paused','sold_out','discontinued','archived'));

INSERT INTO sales_channels(
  channel_id, channel_type, channel_role, platform_type,
  external_store_id, primary_domain, account_reference, channel_name, status
)
VALUES
  ('haar_naver_smartstore','naver_smartstore','marketplace','naver_smartstore',NULL,NULL,NULL,'HAAR 네이버 스마트스토어','active'),
  ('haar_own_mall','cafe24','owned_store','cafe24',NULL,'haar.co.kr',NULL,'HAAR 자사몰','active')
ON CONFLICT(channel_id) DO UPDATE SET
  channel_type=EXCLUDED.channel_type,
  channel_role=EXCLUDED.channel_role,
  platform_type=EXCLUDED.platform_type,
  primary_domain=COALESCE(sales_channels.primary_domain, EXCLUDED.primary_domain),
  channel_name=EXCLUDED.channel_name,
  status='active',
  updated_at=now();

ALTER TABLE channel_products
  ADD COLUMN IF NOT EXISTS channel_product_ref text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS source_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_import_run_id uuid,
  ADD COLUMN IF NOT EXISTS latest_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS missing_from_latest_full_import boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_since_import_run_id uuid,
  ADD COLUMN IF NOT EXISTS link_origin text NOT NULL DEFAULT 'imported_unverified',
  ADD COLUMN IF NOT EXISTS link_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_verified_by text;

UPDATE channel_products
SET channel_product_ref=channel_id || ':' || channel_product_no
WHERE channel_product_ref IS NULL;
ALTER TABLE channel_products ALTER COLUMN channel_product_ref SET NOT NULL;
ALTER TABLE channel_products DROP CONSTRAINT IF EXISTS channel_products_channel_id_seller_management_code_key;
CREATE INDEX IF NOT EXISTS channel_products_seller_management_code_idx
  ON channel_products(channel_id,seller_management_code)
  WHERE seller_management_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS channel_products_ref_uidx ON channel_products(channel_product_ref);

CREATE TABLE channel_import_runs(
  import_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL REFERENCES sales_channels(channel_id),
  mode text NOT NULL CHECK(mode IN ('full','incremental','single')),
  status text NOT NULL CHECK(status IN ('queued','running','succeeded','partial','failed')),
  idempotency_key text NOT NULL,
  remote_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  resume_count integer NOT NULL DEFAULT 0,
  cursor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id,idempotency_key)
);

CREATE TABLE channel_product_snapshots(
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_product_key uuid NOT NULL REFERENCES channel_products(channel_product_key),
  import_run_id uuid NOT NULL REFERENCES channel_import_runs(import_run_id),
  source_modified_at timestamptz,
  raw_json jsonb NOT NULL,
  normalized_json jsonb NOT NULL,
  content_hash text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_product_key,content_hash)
);

ALTER TABLE channel_products
  ADD CONSTRAINT channel_products_last_seen_import_run_fk FOREIGN KEY(last_seen_import_run_id) REFERENCES channel_import_runs(import_run_id),
  ADD CONSTRAINT channel_products_latest_snapshot_fk FOREIGN KEY(latest_snapshot_id) REFERENCES channel_product_snapshots(snapshot_id),
  ADD CONSTRAINT channel_products_missing_since_fk FOREIGN KEY(missing_since_import_run_id) REFERENCES channel_import_runs(import_run_id);

CREATE TABLE channel_product_identifiers(
  channel_product_key uuid NOT NULL REFERENCES channel_products(channel_product_key) ON DELETE CASCADE,
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  normalized_value text NOT NULL,
  scope text NOT NULL CHECK(scope IN ('product','variant')),
  variant_reference text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(channel_product_key,identifier_type,normalized_value,scope,variant_reference)
);
CREATE INDEX channel_product_identifiers_lookup_idx
  ON channel_product_identifiers(identifier_type,normalized_value,scope)
  WHERE is_active=true;

CREATE TABLE channel_match_runs(
  match_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naver_import_run_id uuid NOT NULL REFERENCES channel_import_runs(import_run_id),
  cafe24_import_run_id uuid NOT NULL REFERENCES channel_import_runs(import_run_id),
  status text NOT NULL CHECK(status IN ('previewed','applied','failed')),
  exact_match_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE channel_match_candidates(
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_run_id uuid NOT NULL REFERENCES channel_match_runs(match_run_id) ON DELETE CASCADE,
  left_channel_product_key uuid NOT NULL REFERENCES channel_products(channel_product_key),
  right_channel_product_key uuid NOT NULL REFERENCES channel_products(channel_product_key),
  match_type text NOT NULL,
  exact_key_type text,
  exact_key_value text,
  confidence numeric(4,3) NOT NULL,
  status text NOT NULL CHECK(status IN ('auto_match','review_required','rejected','confirmed','keep_separate')),
  reason_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(match_run_id,left_channel_product_key,right_channel_product_key)
);

CREATE TABLE channel_match_reviews(
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES channel_match_candidates(candidate_id),
  status text NOT NULL CHECK(status IN ('pending','confirmed','keep_separate','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE haar_product_merge_history(
  merge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id),
  merged_haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id),
  before_json jsonb NOT NULL,
  after_json jsonb NOT NULL,
  after_hash text NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by text
);

CREATE TABLE channel_oauth_tokens(
  channel_id text PRIMARY KEY REFERENCES sales_channels(channel_id),
  provider_type text NOT NULL,
  access_ciphertext bytea NOT NULL,
  access_iv bytea NOT NULL,
  access_tag bytea NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_ciphertext bytea NOT NULL,
  refresh_iv bytea NOT NULL,
  refresh_tag bytea NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  scopes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
