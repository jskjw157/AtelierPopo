import assert from "node:assert/strict";
import { PostgresReportingRepository } from "../../src/naver/searchad/reporting/postgres-repository.js";
export const ingestionIdentity = {
  customerId: "1001",
  specSha: "a".repeat(40),
  credentialFingerprint: "b".repeat(64),
  upstreamBaseUrl: "https://api.searchad.naver.com",
};
export const ingestionJob = {
  ...ingestionIdentity,
  reportJobId: "11111111-1111-1111-1111-111111111111",
  kind: "stat",
  reportType: "AD",
  statDate: "2026-10-01",
  reportCreatedAt: null,
  claimId: "22222222-2222-2222-2222-222222222222",
  remoteJobId: "1",
  registrationAttemptedAt: "2026-10-04T03:00:00.000Z",
  registrationInitiatedAt: "2026-10-04T03:00:00.000Z",
  registrationAcknowledgedAt: "2026-10-04T03:00:00.000Z",
  firstBuiltObservedAt: "2026-10-04T03:00:00.000Z",
};
// Closed SQL boundary fixture: production transaction, parser revalidation and
// authority methods remain real. Native tests separately execute these queries.
export function ingestionQueryFixture({
  job = ingestionJob,
  ingestions = [],
  schemaSha = null,
} = {}) {
  const state = {
    staged: [],
    metrics: [],
    evidence: [],
    ingestions,
    quarantined: false,
    committed: false,
  };
  const persistedJob = {
    customer_id: job.customerId,
    report_job_id: job.reportJobId,
    report_kind: job.kind,
    report_type: job.reportType,
    stat_date: job.statDate,
    report_created_at: null,
    dispatch_claim_id: job.claimId,
    remote_job_id: job.remoteJobId,
    spec_sha: job.specSha,
    credential_fingerprint: job.credentialFingerprint,
    upstream_base_url: job.upstreamBaseUrl,
    metadata_json: job,
  };
  const client = {
    release() {},
    async query(sql, args = []) {
      if (
        ["BEGIN", "ROLLBACK"].includes(sql) ||
        sql.includes("pg_advisory_xact_lock")
      )
        return { rows: [] };
      if (sql === "COMMIT") {
        state.committed = true;
        return { rows: [] };
      }
      if (sql.includes("FROM searchad_spend_evidence"))
        return { rows: state.evidence };
      if (sql.includes("FROM searchad_report_jobs"))
        return { rows: sql.includes("FOR UPDATE") ? [persistedJob] : [] };
      if (sql.startsWith("INSERT INTO searchad_report_blobs"))
        return { rows: [{ blob_id: "33333333-3333-3333-3333-333333333333" }] };
      if (sql.startsWith("INSERT INTO searchad_report_schema_registry"))
        return { rows: [] };
      if (sql.startsWith("SELECT ordered_schema_sha"))
        return { rows: [{ ordered_schema_sha: schemaSha }] };
      if (sql.startsWith("INSERT INTO searchad_report_ingestions"))
        return { rows: [] };
      if (sql.startsWith("INSERT INTO searchad_report_rows_staging")) {
        state.staged.push({ rowNumber: args[3], row: JSON.parse(args[6]) });
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO searchad_daily_metrics")) {
        state.metrics.push(args);
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE searchad_report_jobs")) {
        if (sql.includes("quality='quarantined'")) state.quarantined = true;
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE searchad_report_ingestions"))
        return { rows: [] };
      if (
        sql.startsWith("SELECT provenance_json FROM searchad_report_ingestions")
      )
        return {
          rows: [1, 2, 3].map((slot) => ({
            provenance_json: { complete: true, generationWindow: { slot } },
          })),
        };
      if (sql.includes("FROM searchad_report_ingestions"))
        return {
          rows: sql.includes("generation_sha=$3") ? [] : state.ingestions,
        };
      if (sql.includes("FROM searchad_daily_metrics"))
        return {
          rows: [
            {
              entity_type: "creative",
              entity_id: "ad-1",
              raw: "110",
              gross: "110",
              invalid: 0,
            },
          ],
        };
      if (sql.startsWith("INSERT INTO searchad_spend_evidence")) {
        state.evidence.push({
          observed_at: args[13],
          stabilized_at: args[14] ?? args[13],
        });
        return { rows: [] };
      }
      assert.fail(`Unexpected SQL in closed fixture: ${sql}`);
    },
  };
  const pool = {
    query: (...args) => client.query(...args),
    connect: async () => client,
  };
  return { state, repository: new PostgresReportingRepository({ pool }), pool };
}
