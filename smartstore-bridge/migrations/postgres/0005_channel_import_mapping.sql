BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- HAAR has exactly two current sales channels: Naver SmartStore and the
-- single HAAR-owned Cafe24 mall (haar.co.kr).
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

-- v0.5 used channel_product_key as a UUID primary key. The approved import
-- contract reserves channel_product_key for the stable text identity
-- channel_id || ':' || remote_product_id, so retain the UUID as ID.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='channel_products'
      AND column_name='channel_product_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='channel_products'
      AND column_name='channel_product_id'
  ) THEN
    ALTER TABLE channel_products RENAME COLUMN channel_product_key TO channel_product_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='product_ad_mappings'
      AND column_name='channel_product_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='product_ad_mappings'
      AND column_name='channel_product_id'
  ) THEN
    ALTER TABLE product_ad_mappings RENAME COLUMN channel_product_key TO channel_product_id;
  END IF;
END $$;

ALTER TABLE haar_products
  ADD COLUMN IF NOT EXISTS merged_into_haar_product_id uuid;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='haar_products'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE haar_products DROP CONSTRAINT IF EXISTS %I', item.conname);
  END LOOP;
END $$;

ALTER TABLE haar_products
  ADD CONSTRAINT haar_products_status_check
  CHECK (status IN (
    'draft','imported_unverified','active','paused','sold_out',
    'discontinued','archived','merged'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='haar_products'::regclass
      AND conname='haar_products_merged_into_fk'
  ) THEN
    ALTER TABLE haar_products
      ADD CONSTRAINT haar_products_merged_into_fk
      FOREIGN KEY(merged_into_haar_product_id)
      REFERENCES haar_products(haar_product_id);
  END IF;
END $$;

ALTER TABLE channel_products
  ADD COLUMN IF NOT EXISTS channel_product_key text,
  ADD COLUMN IF NOT EXISTS remote_product_id text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS source_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS link_provenance text NOT NULL DEFAULT 'imported_unverified',
  ADD COLUMN IF NOT EXISTS link_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_verified_by text,
  ADD COLUMN IF NOT EXISTS missing_from_latest_full_import boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_since_import_run_id uuid,
  ADD COLUMN IF NOT EXISTS last_seen_import_run_id uuid;

UPDATE channel_products
SET remote_product_id=COALESCE(remote_product_id,channel_product_no)
WHERE remote_product_id IS NULL;

UPDATE channel_products
SET channel_product_key=channel_id || ':' || remote_product_id
WHERE channel_product_key IS NULL AND remote_product_id IS NOT NULL;

UPDATE channel_products
SET product_name=COALESCE(product_name,seller_management_code,channel_product_no)
WHERE product_name IS NULL;

ALTER TABLE channel_products
  ALTER COLUMN remote_product_id SET NOT NULL,
  ALTER COLUMN channel_product_key SET NOT NULL,
  ALTER COLUMN product_name SET NOT NULL;

-- Seller codes are matching evidence, not unique channel identities. Preserve
-- duplicates so the match engine can surface them as review_required.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='channel_products'::regclass AND contype='u'
      AND replace(pg_get_constraintdef(oid),' ','') ILIKE '%(channel_id,seller_management_code)%'
  LOOP
    EXECUTE format('ALTER TABLE channel_products DROP CONSTRAINT IF EXISTS %I', item.conname);
  END LOOP;
END $$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='channel_products'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%link_provenance%'
  LOOP
    EXECUTE format('ALTER TABLE channel_products DROP CONSTRAINT IF EXISTS %I', item.conname);
  END LOOP;
END $$;

ALTER TABLE channel_products
  ADD CONSTRAINT channel_products_link_provenance_check
  CHECK (link_provenance IN (
    'imported_unverified','exact_auto','manual_verified','merge_recovered'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS channel_products_key_uidx
  ON channel_products(channel_product_key);
CREATE UNIQUE INDEX IF NOT EXISTS channel_products_remote_uidx
  ON channel_products(channel_id,remote_product_id);
CREATE INDEX IF NOT EXISTS channel_products_seller_code_idx
  ON channel_products(channel_id,seller_management_code)
  WHERE seller_management_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS channel_products_haar_product_idx
  ON channel_products(haar_product_id);

CREATE TABLE IF NOT EXISTS channel_import_runs(
  import_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL REFERENCES sales_channels(channel_id),
  mode text NOT NULL CHECK(mode IN ('full','incremental','single')),
  status text NOT NULL CHECK(status IN ('queued','running','succeeded','partial','failed')),
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
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
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_product_snapshots(
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_product_id uuid NOT NULL REFERENCES channel_products(channel_product_id) ON DELETE CASCADE,
  import_run_id uuid NOT NULL REFERENCES channel_import_runs(import_run_id),
  source_modified_at timestamptz,
  raw_json jsonb NOT NULL,
  normalized_json jsonb NOT NULL,
  content_hash text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_product_id,content_hash)
);
CREATE INDEX IF NOT EXISTS channel_product_snapshots_product_idx
  ON channel_product_snapshots(channel_product_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS channel_product_identifiers(
  identifier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_product_id uuid NOT NULL REFERENCES channel_products(channel_product_id) ON DELETE CASCADE,
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  normalized_value text NOT NULL,
  scope text NOT NULL CHECK(scope IN ('product','variant')),
  variant_reference text NOT NULL DEFAULT '',
  eligible_for_exact_match boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_product_id,identifier_type,normalized_value,scope,variant_reference)
);
CREATE INDEX IF NOT EXISTS channel_product_identifiers_exact_idx
  ON channel_product_identifiers(
    identifier_type,normalized_value,scope,is_active,eligible_for_exact_match
  );

CREATE TABLE IF NOT EXISTS channel_match_runs(
  match_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naver_import_run_id uuid REFERENCES channel_import_runs(import_run_id),
  cafe24_import_run_id uuid REFERENCES channel_import_runs(import_run_id),
  status text NOT NULL CHECK(status IN ('previewed','applying','succeeded','partial','failed')),
  exact_match_count integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS channel_match_candidates(
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_run_id uuid NOT NULL REFERENCES channel_match_runs(match_run_id) ON DELETE CASCADE,
  left_channel_product_id uuid NOT NULL REFERENCES channel_products(channel_product_id),
  right_channel_product_id uuid NOT NULL REFERENCES channel_products(channel_product_id),
  match_type text NOT NULL,
  exact_key_type text,
  exact_key_value text,
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK(confidence>=0 AND confidence<=1),
  status text NOT NULL CHECK(status IN ('auto_match','review_required','rejected','confirmed','applied')),
  reason_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_run_id,left_channel_product_id,right_channel_product_id,match_type)
);

CREATE TABLE IF NOT EXISTS channel_match_reviews(
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES channel_match_candidates(candidate_id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('pending','confirmed','keep_separate','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS haar_product_merge_history(
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
  reverted_by text,
  revert_json jsonb
);
CREATE INDEX IF NOT EXISTS haar_product_merge_history_survivor_idx
  ON haar_product_merge_history(survivor_haar_product_id,created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='channel_products'::regclass
      AND conname='channel_products_last_seen_import_run_fk'
  ) THEN
    ALTER TABLE channel_products
      ADD CONSTRAINT channel_products_last_seen_import_run_fk
      FOREIGN KEY(last_seen_import_run_id)
      REFERENCES channel_import_runs(import_run_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='channel_products'::regclass
      AND conname='channel_products_missing_since_fk'
  ) THEN
    ALTER TABLE channel_products
      ADD CONSTRAINT channel_products_missing_since_fk
      FOREIGN KEY(missing_since_import_run_id)
      REFERENCES channel_import_runs(import_run_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='channel_products'::regclass
      AND conname='channel_products_latest_snapshot_fk'
  ) THEN
    ALTER TABLE channel_products
      ADD CONSTRAINT channel_products_latest_snapshot_fk
      FOREIGN KEY(latest_snapshot_id)
      REFERENCES channel_product_snapshots(snapshot_id);
  END IF;
END $$;

COMMIT;
