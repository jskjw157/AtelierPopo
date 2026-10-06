BEGIN;
CREATE TABLE searchad_circuit_policies (
  customer_id text PRIMARY KEY REFERENCES searchad_canary_accounts(customer_id),
  policy_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(policy_json)='object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE searchad_circuit_state (
  customer_id text PRIMARY KEY REFERENCES searchad_canary_accounts(customer_id),
  manual_paused boolean NOT NULL DEFAULT false,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE searchad_circuit_events (
  event_id bigserial PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_canary_accounts(customer_id),
  source_kind text NOT NULL,
  source_id text NOT NULL,
  event_json jsonb NOT NULL CHECK(jsonb_typeof(event_json)='object'),
  projected_at timestamptz NOT NULL,
  UNIQUE(customer_id,source_kind,source_id)
);
CREATE TABLE searchad_circuit_projection_cursors (
  customer_id text NOT NULL REFERENCES searchad_canary_accounts(customer_id),
  source_kind text NOT NULL,
  last_source_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(customer_id,source_kind)
);
CREATE TABLE searchad_automation_policies (
  policy_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_canary_accounts(customer_id),
  revision integer NOT NULL CHECK(revision>0),
  mode text NOT NULL DEFAULT 'observe' CHECK(mode IN('observe','recommend','approve','limited_auto')),
  enabled boolean NOT NULL DEFAULT false,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id,policy_id)
);
CREATE TABLE searchad_automation_runs (
  run_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  policy_id uuid NOT NULL,
  policy_revision integer NOT NULL,
  decision_key text NOT NULL,
  input_hash text NOT NULL,
  state text NOT NULL DEFAULT 'observed',
  plan_id uuid REFERENCES searchad_write_change_plans(plan_id),
  decision_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(customer_id,policy_id) REFERENCES searchad_automation_policies(customer_id,policy_id),
  UNIQUE(customer_id,decision_key), UNIQUE(customer_id,run_id)
);
CREATE TABLE searchad_automation_events (
  event_id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  run_id uuid NOT NULL,
  event_type text NOT NULL,
  event_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(customer_id,run_id) REFERENCES searchad_automation_runs(customer_id,run_id)
);
CREATE TABLE searchad_automation_reservations (
  reservation_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_canary_accounts(customer_id),
  dispatch_key text NOT NULL,
  run_id uuid,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  state text NOT NULL CHECK(state IN('reserved','consumed','unknown','resolved')),
  dispatch_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(customer_id,dispatch_key),
  FOREIGN KEY(customer_id,run_id) REFERENCES searchad_automation_runs(customer_id,run_id)
);
CREATE TRIGGER searchad_circuit_events_immutable BEFORE UPDATE OR DELETE ON searchad_circuit_events FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TRIGGER searchad_automation_events_immutable BEFORE UPDATE OR DELETE ON searchad_automation_events FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
COMMENT ON TABLE searchad_circuit_projection_cursors IS 'Informational checkpoints only. Source anti-joins, never timestamps, determine projection completeness.';
COMMENT ON TABLE searchad_automation_reservations IS 'Durable single-use dispatch reservations. Consumed and unknown reservations never grant another send.';
COMMIT;
