CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brand_profiles (
  id TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL DEFAULT 'HAAR',
  display_name TEXT NOT NULL DEFAULT 'HAAR Social Studio',
  tone_guide TEXT NOT NULL DEFAULT '미니멀하고 우아하며 과장하지 않는 문장',
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  default_hashtags JSONB NOT NULL DEFAULT '["#HAAR", "#하르", "#실버주얼리"]'::jsonb,
  default_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  confirmed_material TEXT,
  variant TEXT,
  price NUMERIC(14, 2),
  product_url TEXT,
  key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  bytes BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC(12, 3),
  checksum TEXT NOT NULL UNIQUE,
  alt_text TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  client_request_id TEXT,
  title TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  master_caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_client_request_id
  ON campaigns (client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS post_variants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'x')),
  format TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  alt_text TEXT,
  link_url TEXT,
  media_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  publish_state TEXT NOT NULL DEFAULT 'draft',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  external_post_id TEXT,
  permalink TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_variants_due
  ON post_variants (publish_state, scheduled_at, next_attempt_at);

CREATE TABLE IF NOT EXISTS social_connections (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL UNIQUE,
  account_id TEXT,
  account_name TEXT,
  page_id TEXT,
  instagram_account_id TEXT,
  access_token_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_expires_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_pending (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id TEXT PRIMARY KEY,
  post_variant_id TEXT NOT NULL REFERENCES post_variants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  result TEXT NOT NULL,
  response_code TEXT,
  sanitized_error TEXT,
  external_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id TEXT PRIMARY KEY,
  post_variant_id TEXT NOT NULL REFERENCES post_variants(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  impressions BIGINT,
  reach BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  clicks BIGINT,
  raw_supported_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_error TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  due_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id TEXT PRIMARY KEY,
  confirmation_code TEXT NOT NULL UNIQUE,
  provider_user_id TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
