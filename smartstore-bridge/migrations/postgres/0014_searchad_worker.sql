-- Scheduling is local configuration; every dispatch retains its original source intent.
CREATE TABLE searchad_worker_schedules (
 customer_id text NOT NULL, schedule_id text NOT NULL, kind text NOT NULL,
 payload_json jsonb NOT NULL, request_hash text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 next_slot_at timestamptz NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(customer_id,schedule_id),
 CHECK(kind IN('collect_stats','register_stat_report','collect_report_generation','evaluate_automation','reconcile_automation'))
);
CREATE TABLE searchad_worker_jobs (
 job_id uuid PRIMARY KEY, customer_id text NOT NULL, schedule_id text NOT NULL, slot_at timestamptz NOT NULL,
 kind text NOT NULL, payload_json jsonb NOT NULL, request_hash text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','retry','succeeded','skipped','failed','manual_review')),
 owner_hash text, worker_id text, lease_generation integer NOT NULL DEFAULT 0, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 5),
 available_at timestamptz NOT NULL, result_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(customer_id,schedule_id,slot_at), UNIQUE(customer_id,job_id)
);
CREATE INDEX searchad_worker_claim ON searchad_worker_jobs(available_at,slot_at) WHERE state IN('queued','retry','running');
CREATE TABLE searchad_worker_runs (
 event_id uuid PRIMARY KEY, customer_id text NOT NULL, job_id uuid NOT NULL,
 event_type text NOT NULL, lease_generation integer NOT NULL, details_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL,
 UNIQUE(customer_id,event_id), FOREIGN KEY(customer_id,job_id) REFERENCES searchad_worker_jobs(customer_id,job_id)
);
CREATE TRIGGER searchad_worker_runs_immutable BEFORE UPDATE OR DELETE ON searchad_worker_runs FOR EACH ROW EXECUTE FUNCTION searchad_reject_immutable_mutation();
CREATE TABLE searchad_worker_sources (
 customer_id text NOT NULL, job_id uuid NOT NULL, source_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('report','automation')), intent_key text NOT NULL,
 request_hash text NOT NULL, state text NOT NULL CHECK(state IN('claimed','linked')),
 run_id uuid, created_at timestamptz NOT NULL,
 PRIMARY KEY(job_id,source_key), FOREIGN KEY(customer_id,job_id) REFERENCES searchad_worker_jobs(customer_id,job_id),
 FOREIGN KEY(customer_id,run_id) REFERENCES searchad_automation_runs(customer_id,run_id),
 UNIQUE(customer_id,intent_key)
);
