BEGIN;
-- Ordinary accepted execute attempts have Customer order, not delivery order.
CREATE TABLE searchad_automation_rules (
  rule_id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES searchad_canary_accounts(customer_id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  recovery_revision integer NOT NULL DEFAULT 0,
  UNIQUE(customer_id,entity_type,entity_id), UNIQUE(customer_id,rule_id)
);
ALTER TABLE searchad_automation_policies ADD COLUMN rule_id uuid;
INSERT INTO searchad_automation_rules(rule_id,customer_id,entity_type,entity_id)
  SELECT md5(customer_id||':'||entity_type||':'||entity_id)::uuid,customer_id,entity_type,entity_id
  FROM searchad_automation_policies GROUP BY customer_id,entity_type,entity_id;
UPDATE searchad_automation_policies p SET rule_id=r.rule_id FROM searchad_automation_rules r
  WHERE p.customer_id=r.customer_id AND p.entity_type=r.entity_type AND p.entity_id=r.entity_id;
ALTER TABLE searchad_automation_policies ALTER COLUMN rule_id SET NOT NULL;
ALTER TABLE searchad_automation_policies ADD FOREIGN KEY(customer_id,rule_id) REFERENCES searchad_automation_rules(customer_id,rule_id);
CREATE TABLE searchad_automation_policy_revisions (
  customer_id text NOT NULL, policy_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  rule_id uuid NOT NULL, policy_json jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(customer_id,policy_id,revision),
  FOREIGN KEY(customer_id,policy_id) REFERENCES searchad_automation_policies(customer_id,policy_id),
  FOREIGN KEY(customer_id,rule_id) REFERENCES searchad_automation_rules(customer_id,rule_id)
);
INSERT INTO searchad_automation_policy_revisions SELECT customer_id,policy_id,revision,rule_id,policy_json,created_by,created_at FROM searchad_automation_policies;
CREATE TRIGGER searchad_automation_revisions_immutable BEFORE UPDATE OR DELETE ON searchad_automation_policy_revisions FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
ALTER TABLE searchad_write_change_plans ADD UNIQUE(customer_id,plan_id);
ALTER TABLE searchad_write_approvals ADD UNIQUE(plan_id,approval_id);
ALTER TABLE searchad_automation_runs ADD COLUMN rule_id uuid;
UPDATE searchad_automation_runs r SET rule_id=p.rule_id FROM searchad_automation_policies p WHERE r.customer_id=p.customer_id AND r.policy_id=p.policy_id;
ALTER TABLE searchad_automation_runs ALTER COLUMN rule_id SET NOT NULL;
ALTER TABLE searchad_automation_runs ADD COLUMN approval_id uuid;
ALTER TABLE searchad_automation_runs ADD COLUMN revoked_at timestamptz;
ALTER TABLE searchad_automation_runs ADD FOREIGN KEY(customer_id,rule_id) REFERENCES searchad_automation_rules(customer_id,rule_id);
ALTER TABLE searchad_automation_runs ADD FOREIGN KEY(customer_id,policy_id,policy_revision) REFERENCES searchad_automation_policy_revisions(customer_id,policy_id,revision);
ALTER TABLE searchad_automation_runs ADD FOREIGN KEY(customer_id,plan_id) REFERENCES searchad_write_change_plans(customer_id,plan_id);
ALTER TABLE searchad_automation_runs ADD FOREIGN KEY(plan_id,approval_id) REFERENCES searchad_write_approvals(plan_id,approval_id);
CREATE UNIQUE INDEX searchad_automation_owned_plan ON searchad_automation_runs(plan_id) WHERE plan_id IS NOT NULL;
CREATE UNIQUE INDEX searchad_automation_owned_approval ON searchad_automation_runs(approval_id) WHERE approval_id IS NOT NULL;
CREATE UNIQUE INDEX searchad_automation_one_reservation ON searchad_automation_reservations(customer_id,run_id) WHERE run_id IS NOT NULL;
CREATE TABLE searchad_automation_current_observations (
  observation_id uuid PRIMARY KEY, customer_id text NOT NULL REFERENCES searchad_canary_accounts(customer_id),
  entity_type text NOT NULL CHECK(entity_type='campaign'), entity_id text NOT NULL,
  operation_key text NOT NULL CHECK(operation_key='ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id'),
  spec_sha text NOT NULL, credential_fingerprint text NOT NULL, upstream_base_url text NOT NULL,
  observed_at timestamptz NOT NULL, source_request_id text,
  snapshot_hash text NOT NULL, snapshot_json jsonb NOT NULL, normalized_json jsonb NOT NULL,
  UNIQUE(customer_id,observation_id)
);
CREATE TRIGGER searchad_automation_current_immutable BEFORE UPDATE OR DELETE ON searchad_automation_current_observations FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_write_execution_counters (
  customer_id text PRIMARY KEY REFERENCES searchad_canary_accounts(customer_id), last_ordinal bigint NOT NULL DEFAULT 0 CHECK(last_ordinal>=0)
);
CREATE TABLE searchad_write_execution_claims (
  customer_id text NOT NULL, ordinal bigint NOT NULL CHECK(ordinal>0), plan_id uuid NOT NULL UNIQUE,
  approval_id uuid NOT NULL UNIQUE, rule_id uuid NOT NULL, accepted_at timestamptz NOT NULL,
  PRIMARY KEY(customer_id,ordinal),
  FOREIGN KEY(customer_id,plan_id) REFERENCES searchad_write_change_plans(customer_id,plan_id),
  FOREIGN KEY(plan_id,approval_id) REFERENCES searchad_write_approvals(plan_id,approval_id),
  FOREIGN KEY(customer_id,rule_id) REFERENCES searchad_automation_rules(customer_id,rule_id)
);
CREATE TABLE searchad_write_execution_outcomes (
  outcome_id uuid PRIMARY KEY, customer_id text NOT NULL, ordinal bigint NOT NULL,
  version integer NOT NULL CHECK(version>0), source_attempt_id uuid NOT NULL UNIQUE REFERENCES searchad_write_attempts(attempt_id),
  outcome text NOT NULL CHECK(outcome IN('failed','unknown','applied','applied_reconciled','not_applied')),
  occurred_at timestamptz NOT NULL,
  UNIQUE(customer_id,ordinal,version), UNIQUE(customer_id,outcome_id),
  FOREIGN KEY(customer_id,ordinal) REFERENCES searchad_write_execution_claims(customer_id,ordinal)
);
CREATE TRIGGER searchad_execution_claims_immutable BEFORE UPDATE OR DELETE ON searchad_write_execution_claims FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TRIGGER searchad_execution_outcomes_immutable BEFORE UPDATE OR DELETE ON searchad_write_execution_outcomes FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_circuit_failure_recoveries (
  recovery_id uuid PRIMARY KEY, customer_id text NOT NULL, rule_id uuid NOT NULL,
  policy_id uuid NOT NULL, policy_revision integer NOT NULL, recovery_revision integer NOT NULL,
  actor text NOT NULL, reason text NOT NULL, selected_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(customer_id,rule_id,recovery_revision),
  FOREIGN KEY(customer_id,rule_id) REFERENCES searchad_automation_rules(customer_id,rule_id),
  FOREIGN KEY(customer_id,policy_id,policy_revision) REFERENCES searchad_automation_policy_revisions(customer_id,policy_id,revision)
);
CREATE TRIGGER searchad_failure_recoveries_immutable BEFORE UPDATE OR DELETE ON searchad_circuit_failure_recoveries FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
COMMENT ON TABLE searchad_write_execution_claims IS 'Account-first committed one-shot approval claims. Accepted local attempts, never proof of transport initiation or delivery.';
COMMENT ON TABLE searchad_write_execution_outcomes IS 'Immutable primary outcome versions committed with the source attempt; timestamps never establish accepted attempt order.';
COMMIT;
