import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PostgresReportingRepository } from "../src/naver/searchad/reporting/postgres-repository.js";
import { LocalReportStorage } from "../src/naver/searchad/reporting/blob-storage.js";
import {
  postgresCompletionFixture,
  completionReaderKey as reader,
  completionOperatorKey as operator,
} from "./helpers/postgres-searchad-completion-fixture.js";
const input = {
  customerId: "1001",
  kind: "stat",
  reportType: "AD",
  statDate: "2026-10-01",
};
const bytes = (cost) =>
  `2026-10-01\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t100\t2\t${cost}\t100\t0\n`;
function requirePg(t) {
  if (process.env.TEST_DATABASE_URL) return true;
  assert.notEqual(
    process.env.CI,
    "true",
    "CI requires native report ingestion acceptance",
  );
  t.skip("TEST_DATABASE_URL is required");
  return false;
}
async function setup(t) {
  const h = await postgresCompletionFixture(t);
  let time = Date.parse("2026-10-02T03:00:00Z"),
    remote = 0,
    cost = "110",
    reportText = null;
  const jobs = new Map();
  const root = await mkdtemp(path.join(os.tmpdir(), "ingest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new LocalReportStorage({ root });
  const options = {
    clock: () => time,
    blobStorage: storage,
    appEnv: {
      ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS: "true",
      ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS: "1000",
      ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS: "1000",
    },
    allowedPaths: [
      "/stat-reports",
      "/stat-reports/1",
      "/stat-reports/2",
      "/stat-reports/3",
      "/stat-reports/4",
      "/stat-reports/5",
      "/report-download",
    ],
    response: async ({ target, init }) => {
      if (target.pathname === "/report-download") {
        assert.match(target.search, /fileVersion=v2/);
        assert.equal(
          target.searchParams.get("authtoken"),
          "private-download-token",
        );
        return new Response(reportText ?? bytes(cost));
      }
      if (init.method === "POST") {
        remote++;
        jobs.set(String(remote), {
          reportJobId: remote,
          reportTp: "AD",
          statDt: "2026-09-30T15:00:00Z",
          status: "BUILT",
          updateTm: new Date(time).toISOString(),
          downloadUrl:
            "https://api.searchad.naver.com/report-download?authtoken=private-download-token&fileVersion=v2",
        });
        return Response.json(jobs.get(String(remote)));
      }
      return Response.json(jobs.get(target.pathname.split("/").at(-1)));
    },
  };
  const first = await h.start(options);
  return {
    h,
    options,
    storage,
    first,
    setTime: (v) => (time = Date.parse(v)),
    setCost: (v) => (cost = v),
    setReportText: (v) => (reportText = v),
    get now() {
      return time;
    },
  };
}
async function collect(f, app, day) {
  f.setTime(`2026-10-0${day + 1}T03:00:00Z`);
  const created = await app.call(
    operator,
    "POST",
    "/api/v1/searchad/reporting/jobs",
    { ...input, intentKey: `slot-${day}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.body.reportJobId;
  const result = await app.call(
    operator,
    "POST",
    `/api/v1/searchad/reporting/jobs/${id}/ingest`,
    { customerId: "1001" },
  );
  assert.equal(result.status, 200, JSON.stringify(result));
  return { id, ...result.body };
}
const route = (id) => `/api/v1/searchad/reporting/jobs/${id}`;
test("native recollection_does_not_double_count, immutable evidence and actual HTTP archive restart", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  const a = f.first;
  const one = await collect(f, a, 1);
  const two = await collect(f, a, 2);
  const three = await collect(f, a, 3);
  assert.equal(one.quality, "provisional");
  assert.equal(three.quality, "provisional");
  const evalResult = await a.call(
    operator,
    "POST",
    `${route(three.id)}/evaluate`,
    { customerId: "1001" },
  );
  assert.equal(evalResult.status, 200, JSON.stringify(evalResult));
  assert.equal(evalResult.body.quality, "stabilized_by_policy");
  const runtime = a.app.searchAdCompletionRuntime;
  const identity = await runtime.identityResolver("1001");
  const query = {
    customerId: "1001",
    entityType: "creative",
    entityId: "ad-1",
    identity,
    now: f.now,
    maxAgeMs: 86400000,
  };
  const evidence = await runtime.repository.selectSpendEvidence(query);
  assert.equal(evidence.cost_gross_krw, "110");
  await assert.rejects(
    f.h.pool.query(
      "UPDATE searchad_spend_evidence SET cost_gross_krw=999 WHERE spend_evidence_id=$1",
      [evidence.spend_evidence_id],
    ),
    { code: "P0001" },
  );
  await assert.rejects(
    f.h.pool.query(
      "DELETE FROM searchad_spend_evidence WHERE spend_evidence_id=$1",
      [evidence.spend_evidence_id],
    ),
    { code: "P0001" },
  );
  assert.equal(
    (
      await a.call(
        reader,
        "GET",
        "/api/v1/searchad/reporting/metrics?customerId=1001",
      )
    ).body.items.length,
    1,
  );
  assert.equal(
    (
      await a.call(reader, "POST", `${route(three.id)}/ingest`, {
        customerId: "1001",
      })
    ).status,
    403,
  );
  assert.equal(
    (await a.call(reader, "GET", `${route(three.id)}/content?customerId=2002`))
      .status,
    403,
  );
  for (const action of ["ingest", "evaluate"])
    assert.equal(
      (
        await a.call(operator, "POST", `${route(three.id)}/${action}`, {
          customerId: "1001",
          quality: "stabilized_by_policy",
        })
      ).status,
      400,
    );
  const serialized =
    JSON.stringify(
      (await f.h.pool.query("SELECT * FROM searchad_report_jobs")).rows,
    ) +
    JSON.stringify(
      (await f.h.pool.query("SELECT * FROM searchad_report_ingestions")).rows,
    );
  assert.equal(serialized.includes("private-download-token"), false);
  assert.equal(
    (
      await f.h.pool.query(
        "SELECT report_created_at FROM searchad_report_ingestions",
      )
    ).rows.every((r) => r.report_created_at === null),
    true,
  );
  await a.api.close();
  const b = await f.h.start(f.options);
  assert.equal(
    (
      await b.call(
        reader,
        "GET",
        `${route(three.id)}/content?customerId=1001`,
        undefined,
        true,
      )
    ).body,
    bytes("110"),
  );
  const again = await b.call(operator, "POST", `${route(three.id)}/ingest`, {
    customerId: "1001",
  });
  assert.equal(again.body.deduplicated, true);
  assert.equal(
    (
      await b.call(
        reader,
        "GET",
        "/api/v1/searchad/reporting/metrics?customerId=1001",
      )
    ).body.items.length,
    1,
  );
  assert.equal(f.h.calls.filter((c) => c.method === "POST").length, 3);
  assert.equal(
    await b.app.searchAdCompletionRuntime.repository.selectSpendEvidence({
      ...query,
      customerId: "2002",
      identity: { ...identity, customerId: "2002" },
    }),
    null,
  );
  await f.h.pool.query(
    "INSERT INTO searchad_customer_accounts(customer_id) VALUES('2002') ON CONFLICT DO NOTHING",
  );
  const otherJob = randomUUID();
  await f.h.pool.query(
    "INSERT INTO searchad_report_jobs(report_job_id,customer_id,report_type,state) VALUES($1,'2002','AD','planned')",
    [otherJob],
  );
  const archived = (
    await f.h.pool.query(
      "SELECT * FROM searchad_report_blobs WHERE customer_id=$1 LIMIT 1",
      ["1001"],
    )
  ).rows[0];
  await b.app.searchAdCompletionRuntime.repository.storeBlob(f.h.pool, {
    job: { customerId: "2002", reportJobId: otherJob },
    blob: {
      key: `2002/${archived.sha256}.tsv`,
      sha256: archived.sha256,
      size: Number(archived.size_bytes),
      retainUntil: archived.retain_until,
    },
    now: f.now,
  });
  assert.equal(
    Number(
      (
        await f.h.pool.query(
          "SELECT COUNT(DISTINCT customer_id) FROM searchad_report_blobs WHERE sha256=$1",
          [archived.sha256],
        )
      ).rows[0].count,
    ),
    2,
  );
  assert.equal(
    await b.app.searchAdCompletionRuntime.repository.getArchivedBlob({
      customerId: "2002",
      reportJobId: three.id,
    }),
    null,
  );
});
test("native late_generation_invalidates_evidence then explicit restabilization appends immutable evidence", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  await collect(f, f.first, 1);
  await collect(f, f.first, 2);
  const third = await collect(f, f.first, 3);
  await f.first.call(operator, "POST", `${route(third.id)}/evaluate`, {
    customerId: "1001",
  });
  const r = f.first.app.searchAdCompletionRuntime.repository;
  const identity =
    await f.first.app.searchAdCompletionRuntime.identityResolver("1001");
  const q = {
    customerId: "1001",
    entityType: "creative",
    entityId: "ad-1",
    identity,
    maxAgeMs: 10 * 86400000,
  };
  const original = await r.selectSpendEvidence({ ...q, now: f.now });
  assert.ok(original);
  f.setCost("220");
  const fourth = await collect(f, f.first, 4);
  assert.equal(fourth.quality, "changed_after_generation");
  assert.equal(await r.selectSpendEvidence({ ...q, now: f.now }), null);
  const result = await f.first.call(
    operator,
    "POST",
    `${route(fourth.id)}/evaluate`,
    { customerId: "1001" },
  );
  assert.equal(result.body.quality, "stabilized_by_policy");
  const next = await r.selectSpendEvidence({ ...q, now: f.now });
  assert.equal(next.cost_gross_krw, "220");
  assert.notEqual(next.spend_evidence_id, original.spend_evidence_id);
  assert.equal(
    (
      await f.h.pool.query(
        "SELECT cost_gross_krw FROM searchad_spend_evidence WHERE spend_evidence_id=$1",
        [original.spend_evidence_id],
      )
    ).rows[0].cost_gross_krw,
    "110",
  );
  f.setCost("330");
  const changed = await f.first.call(
    operator,
    "POST",
    `${route(fourth.id)}/ingest`,
    { customerId: "1001" },
  );
  assert.equal(changed.body.quality, "quarantined");
  assert.equal(await r.selectSpendEvidence({ ...q, now: f.now }), null);
  assert.equal(
    (
      await f.first.call(operator, "POST", `${route(fourth.id)}/evaluate`, {
        customerId: "1001",
      })
    ).body.quality,
    "provisional",
  );
});
test("native concurrent ingestion dedupes and malformed final row promotes no rows with rollback on DB failure", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  const created = await f.first.call(
    operator,
    "POST",
    "/api/v1/searchad/reporting/jobs",
    { ...input, intentKey: "concurrent-first" },
  );
  const first = { id: created.body.reportJobId };
  const results = await Promise.all(
    [1, 2].map(() =>
      f.first.call(operator, "POST", `${route(first.id)}/ingest`, {
        customerId: "1001",
      }),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 200),
    JSON.stringify(results),
  );
  assert.equal(results.filter((r) => r.body.deduplicated).length, 1);
  assert.equal(
    Number(
      (await f.h.pool.query("SELECT COUNT(*) FROM searchad_daily_metrics"))
        .rows[0].count,
    ),
    1,
  );
  f.setCost("invalid");
  const malformed = await collect(f, f.first, 2);
  assert.equal(malformed.quality, "quarantined");
  assert.equal(
    Number(
      (await f.h.pool.query("SELECT COUNT(*) FROM searchad_daily_metrics"))
        .rows[0].count,
    ),
    1,
  );
  f.setCost("220");
  await f.h.pool.query(
    "CREATE FUNCTION fail_report_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic row failure'; END $$",
  );
  await f.h.pool.query(
    "CREATE TRIGGER fail_report_row BEFORE INSERT ON searchad_daily_metrics FOR EACH ROW EXECUTE FUNCTION fail_report_row()",
  );
  f.setTime("2026-10-04T03:00:00Z");
  const j = await f.first.call(
    operator,
    "POST",
    "/api/v1/searchad/reporting/jobs",
    { ...input, intentKey: "db-failure" },
  );
  const failed = await f.first.call(
    operator,
    "POST",
    `${route(j.body.reportJobId)}/ingest`,
    { customerId: "1001" },
  );
  assert.equal(failed.status, 503);
  assert.equal(
    Number(
      (await f.h.pool.query("SELECT COUNT(*) FROM searchad_report_ingestions"))
        .rows[0].count,
    ),
    1,
  );
  assert.equal(
    (
      await f.h.pool.query(
        "SELECT quality FROM searchad_report_jobs WHERE report_job_id=$1",
        [j.body.reportJobId],
      )
    ).rows[0].quality,
    "provisional",
  );
});
test("native conflicting overlapping generation windows and missing slots cannot authorize spend", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  const third = await collect(f, f.first, 3);
  assert.equal(
    (
      await f.first.call(operator, "POST", `${route(third.id)}/evaluate`, {
        customerId: "1001",
      })
    ).body.quality,
    "provisional",
  );
  f.setCost("220");
  const j = await f.first.call(
    operator,
    "POST",
    "/api/v1/searchad/reporting/jobs",
    { ...input, intentKey: "overlap" },
  );
  const result = await f.first.call(
    operator,
    "POST",
    `${route(j.body.reportJobId)}/ingest`,
    { customerId: "1001" },
  );
  assert.equal(result.body.quality, "quarantined");
  assert.equal(
    (
      await f.first.call(operator, "POST", `${route(third.id)}/evaluate`, {
        customerId: "1001",
      })
    ).body.quality,
    "provisional",
  );
});
test("native final evidence read rechecks a generation invalidated after candidate selection", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  await collect(f, f.first, 1);
  await collect(f, f.first, 2);
  const third = await collect(f, f.first, 3);
  await f.first.call(operator, "POST", `${route(third.id)}/evaluate`, {
    customerId: "1001",
  });
  const identity =
    await f.first.app.searchAdCompletionRuntime.identityResolver("1001");
  let changed = false;
  const repository = new PostgresReportingRepository({
    pool: {
      query: async (sql, args) => {
        if (sql.includes("FROM searchad_spend_evidence") && !changed) {
          changed = true;
          f.setCost("220");
          await collect(f, f.first, 4);
        }
        return f.h.pool.query(sql, args);
      },
    },
  });
  assert.equal(
    await repository.selectSpendEvidence({
      customerId: "1001",
      entityType: "creative",
      entityId: "ad-1",
      identity,
      now: f.now,
      maxAgeMs: 86400000,
    }),
    null,
  );
  assert.equal(changed, true);
});
test("native required stat and master formats promote through actual signed bootstrap ingestion", async (t) => {
  if (!requirePg(t)) return;
  const { readFile } = await import("node:fs/promises");
  const cases = JSON.parse(
    await readFile(
      new URL(
        "./fixtures/searchad/reports/required-formats.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const h = await postgresCompletionFixture(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "formats-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let time = Date.parse("2026-10-04T03:00:00Z"),
    counter = 0;
  const remote = new Map();
  const app = await h.start({
    clock: () => time,
    blobStorage: new LocalReportStorage({ root }),
    appEnv: {
      ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS: "true",
      ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS: "1000",
      ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS: "1000",
    },
    allowedPaths: [
      "/stat-reports",
      "/master-reports",
      "/report-download",
      ...Array.from({ length: 10 }, (_, i) => `/stat-reports/${i + 1}`),
      ...Array.from({ length: 10 }, (_, i) => `/master-reports/m${i + 1}`),
    ],
    response: async ({ target, init }) => {
      if (target.pathname === "/report-download")
        return new Response(
          remote.get(target.searchParams.get("authtoken")).line + "\r\n",
        );
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        const kind = target.pathname === "/stat-reports" ? "stat" : "master";
        const type = body.reportTp ?? body.item;
        const fixture = cases.find(
          (c) => c.kind === kind && c.reportType === type,
        );
        counter++;
        const id = kind === "stat" ? counter : `m${counter}`;
        const generated = new Date(time + 5000).toISOString();
        time += 10000;
        const data =
          kind === "stat"
            ? {
                reportJobId: id,
                reportTp: type,
                statDt: "2026-09-30T15:00:00Z",
                updateTm: generated,
                status: "BUILT",
              }
            : { id, item: type, updateTime: generated, status: "BUILT" };
        data.downloadUrl = `https://api.searchad.naver.com/report-download?authtoken=${id}&fileVersion=v2`;
        remote.set(String(id), { data, line: fixture.line });
        return Response.json(data);
      }
      return Response.json(remote.get(target.pathname.split("/").at(-1)).data);
    },
  });
  for (const fixture of cases) {
    const created = await app.call(
      operator,
      "POST",
      "/api/v1/searchad/reporting/jobs",
      {
        customerId: "1001",
        kind: fixture.kind,
        reportType: fixture.reportType,
        intentKey: `format-${fixture.reportType}`,
        ...(fixture.kind === "stat" ? { statDate: "2026-10-01" } : {}),
      },
    );
    assert.equal(created.status, 201, JSON.stringify(created));
    const result = await app.call(
      operator,
      "POST",
      `${route(created.body.reportJobId)}/ingest`,
      { customerId: "1001" },
    );
    assert.equal(
      result.status,
      200,
      `${fixture.reportType}: ${JSON.stringify(result)}`,
    );
    assert.equal(
      result.body.rowCount,
      1,
      `${fixture.reportType}: ${JSON.stringify(result)}`,
    );
  }
  assert.equal(
    Number(
      (await h.pool.query("SELECT COUNT(*) FROM searchad_master_snapshots"))
        .rows[0].count,
    ),
    4,
  );
  assert.equal(
    Number(
      (await h.pool.query("SELECT COUNT(*) FROM searchad_conversion_metrics"))
        .rows[0].count,
    ),
    2,
  );
  assert.equal(
    Number(
      (await h.pool.query("SELECT COUNT(*) FROM searchad_search_terms")).rows[0]
        .count,
    ),
    1,
  );
});

test("native I1 changed current D4 to D5 crossing revokes authority despite complete historical D1 D2 D3", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  await collect(f, f.first, 1);
  await collect(f, f.first, 2);
  const third = await collect(f, f.first, 3);
  await f.first.call(operator, "POST", `${route(third.id)}/evaluate`, {
    customerId: "1001",
  });
  const runtime = f.first.app.searchAdCompletionRuntime;
  const identity = await runtime.identityResolver("1001");
  const query = {
    customerId: "1001",
    entityType: "creative",
    entityId: "ad-1",
    identity,
    maxAgeMs: 10 * 86400000,
  };
  assert.ok(
    await runtime.repository.selectSpendEvidence({ ...query, now: f.now }),
  );
  f.setTime("2026-10-05T14:59:00Z");
  f.setCost("220");
  const created = await f.first.call(
    operator,
    "POST",
    "/api/v1/searchad/reporting/jobs",
    { ...input, intentKey: "crossing-d4-d5" },
  );
  assert.equal(created.status, 201);
  f.setTime("2026-10-05T15:01:00Z");
  const ingested = await f.first.call(
    operator,
    "POST",
    `${route(created.body.reportJobId)}/ingest`,
    { customerId: "1001" },
  );
  assert.equal(ingested.status, 200, JSON.stringify(ingested));
  assert.equal(ingested.body.quality, "quarantined");
  assert.equal(ingested.body.rowCount, 0);
  assert.equal(
    await runtime.repository.selectSpendEvidence({ ...query, now: f.now }),
    null,
  );
  const evaluated = await f.first.call(
    operator,
    "POST",
    `${route(created.body.reportJobId)}/evaluate`,
    { customerId: "1001" },
  );
  assert.equal(evaluated.body.quality, "provisional");
  assert.equal(
    Number(
      (await f.h.pool.query("SELECT COUNT(*) FROM searchad_spend_evidence"))
        .rows[0].count,
    ),
    1,
  );
});
test("native I2 late first evaluation and identical-hash recollection cannot refresh original evidence age", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  await collect(f, f.first, 1);
  await collect(f, f.first, 2);
  const third = await collect(f, f.first, 3);
  const runtime = f.first.app.searchAdCompletionRuntime;
  const identity = await runtime.identityResolver("1001");
  f.setTime("2026-10-20T03:00:00Z");
  const repeated = await f.first.call(
    operator,
    "POST",
    `${route(third.id)}/ingest`,
    { customerId: "1001" },
  );
  assert.equal(repeated.body.deduplicated, true);
  assert.equal(
    repeated.body.generationWindow.lower,
    "2026-10-04T02:59:59.000Z",
  );
  const evaluated = await f.first.call(
    operator,
    "POST",
    `${route(third.id)}/evaluate`,
    { customerId: "1001" },
  );
  assert.equal(evaluated.body.quality, "stabilized_by_policy");
  const evidence = (
    await f.h.pool.query(
      "SELECT observed_at,stabilized_at FROM searchad_spend_evidence",
    )
  ).rows[0];
  assert.equal(evidence.observed_at.toISOString(), "2026-10-04T03:00:00.000Z");
  assert.equal(
    evidence.stabilized_at.toISOString(),
    "2026-10-20T03:00:00.000Z",
  );
  assert.equal(
    await runtime.repository.selectSpendEvidence({
      customerId: "1001",
      entityType: "creative",
      entityId: "ad-1",
      identity,
      now: f.now,
      maxAgeMs: 86400000,
    }),
    null,
  );
});
test("native I3 valid A A B duplicate file commits two rows with original physical positions", async (t) => {
  if (!requirePg(t)) return;
  const f = await setup(t);
  f.setReportText(
    bytes("110") + bytes("110") + bytes("110").replace("ad-1", "ad-2"),
  );
  const result = await collect(f, f.first, 1);
  assert.equal(result.rowCount, 2);
  const staged = await f.h.pool.query(
    "SELECT row_number FROM searchad_report_rows_staging ORDER BY row_number",
  );
  assert.deepEqual(
    staged.rows.map((r) => Number(r.row_number)),
    [1, 3],
  );
  const promoted = await f.h.pool.query(
    "SELECT entity_id,cost_gross_krw FROM searchad_daily_metrics ORDER BY entity_id",
  );
  assert.deepEqual(promoted.rows, [
    { entity_id: "ad-1", cost_gross_krw: "110" },
    { entity_id: "ad-2", cost_gross_krw: "110" },
  ]);
});
