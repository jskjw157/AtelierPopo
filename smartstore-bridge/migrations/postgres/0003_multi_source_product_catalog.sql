BEGIN;

-- 공급처·수집방식·Drive 폴더가 달라도 하나의 플랫폼에서 관리한다.
CREATE TABLE IF NOT EXISTS catalog_sources (
  source_id text PRIMARY KEY,
  source_name text NOT NULL,
  source_type text NOT NULL,
  provider_type text NOT NULL,
  root_reference text,
  credential_ref text,
  default_currency text NOT NULL DEFAULT 'KRW',
  status text NOT NULL DEFAULT 'active',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type IN (
    'supplier',
    'own_brand',
    'manual',
    'channel_import',
    'marketplace',
    'other'
  )),
  CHECK (provider_type IN (
    'google_drive_manifest',
    'google_drive_folder',
    'manual_upload',
    'csv_excel',
    'supplier_api',
    'url_import',
    'commerce_channel',
    'other'
  ))
);

CREATE TABLE IF NOT EXISTS catalog_ingestion_runs (
  ingestion_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES catalog_sources(source_id),
  mode text NOT NULL DEFAULT 'incremental',
  state text NOT NULL DEFAULT 'queued',
  source_cursor text,
  discovered_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (mode IN ('full', 'incremental', 'single_product'))
);

-- 공급처 상품번호는 공급처 안에서만 유일하다.
CREATE TABLE IF NOT EXISTS source_products (
  source_id text NOT NULL REFERENCES catalog_sources(source_id),
  source_product_id text NOT NULL,
  supplier_sku text,
  source_product_name text NOT NULL,
  source_category_path text,
  source_url text,
  source_status text NOT NULL DEFAULT 'active',
  supply_cost numeric(18,2),
  currency text NOT NULL DEFAULT 'KRW',
  option_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  asset_manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_product_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash text,
  source_modified_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, source_product_id)
);

CREATE INDEX IF NOT EXISTS source_products_supplier_sku_idx
  ON source_products (source_id, supplier_sku)
  WHERE supplier_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_products_name_idx
  ON source_products (source_product_name);

CREATE TABLE IF NOT EXISTS source_product_variants (
  source_id text NOT NULL,
  source_product_id text NOT NULL,
  source_variant_id text NOT NULL,
  supplier_variant_sku text,
  option_values_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  supply_cost numeric(18,2),
  currency text NOT NULL DEFAULT 'KRW',
  stock_quantity integer,
  source_status text NOT NULL DEFAULT 'active',
  raw_variant_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, source_product_id, source_variant_id),
  FOREIGN KEY (source_id, source_product_id)
    REFERENCES source_products(source_id, source_product_id)
    ON DELETE CASCADE
);

-- 플랫폼의 기준 상품. 공급처 상품번호가 아니라 HAAR 내부 ID가 중심이다.
CREATE TABLE IF NOT EXISTS haar_products (
  haar_product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_sku text UNIQUE,
  product_name text NOT NULL,
  brand_name text NOT NULL DEFAULT 'HAAR',
  product_category text,
  product_type text,
  status text NOT NULL DEFAULT 'draft',
  canonical_attributes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'active', 'paused', 'sold_out', 'discontinued', 'archived'))
);

CREATE TABLE IF NOT EXISTS haar_product_variants (
  haar_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id) ON DELETE CASCADE,
  internal_variant_sku text UNIQUE,
  option_values_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 한 HAAR 상품을 여러 공급처에서 조달하거나, 공급처를 교체할 수 있다.
CREATE TABLE IF NOT EXISTS haar_product_source_links (
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  source_product_id text NOT NULL,
  relation_type text NOT NULL DEFAULT 'supplier_listing',
  priority integer NOT NULL DEFAULT 100,
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_to timestamptz,
  verified_at timestamptz,
  verified_by text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (haar_product_id, source_id, source_product_id),
  FOREIGN KEY (source_id, source_product_id)
    REFERENCES source_products(source_id, source_product_id)
    ON DELETE RESTRICT,
  CHECK (relation_type IN (
    'supplier_listing',
    'same_product',
    'replacement_supplier',
    'bundle_component',
    'reference_only',
    'manual_link'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS haar_product_single_primary_source_idx
  ON haar_product_source_links (haar_product_id)
  WHERE is_primary = true AND valid_to IS NULL;

CREATE TABLE IF NOT EXISTS source_variant_links (
  haar_variant_id uuid NOT NULL REFERENCES haar_product_variants(haar_variant_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  source_product_id text NOT NULL,
  source_variant_id text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (haar_variant_id, source_id, source_product_id, source_variant_id),
  FOREIGN KEY (source_id, source_product_id, source_variant_id)
    REFERENCES source_product_variants(source_id, source_product_id, source_variant_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS supplier_cost_history (
  cost_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL,
  source_product_id text NOT NULL,
  source_variant_id text,
  supply_cost numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'KRW',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_id, source_product_id)
    REFERENCES source_products(source_id, source_product_id)
    ON DELETE CASCADE
);

-- 판매 채널과 판매상품도 공급처와 분리한다.
CREATE TABLE IF NOT EXISTS sales_channels (
  channel_id text PRIMARY KEY,
  channel_type text NOT NULL,
  account_reference text,
  channel_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_products (
  channel_product_key uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL REFERENCES sales_channels(channel_id),
  haar_product_id uuid NOT NULL REFERENCES haar_products(haar_product_id),
  channel_product_no text NOT NULL,
  origin_product_no text,
  seller_management_code text,
  channel_status text,
  channel_url text,
  last_synced_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, channel_product_no),
  UNIQUE (channel_id, seller_management_code)
);

-- 기존 SearchAd 매핑을 다중 소스·HAAR 기준 상품·채널 상품으로 확장한다.
ALTER TABLE product_ad_mappings
  ADD COLUMN IF NOT EXISTS catalog_source_id text REFERENCES catalog_sources(source_id),
  ADD COLUMN IF NOT EXISTS haar_product_id uuid REFERENCES haar_products(haar_product_id),
  ADD COLUMN IF NOT EXISTS channel_product_key uuid REFERENCES channel_products(channel_product_key);

-- v0.5의 source_product_id 단독 유일성은 공급처가 여러 개일 때 충돌한다.
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = current_schema()
      AND rel.relname = 'product_ad_mappings'
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE product_ad_mappings DROP CONSTRAINT IF EXISTS %I', constraint_row.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS product_ad_mappings_multi_source_uidx
  ON product_ad_mappings (
    customer_id,
    COALESCE(catalog_source_id, 'legacy'),
    source_product_id,
    remote_entity_type,
    remote_entity_id
  );

CREATE INDEX IF NOT EXISTS product_ad_mappings_haar_product_idx
  ON product_ad_mappings (customer_id, haar_product_id, remote_entity_type)
  WHERE haar_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_ad_mappings_channel_product_idx
  ON product_ad_mappings (customer_id, channel_product_key, remote_entity_type)
  WHERE channel_product_key IS NOT NULL;

-- 현재 보유한 퀸실버 카탈로그는 여러 소스 중 첫 번째 소스로 등록한다.
INSERT INTO catalog_sources (
  source_id,
  source_name,
  source_type,
  provider_type,
  root_reference,
  status,
  metadata_json
)
VALUES (
  'queensilver_20260811',
  '퀸실버_전체상품_20260811',
  'supplier',
  'google_drive_manifest',
  '1OxlupopKo8BR-8_fDE72LEknRbWIoGoS',
  'active',
  jsonb_build_object(
    'role', 'initial_supplier_catalog',
    'canonical', false,
    'expectedProductCount', 1515
  )
)
ON CONFLICT (source_id) DO NOTHING;

COMMIT;
