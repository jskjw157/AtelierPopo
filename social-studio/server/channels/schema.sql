CREATE TABLE IF NOT EXISTS channel_connections (
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK(platform IN ('threads','tiktok','x')),
  generation UUID NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  credentials_encrypted TEXT NOT NULL,
  scopes JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(owner_user_id,platform)
);
CREATE TABLE IF NOT EXISTS channel_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK(platform IN ('threads','tiktok','x')),
  verifier_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS channel_posts (
  id UUID PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  client_request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('threads','tiktok','x')),
  account_generation UUID,
  account_id TEXT,
  format TEXT NOT NULL,
  caption TEXT NOT NULL,
  media_asset_ids JSONB NOT NULL,
  scheduled_at TIMESTAMPTZ,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state TEXT NOT NULL CHECK(state IN ('draft','scheduled','queued','publishing','processing','published','awaiting_user','failed','uncertain','cancelled')),
  dispatch_started_at TIMESTAMPTZ,
  provider_ref TEXT,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_post_id TEXT,
  permalink TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_user_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_posts_due ON channel_posts(state,scheduled_at);
CREATE TABLE IF NOT EXISTS channel_attempts (
  id UUID PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES channel_posts(id),
  operation TEXT NOT NULL,
  state TEXT NOT NULL,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
