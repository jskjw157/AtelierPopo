PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  file_name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS haar_products (
  haar_product_id TEXT PRIMARY KEY,
  internal_sku TEXT UNIQUE,
  product_name TEXT NOT NULL,
  brand_name TEXT NOT NULL DEFAULT 'HAAR',
  status TEXT NOT NULL,
  canonical_attributes_json TEXT NOT NULL DEFAULT '{}',
  canonical_content_json TEXT NOT NULL DEFAULT '{}',
  merged_into_haar_product_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merged_into_haar_product_id)
    REFERENCES haar_products(haar_product_id),
  CHECK (status IN (
    'draft','imported_unverified','active','paused','sold_out',
    'discontinued','archived','merged'
  ))
);

CREATE TABLE IF NOT EXISTS channel_import_runs (
  import_run_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  remote_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (mode IN ('full','incremental','single')),
  CHECK (status IN ('queued','running','succeeded','partial','failed'))
);

CREATE TABLE IF NOT EXISTS channel_products (
  channel_product_id TEXT PRIMARY KEY,
  channel_product_key TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  haar_product_id TEXT NOT NULL,
  remote_product_id TEXT NOT NULL,
  origin_product_no TEXT,
  seller_management_code TEXT,
  product_name TEXT NOT NULL,
  channel_status TEXT,
  channel_url TEXT,
  source_modified_at TEXT,
  latest_snapshot_id TEXT,
  link_provenance TEXT NOT NULL DEFAULT 'imported_unverified',
  missing_from_latest_full_import INTEGER NOT NULL DEFAULT 0,
  last_seen_import_run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (haar_product_id)
    REFERENCES haar_products(haar_product_id),
  FOREIGN KEY (last_seen_import_run_id)
    REFERENCES channel_import_runs(import_run_id),
  UNIQUE (channel_id, remote_product_id),
  CHECK (missing_from_latest_full_import IN (0,1)),
  CHECK (link_provenance IN (
    'imported_unverified','exact_auto','manual_verified','merge_recovered'
  ))
);

CREATE INDEX IF NOT EXISTS channel_products_channel_idx
  ON channel_products(channel_id, remote_product_id);
CREATE INDEX IF NOT EXISTS channel_products_seller_code_idx
  ON channel_products(channel_id, seller_management_code)
  WHERE seller_management_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS channel_products_haar_idx
  ON channel_products(haar_product_id);

CREATE TABLE IF NOT EXISTS channel_product_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  channel_product_id TEXT NOT NULL,
  import_run_id TEXT NOT NULL,
  source_modified_at TEXT,
  raw_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (channel_product_id)
    REFERENCES channel_products(channel_product_id)
    ON DELETE CASCADE,
  FOREIGN KEY (import_run_id)
    REFERENCES channel_import_runs(import_run_id),
  UNIQUE (channel_product_id, content_hash)
);

CREATE INDEX IF NOT EXISTS channel_product_snapshots_product_idx
  ON channel_product_snapshots(channel_product_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS channel_product_identifiers (
  identifier_id TEXT PRIMARY KEY,
  channel_product_id TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  scope TEXT NOT NULL,
  variant_reference TEXT NOT NULL DEFAULT '',
  eligible_for_exact_match INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_product_id)
    REFERENCES channel_products(channel_product_id)
    ON DELETE CASCADE,
  UNIQUE (
    channel_product_id,identifier_type,normalized_value,scope,variant_reference
  ),
  CHECK (scope IN ('product','variant')),
  CHECK (eligible_for_exact_match IN (0,1)),
  CHECK (is_active IN (0,1))
);

CREATE INDEX IF NOT EXISTS channel_product_identifiers_exact_idx
  ON channel_product_identifiers(
    identifier_type, normalized_value, scope, is_active, eligible_for_exact_match
  );

CREATE TABLE IF NOT EXISTS channel_match_runs (
  match_run_id TEXT PRIMARY KEY,
  naver_import_run_id TEXT,
  cafe24_import_run_id TEXT,
  status TEXT NOT NULL,
  exact_match_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (naver_import_run_id)
    REFERENCES channel_import_runs(import_run_id),
  FOREIGN KEY (cafe24_import_run_id)
    REFERENCES channel_import_runs(import_run_id),
  CHECK (status IN ('previewed','applying','succeeded','partial','failed'))
);

CREATE TABLE IF NOT EXISTS channel_match_candidates (
  candidate_id TEXT PRIMARY KEY,
  match_run_id TEXT NOT NULL,
  left_channel_product_id TEXT NOT NULL,
  right_channel_product_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  exact_key_type TEXT,
  exact_key_value TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (match_run_id)
    REFERENCES channel_match_runs(match_run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (left_channel_product_id)
    REFERENCES channel_products(channel_product_id),
  FOREIGN KEY (right_channel_product_id)
    REFERENCES channel_products(channel_product_id),
  UNIQUE (match_run_id,left_channel_product_id,right_channel_product_id,match_type),
  CHECK (status IN ('auto_match','review_required','rejected','confirmed','applied')),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE TABLE IF NOT EXISTS channel_match_reviews (
  review_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id)
    REFERENCES channel_match_candidates(candidate_id)
    ON DELETE CASCADE,
  CHECK (status IN ('pending','confirmed','keep_separate','rejected'))
);

CREATE TABLE IF NOT EXISTS haar_product_merge_history (
  merge_id TEXT PRIMARY KEY,
  survivor_haar_product_id TEXT NOT NULL,
  merged_haar_product_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reverted_at TEXT,
  revert_json TEXT,
  FOREIGN KEY (survivor_haar_product_id)
    REFERENCES haar_products(haar_product_id),
  FOREIGN KEY (merged_haar_product_id)
    REFERENCES haar_products(haar_product_id)
);

CREATE INDEX IF NOT EXISTS haar_product_merge_history_survivor_idx
  ON haar_product_merge_history(survivor_haar_product_id, created_at DESC);
