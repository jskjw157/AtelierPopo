-- Additive, restart-safe advertising migrations. Do not touch Page/Instagram tokens.
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'publishing';
ALTER TABLE meta_ad_connections ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE meta_ad_connections ADD COLUMN IF NOT EXISTS generation TEXT;
ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS connection_generation TEXT;
ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS accessible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS user_tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE meta_ad_drafts ADD COLUMN IF NOT EXISTS external_account_id TEXT REFERENCES meta_ad_accounts(external_account_id);
ALTER TABLE meta_ad_drafts ADD COLUMN IF NOT EXISTS connection_generation TEXT;
ALTER TABLE meta_ad_drafts ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meta_ad_drafts ADD COLUMN IF NOT EXISTS definition JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE meta_ad_action_requests ADD COLUMN IF NOT EXISTS external_account_id TEXT;
ALTER TABLE meta_ad_action_requests ADD COLUMN IF NOT EXISTS connection_generation TEXT;
ALTER TABLE meta_ad_action_requests ADD COLUMN IF NOT EXISTS draft_revision INTEGER;
CREATE INDEX IF NOT EXISTS idx_ads_actions_status ON meta_ad_action_requests(status,expires_at);
CREATE TABLE IF NOT EXISTS meta_ad_insight_runs (
  id TEXT PRIMARY KEY,
  external_account_id TEXT NOT NULL,
  connection_generation TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('account','campaign','adset','ad')),
  date_start DATE NOT NULL,
  date_stop DATE NOT NULL,
  metrics JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_insight_runs_latest ON meta_ad_insight_runs(external_account_id,captured_at DESC);
