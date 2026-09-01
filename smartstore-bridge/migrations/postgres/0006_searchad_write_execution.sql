BEGIN;

CREATE TABLE IF NOT EXISTS searchad_write_change_plans (
  plan_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  mutation_operation_key text NOT NULL,
  mutation_json jsonb NOT NULL,
  read_json jsonb NOT NULL,
  before_json jsonb NOT NULL,
  before_hash text NOT NULL,
  expected_after_json jsonb NOT NULL,
  rollback_json jsonb,
  reason text NOT NULL,
  status text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  applied_at timestamptz,
  applied_after_json jsonb,
  applied_after_hash text,
  rolled_back_at timestamptz,
  last_error_json jsonb,
  CONSTRAINT searchad_write_change_plans_status_check CHECK (status IN (
    'planned',
    'approved',
    'expired',
    'stale',
    'unknown_outcome',
    'verification_failed',
    'failed',
    'applied',
    'applied_reconciled',
    'not_applied',
    'manual_review',
    'rollback_unknown_outcome',
    'rollback_failed',
    'rollback_verification_failed',
    'rolled_back'
  ))
);

CREATE INDEX IF NOT EXISTS searchad_write_change_plans_customer_created_idx
  ON searchad_write_change_plans(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS searchad_write_change_plans_status_idx
  ON searchad_write_change_plans(status, expires_at);

CREATE TABLE IF NOT EXISTS searchad_write_approvals (
  approval_id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES searchad_write_change_plans(plan_id) ON DELETE CASCADE,
  actor text NOT NULL,
  confirmation text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS searchad_write_approvals_plan_idx
  ON searchad_write_approvals(plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS searchad_write_attempts (
  attempt_id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES searchad_write_change_plans(plan_id) ON DELETE CASCADE,
  phase text NOT NULL,
  status text NOT NULL,
  request_fingerprint text,
  request_json jsonb,
  response_json jsonb,
  error_json jsonb,
  remote_request_id text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS searchad_write_attempts_plan_idx
  ON searchad_write_attempts(plan_id, created_at ASC);

CREATE TABLE IF NOT EXISTS searchad_write_locks (
  plan_id uuid NOT NULL REFERENCES searchad_write_change_plans(plan_id) ON DELETE CASCADE,
  purpose text NOT NULL,
  acquired_at timestamptz NOT NULL,
  PRIMARY KEY (plan_id, purpose)
);

CREATE INDEX IF NOT EXISTS searchad_write_locks_acquired_idx
  ON searchad_write_locks(acquired_at);

COMMENT ON TABLE searchad_write_change_plans IS
  'SearchAd 공식 operationKey 쓰기를 위한 변경 전 스냅샷·Drift·재검증·롤백 계획';
COMMENT ON TABLE searchad_write_approvals IS
  '원문을 저장하지 않는 1회용 SearchAd 실행 토큰 승인';
COMMENT ON TABLE searchad_write_attempts IS
  'SearchAd 계획·실행·재검증·재조정·롤백 감사 시도 원장';
COMMENT ON TABLE searchad_write_locks IS
  '동일 계획에 대한 중복 실행·롤백을 막는 분산 잠금';

COMMIT;
