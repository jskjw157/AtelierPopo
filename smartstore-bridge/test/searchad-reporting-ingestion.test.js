import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
async function module(name, symbol) {
  const m = await import(`../src/naver/searchad/reporting/${name}.js`).catch(
    () => ({}),
  );
  assert.equal(typeof m[symbol], "function", `${symbol} implemented`);
  return m;
}
const ad = readFileSync(
  new URL("./fixtures/searchad/reports/ad.tsv", import.meta.url),
  "utf8",
);
async function schema(
  type = "AD",
  statDate = "2026-10-01",
  reportCreatedAt = "2026-10-04T04:00:00Z",
) {
  return (
    await module("schema-registry", "selectReportSchema")
  ).selectReportSchema({
    kind: "stat",
    reportType: type,
    statDate,
    reportCreatedAt,
    parserVersion: "tsv-v1",
  });
}
test("blob_checksum_failure_cannot_ingest", async (t) => {
  const { LocalReportStorage } = await module(
    "blob-storage",
    "LocalReportStorage",
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const s = new LocalReportStorage({ root });
  const bytes = Buffer.from(ad);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await assert.rejects(
    s.put({ customerId: "1001", sha256: "0".repeat(64), bytes }),
  );
  const b = await s.put({ customerId: "1001", sha256, bytes });
  await writeFile(path.join(root, b.key), "corrupt");
  await assert.rejects(s.get({ customerId: "1001", key: b.key }));
  await assert.rejects(s.get({ customerId: "2002", key: b.key }));
});
test("same_count_wrong_order_quarantines and partial_parse_promotes_no_rows", async () => {
  const { parseReportTsv } = await module("tsv-parser", "parseReportTsv");
  const d = await schema();
  for (const bytes of [
    Buffer.from(ad.replace("2026-10-01\t1001", "1001\t2026-10-01")),
    Buffer.from(ad + ad.replace("\t110\t", "\tbogus\t")),
    Buffer.from([0xff]),
  ]) {
    const p = parseReportTsv(bytes, d, { customerId: "1001" });
    assert.equal(p.rows.length, 0);
    assert.ok(p.reasons.length);
  }
  const p = parseReportTsv(
    Buffer.from("\ufeff" + ad.replace("\n", "\r\n")),
    d,
    { customerId: "1001" },
  );
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].costGrossKrw, "110");
});
test("2026-11-16 uses generation time even for old statDate and refuses crossing windows", async () => {
  const { selectReportSchema } = await module(
    "schema-registry",
    "selectReportSchema",
  );
  for (const [time, count] of [
    ["2026-11-15T14:00:00Z", 15],
    ["2026-11-15T16:00:00Z", 14],
  ])
    assert.equal(
      (await schema("ADEXTENSION", "2026-03-01", time)).columns.length,
      count,
    );
  assert.throws(() =>
    selectReportSchema({
      kind: "stat",
      reportType: "ADEXTENSION",
      statDate: "2026-10-01",
      generationWindow: {
        lower: "2026-11-15T14:59:59Z",
        upper: "2026-11-15T15:00:01Z",
      },
      parserVersion: "tsv-v1",
    }),
  );
  assert.throws(() =>
    selectReportSchema({
      kind: "stat",
      reportType: "NAVERPAY_CONVERSION",
      statDate: "2025-04-09",
      reportCreatedAt: "2026-10-01T00:00:00Z",
      parserVersion: "tsv-v1",
    }),
  );
});
test("d3_48h_boundary_is_kst and late polls cannot age an early registration", async () => {
  const { generationProof } = await module(
    "spend-evidence-service",
    "generationProof",
  );
  const policy = {
    version: "generation-window-v1",
    clockUncertaintyMs: 1000,
    rolloutUncertaintyMs: 1000,
  };
  const job = {
    kind: "stat",
    claimId: "owned",
    remoteJobId: "1",
    statDate: "2026-10-01",
    registrationAttemptedAt: "2026-10-03T15:00:01Z",
    registrationInitiatedAt: "2026-10-03T15:00:01Z",
    registrationAcknowledgedAt: "2026-10-03T15:00:02Z",
    firstBuiltObservedAt: "2026-10-03T15:00:03Z",
  };
  assert.equal(
    generationProof(job, Date.parse("2026-10-03T15:00:04Z"), policy).stableAge,
    true,
  );
  assert.equal(
    generationProof(
      { ...job, registrationAttemptedAt: "2026-10-03T15:00:00Z" },
      Date.parse("2026-10-10T00:00:00Z"),
      policy,
    ).stableAge,
    false,
  );
  assert.throws(() =>
    generationProof(job, Date.parse("2026-10-03T15:00:04Z"), null),
  );
});
test("required official formats produce normalized rows including enum 5 and empty trailing fields", async () => {
  const { selectReportSchema } = await module(
    "schema-registry",
    "selectReportSchema",
  );
  const { parseReportTsv } = await module("tsv-parser", "parseReportTsv");
  const cases = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/searchad/reports/required-formats.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).map(({ kind, reportType, line }) => [kind, reportType, line]);
  for (const [kind, reportType, line] of cases) {
    const d = selectReportSchema({
      kind,
      reportType,
      statDate: "2026-10-01",
      reportCreatedAt: "2026-10-04T03:00:00Z",
    });
    const p = parseReportTsv(Buffer.from(line + "\r\n"), d, {
      customerId: "1001",
    });
    assert.equal(
      p.rows.length,
      1,
      `${reportType}: ${JSON.stringify(p.reasons)}`,
    );
    if (reportType === "EXPKEYWORD")
      assert.equal(p.rows[0].searchKeywordType, "exact");
  }
});
test("missing VAT provenance blocks normalized trusted cost and preboundary keeps decimal net", async () => {
  const { parseReportTsv } = await module("tsv-parser", "parseReportTsv");
  const d = await schema();
  delete d.vatPolicy;
  assert.equal(
    parseReportTsv(Buffer.from(ad), d, { customerId: "1001" }).rows[0]
      .costGrossKrw,
    null,
  );
  const old = await schema("AD", "2026-03-29");
  const p = parseReportTsv(
    Buffer.from(
      ad.replace("2026-10-01", "2026-03-29").replace("\t110\t", "\t100.5\t"),
    ),
    old,
    { customerId: "1001" },
  );
  assert.equal(p.rows[0].costNetKrw, "100.5");
  assert.equal(p.rows[0].costGrossKrw, null);
});
test("ingestion archives then verifies checksum before atomic promotion and sanitizes storage failures", async () => {
  const { ReportIngestionService } = await module(
    "ingestion-service",
    "ReportIngestionService",
  );
  let commits = 0;
  const job = { customerId: "1001", reportJobId: "job" };
  const repository = {
    commitIngestion: async () => {
      commits++;
    },
    quarantineIngestion: async () => {},
  };
  const service = new ReportIngestionService({
    repository,
    downloadAdapter: {
      download: async () => ({
        bytes: Buffer.from(ad),
        job,
        identity: {},
        downloadCompletedAt: 1,
      }),
    },
    storage: {
      put: async () => ({ key: "x" }),
      get: async () => Buffer.from("tampered"),
    },
    clock: () => 1,
  });
  await assert.rejects(
    service.ingest({ customerId: "1001", reportJobId: "job" }, {}),
  );
  assert.equal(commits, 0);
});
test("S3 adapter uses configured SDK commands, scoped keys and verified durable bytes", async () => {
  const { S3CompatibleReportStorage } = await module(
    "s3-storage",
    "S3CompatibleReportStorage",
  );
  const objects = new Map();
  const s = new S3CompatibleReportStorage({
    bucket: "synthetic-reports",
    prefix: "reports",
    client: {
      send: async (command) => {
        assert.equal(command.input.Bucket, "synthetic-reports");
        assert.match(command.input.Key, /^reports\/1001\/[a-f0-9]{64}\.tsv$/);
        if (command.constructor.name === "PutObjectCommand") {
          objects.set(command.input.Key, command.input.Body);
          return {};
        }
        return {
          Body: {
            transformToByteArray: async () => objects.get(command.input.Key),
          },
        };
      },
    },
  });
  const bytes = Buffer.from(ad);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const b = await s.put({
    customerId: "1001",
    sha256,
    bytes,
    contentType: "text/tab-separated-values",
    retainUntil: "2028-10-01T00:00:00Z",
  });
  assert.deepEqual(await s.get({ customerId: "1001", key: b.key }), bytes);
});
test("later quarantine revokes prior selected generation, while a genuinely later valid generation can restabilize", async () => {
  const { PostgresReportingRepository } = await import(
    "../src/naver/searchad/reporting/postgres-repository.js"
  );
  const rows = [
    {
      ingestion_id: "old",
      report_kind: "stat",
      report_type: "AD",
      stat_date: "2026-10-01",
      processing_state: "ingested",
      quality: "stabilized_by_policy",
      generation_sha: "a",
      provenance_json: {
        complete: true,
        generationWindow: {
          lower: "2026-10-04T03:00:00Z",
          upper: "2026-10-04T03:01:00Z",
          slot: 3,
        },
      },
    },
  ];
  let quarantineAt = "2026-10-05T03:00:00Z";
  const repository = new PostgresReportingRepository({
    pool: {
      query: async (sql, args) => {
        assert.equal(args[0], "1001");
        return {
          rows: sql.includes("searchad_report_jobs")
            ? [{ metadata_json: { quarantineAt } }]
            : structuredClone(rows),
        };
      },
    },
  });
  assert.deepEqual(
    await repository.selectedIngestions(repository.pool, {
      customerId: "1001",
    }),
    [],
  );
  rows.push({
    ...rows[0],
    ingestion_id: "new",
    quality: "changed_after_generation",
    generation_sha: "b",
    provenance_json: {
      complete: true,
      generationWindow: {
        lower: "2026-10-06T03:00:00Z",
        upper: "2026-10-06T03:01:00Z",
        slot: 5,
      },
    },
  });
  assert.equal(
    (
      await repository.selectedIngestions(repository.pool, {
        customerId: "1001",
      })
    )[0].ingestion_id,
    "new",
  );
});
test("archive retrieval accepts scoped reader and never performs another upstream download", async () => {
  const { ReportJobService } = await import(
    "../src/naver/searchad/reporting/job-service.js"
  );
  const { ReportIngestionService } = await import(
    "../src/naver/searchad/reporting/ingestion-service.js"
  );
  const identity = {
    customerId: "1001",
    specSha: "a".repeat(40),
    credentialFingerprint: "b".repeat(64),
    upstreamBaseUrl: "https://api.searchad.naver.com",
  };
  const job = {
    ...identity,
    reportJobId: "11111111-1111-1111-1111-111111111111",
  };
  const repository = {
    getReportJob: async () => job,
    getArchivedBlob: async () => ({ key: "stored" }),
  };
  const jobService = new ReportJobService({
    repository,
    remote: { get: () => assert.fail("archive must not contact upstream") },
    identityResolver: () => identity,
  });
  const service = new ReportIngestionService({
    repository,
    jobService,
    storage: { get: async () => Buffer.from("archive") },
  });
  const context = {
    principal: { principalId: "reader", role: "reader", customerIds: ["1001"] },
    requestId: "archive-request",
  };
  assert.equal(
    (
      await service.archived(
        { customerId: "1001", reportJobId: job.reportJobId },
        context,
      )
    ).toString(),
    "archive",
  );
  await assert.rejects(
    service.archived(
      { customerId: "2002", reportJobId: job.reportJobId },
      context,
    ),
  );
});
test("identical archived hash reuses original window instead of widening across a schema boundary", async () => {
  const { ReportIngestionService } = await import(
    "../src/naver/searchad/reporting/ingestion-service.js"
  );
  const { generationProof } = await import(
    "../src/naver/searchad/reporting/spend-evidence-service.js"
  );
  const { blobHash } = await import(
    "../src/naver/searchad/reporting/blob-storage.js"
  );
  const job = {
    customerId: "1001",
    reportJobId: "owned",
    kind: "stat",
    reportType: "ADEXTENSION",
    statDate: "2026-10-01",
    claimId: "claim",
    remoteJobId: "1",
    registrationAttemptedAt: "2026-11-15T13:00:00Z",
    registrationInitiatedAt: "2026-11-15T13:00:00Z",
    registrationAcknowledgedAt: "2026-11-15T13:00:00Z",
    firstBuiltObservedAt: "2026-11-15T13:00:00Z",
  };
  const policy = {
    version: "generation-window-v1",
    clockUncertaintyMs: 1000,
    rolloutUncertaintyMs: 1000,
  };
  const proof = generationProof(
    job,
    Date.parse("2026-11-15T14:00:00Z"),
    policy,
  );
  const bytes = Buffer.from(
    "2026-10-01\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\text-1\tbiz-1\t1\tP\t100\t2\t110\t10\t0\n",
  );
  const sha256 = blobHash(bytes);
  const repository = {
    getIngestionBinding: async () => ({ proof }),
    quarantineIngestion: async () => ({ quality: "quarantined" }),
    commitIngestion: async (data) => {
      assert.deepEqual(data.proof, proof);
      return { quality: "provisional", rowCount: data.rows.length };
    },
  };
  const service = new ReportIngestionService({
    repository,
    jobService: { identity: async () => ({}) },
    downloadAdapter: {
      download: async () => ({
        bytes,
        job,
        identity: {},
        downloadCompletedAt: Date.parse("2026-11-16T00:00:00Z"),
      }),
    },
    storage: {
      put: async () => ({ key: "stored", sha256, size: bytes.length }),
      get: async () => bytes,
    },
    clock: () => Date.parse("2026-11-16T00:00:00Z"),
    generationPolicy: policy,
  });
  const result = await service.ingest({}, {});
  assert.equal(result.quality, "provisional");
  assert.equal(result.rowCount, 1);
});
test("impossible master dates and undocumented conversion enums quarantine the whole file", async () => {
  const { selectReportSchema } = await module(
    "schema-registry",
    "selectReportSchema",
  );
  const { parseReportTsv } = await module("tsv-parser", "parseReportTsv");
  const d = selectReportSchema({
    kind: "master",
    reportType: "Campaign",
    reportCreatedAt: "2026-10-01T00:00:00Z",
  });
  assert.ok(
    parseReportTsv(
      Buffer.from(
        "1001\tcmp-1\tname\t1\t1\t0\t\t\t2026-02-30T00:00:00Z\t\t0\t",
      ),
      d,
      { customerId: "1001" },
    ).reasons.length,
  );
  const c = await schema("AD_CONVERSION");
  assert.ok(
    parseReportTsv(
      Buffer.from(
        "2026-10-01\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t9\tinvented\t2\t300",
      ),
      c,
      { customerId: "1001" },
    ).reasons.length,
  );
});
test("uncertain collection crossing KST midnight cannot fabricate a D+1 slot", async () => {
  const { generationProof } = await import(
    "../src/naver/searchad/reporting/spend-evidence-service.js"
  );
  const job = {
    kind: "stat",
    claimId: "owned",
    remoteJobId: "1",
    statDate: "2026-10-01",
    registrationAttemptedAt: "2026-10-02T14:59:00Z",
    registrationInitiatedAt: "2026-10-02T14:59:00Z",
    registrationAcknowledgedAt: "2026-10-02T14:59:00Z",
    firstBuiltObservedAt: "2026-10-02T14:59:00Z",
  };
  assert.equal(
    generationProof(job, Date.parse("2026-10-02T15:01:00Z"), {
      version: "generation-window-v1",
      clockUncertaintyMs: 1000,
      rolloutUncertaintyMs: 1000,
    }).slot,
    null,
  );
});
test("pinned generation-boundary property table selects only strictly whole-side formats", async () => {
  const { selectReportSchema } = await module(
    "schema-registry",
    "selectReportSchema",
  );
  for (const [kind, type, boundary, before, after] of [
    ["stat", "ADEXTENSION", "2026-11-15T15:00:00Z", 15, 14],
    ["stat", "ADEXTENSION_CONVERSION", "2026-11-15T15:00:00Z", 14, 13],
    ["master", "Adgroup", "2026-07-15T15:00:00Z", 18, 19],
  ]) {
    const b = Date.parse(boundary);
    for (const [lo, hi, count] of [
      [-5000, -2000, before],
      [2000, 5000, after],
      [-1000, -1000, null],
      [1000, 1000, null],
      [-5000, 5000, null],
      [0, 0, null],
    ]) {
      const input = {
        kind,
        reportType: type,
        statDate: "2026-03-29",
        generationWindow: {
          lower: new Date(b + lo).toISOString(),
          upper: new Date(b + hi).toISOString(),
          policy: { rolloutUncertaintyMs: 1000 },
        },
      };
      if (count === null) assert.throws(() => selectReportSchema(input));
      else assert.equal(selectReportSchema(input).columns.length, count);
    }
  }
});
test("retired NAVERPAY cannot register new historical or current jobs", async () => {
  const { validateReportJobInput } = await import(
    "../src/naver/searchad/reporting/job-service.js"
  );
  for (const statDate of ["2025-04-08", "2025-04-09", "2026-10-01"])
    assert.throws(
      () =>
        validateReportJobInput({
          customerId: "1001",
          kind: "stat",
          reportType: "NAVERPAY_CONVERSION",
          statDate,
          intentKey: "retired",
        }),
      { code: "SEARCHAD_REPORT_TYPE_RETIRED" },
    );
});
test("official int and long overflow are rejected without losing exact safe large long cost", async () => {
  const { parseReportTsv } = await module("tsv-parser", "parseReportTsv");
  const d = await schema();
  assert.ok(
    parseReportTsv(
      Buffer.from(ad.replace("\t100\t2\t", "\t2147483648\t2\t")),
      d,
      { customerId: "1001" },
    ).reasons.length,
  );
  assert.ok(
    parseReportTsv(
      Buffer.from(ad.replace("\t110\t", "\t9223372036854775808\t")),
      d,
      { customerId: "1001" },
    ).reasons.length,
  );
  assert.equal(
    parseReportTsv(
      Buffer.from(ad.replace("\t110\t", "\t9007199254740993\t")),
      d,
      { customerId: "1001" },
    ).rows[0].costGrossKrw,
    "9007199254740993",
  );
});
test("VAT statDate boundary stays independent of generation and historical conversion enums remain exact", async () => {
  const { parseReportTsv } = await module("tsv-parser", "parseReportTsv");
  for (const [date, cost, basis, gross, net] of [
    ["2026-03-29", "100.5", "vat_excluded", null, "100.5"],
    ["2026-03-30", "111", "vat_included", "111", null],
  ]) {
    const d = await schema("AD", date, "2026-11-20T00:00:00Z");
    const row = parseReportTsv(
      Buffer.from(
        ad.replace("2026-10-01", date).replace("\t110\t", `\t${cost}\t`),
      ),
      d,
      { customerId: "1001" },
    ).rows[0];
    assert.deepEqual(
      [row.costBasis, row.costGrossKrw, row.costNetKrw],
      [basis, gross, net],
    );
  }
  for (const [date, valid, invalid] of [
    ["2024-07-02", "1", "purchase"],
    ["2024-07-03", "purchase", "1"],
  ]) {
    const d = await schema("AD_CONVERSION", date);
    const line = (type) =>
      `${date}\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t1\t${type}\t2\t300`;
    assert.equal(
      parseReportTsv(Buffer.from(line(valid)), d, { customerId: "1001" }).rows
        .length,
      1,
    );
    assert.equal(
      parseReportTsv(Buffer.from(line(invalid)), d, { customerId: "1001" }).rows
        .length,
      0,
    );
  }
});
test("master generation proof retains actual download completion separately from bounded generation time", async () => {
  const { generationProof } = await module(
    "spend-evidence-service",
    "generationProof",
  );
  const job = {
    kind: "master",
    claimId: "owned",
    remoteJobId: "master-1",
    reportCreatedAt: "2026-10-01T03:00:05Z",
    registrationAttemptedAt: "2026-10-01T03:00:00Z",
    registrationInitiatedAt: "2026-10-01T03:00:00Z",
    registrationAcknowledgedAt: "2026-10-01T03:00:10Z",
    firstBuiltObservedAt: "2026-10-01T03:00:10Z",
  };
  const proof = generationProof(job, Date.parse("2026-10-01T03:00:20Z"), {
    version: "generation-window-v1",
    clockUncertaintyMs: 1000,
    rolloutUncertaintyMs: 1000,
  });
  assert.equal(proof.downloadCompletedAt, "2026-10-01T03:00:20.000Z");
  assert.equal(proof.upper, "2026-10-01T03:00:06.000Z");
});

test("I1 crossing current generation quarantines at ingress and commit despite successful historical slots", async () => {
  const {
    ingestionJob: base,
    ingestionIdentity: identity,
    ingestionQueryFixture,
  } = await import("./helpers/searchad-ingestion-query-fixture.js");
  const { generationProof } = await import(
    "../src/naver/searchad/reporting/spend-evidence-service.js"
  );
  const { ReportIngestionService } = await import(
    "../src/naver/searchad/reporting/ingestion-service.js"
  );
  const { parseReportTsv } = await import(
    "../src/naver/searchad/reporting/tsv-parser.js"
  );
  const { blobHash } = await import(
    "../src/naver/searchad/reporting/blob-storage.js"
  );
  const job = {
    ...base,
    registrationAttemptedAt: "2026-10-05T14:59:00Z",
    registrationInitiatedAt: "2026-10-05T14:59:00Z",
    registrationAcknowledgedAt: "2026-10-05T14:59:00Z",
    firstBuiltObservedAt: "2026-10-05T14:59:00Z",
  };
  const now = Date.parse("2026-10-05T15:01:00Z");
  const policy = {
    version: "generation-window-v1",
    clockUncertaintyMs: 1000,
    rolloutUncertaintyMs: 1000,
  };
  const proof = generationProof(job, now, policy);
  const d = await schema();
  const bytes = Buffer.from(ad);
  const sha256 = blobHash(bytes);
  const blob = {
    key: `1001/${sha256}.tsv`,
    sha256,
    size: bytes.length,
    retainUntil: "2028-10-06T00:00:00Z",
  };
  const direct = ingestionQueryFixture({ job, schemaSha: d.orderedSchemaSha });
  const committed = await direct.repository.commitIngestion({
    job,
    identity,
    blob,
    schema: d,
    rows: parseReportTsv(bytes, d, { customerId: "1001" }).rows,
    proof,
    now,
    quality: "provisional",
  });
  assert.equal(committed.quality, "quarantined");
  assert.equal(direct.state.metrics.length, 0);
  assert.equal(direct.state.quarantined, true);
  const boundary = ingestionQueryFixture({
    job,
    schemaSha: d.orderedSchemaSha,
  });
  const service = new ReportIngestionService({
    repository: boundary.repository,
    jobService: { identity: async () => identity },
    downloadAdapter: {
      download: async () => ({
        bytes,
        job,
        identity,
        downloadCompletedAt: now,
      }),
    },
    storage: { put: async () => blob, get: async () => bytes },
    clock: () => now,
    generationPolicy: policy,
  });
  const result = await service.ingest({}, {});
  assert.equal(result.quality, "quarantined");
  assert.equal(boundary.state.metrics.length, 0);
});
test("I1 crossing persisted current generation cannot evaluate or select using historical D1 D2 D3", async () => {
  const {
    ingestionJob: job,
    ingestionIdentity: identity,
    ingestionQueryFixture,
  } = await import("./helpers/searchad-ingestion-query-fixture.js");
  const row = {
    ingestion_id: "old",
    report_job_id: job.reportJobId,
    report_kind: "stat",
    report_type: "AD",
    stat_date: "2026-10-01",
    processing_state: "ingested",
    quality: "stabilized_by_policy",
    generation_sha: "a",
    spec_sha: identity.specSha,
    credential_fingerprint: identity.credentialFingerprint,
    upstream_base_url: identity.upstreamBaseUrl,
    provenance_json: {
      complete: true,
      generationWindow: {
        lower: "2026-10-05T14:59:00Z",
        upper: "2026-10-05T15:01:00Z",
        slot: null,
        stableAge: true,
      },
    },
  };
  const f = ingestionQueryFixture({ ingestions: [row] });
  const result = await f.repository.evaluateGeneration({
    job,
    identity,
    now: Date.parse("2026-10-06T03:00:00Z"),
  });
  assert.equal(result.quality, "provisional");
  assert.equal(f.state.evidence.length, 0);
  assert.deepEqual(
    await f.repository.selectedIngestions(f.pool, { customerId: "1001" }),
    [],
  );
});
test("I2 late first evaluation retains collection time and cannot refresh stale generation evidence", async () => {
  const {
    ingestionJob: job,
    ingestionIdentity: identity,
    ingestionQueryFixture,
  } = await import("./helpers/searchad-ingestion-query-fixture.js");
  const proof = {
    lower: "2026-10-04T02:59:59.000Z",
    upper: "2026-10-04T03:00:01.000Z",
    downloadCompletedAt: "2026-10-04T03:00:00.000Z",
    slot: 3,
    stableAge: true,
  };
  const row = {
    ingestion_id: "old",
    report_job_id: job.reportJobId,
    report_kind: "stat",
    report_type: "AD",
    stat_date: "2026-10-01",
    processing_state: "ingested",
    quality: "stabilized_by_policy",
    generation_sha: "a",
    spec_sha: identity.specSha,
    credential_fingerprint: identity.credentialFingerprint,
    upstream_base_url: identity.upstreamBaseUrl,
    provenance_json: { complete: true, generationWindow: proof },
  };
  const f = ingestionQueryFixture({ ingestions: [row] });
  const now = Date.parse("2026-10-20T03:00:00Z");
  assert.equal(
    (await f.repository.evaluateGeneration({ job, identity, now })).quality,
    "stabilized_by_policy",
  );
  assert.equal(f.state.evidence[0].observed_at, "2026-10-04T03:00:00.000Z");
  assert.equal(f.state.evidence[0].stabilized_at, "2026-10-20T03:00:00.000Z");
  assert.equal(
    await f.repository.selectSpendEvidence({
      customerId: "1001",
      entityType: "creative",
      entityId: "ad-1",
      identity,
      now,
      maxAgeMs: 86400000,
    }),
    null,
  );
});
test("I3 commit accepts A A B natural-row dedupe while retaining physical row numbers 1 and 3", async () => {
  const {
    ingestionJob: job,
    ingestionIdentity: identity,
    ingestionQueryFixture,
  } = await import("./helpers/searchad-ingestion-query-fixture.js");
  const { generationProof } = await import(
    "../src/naver/searchad/reporting/spend-evidence-service.js"
  );
  const { parseReportTsv } = await import(
    "../src/naver/searchad/reporting/tsv-parser.js"
  );
  const { blobHash } = await import(
    "../src/naver/searchad/reporting/blob-storage.js"
  );
  const d = await schema();
  const bytes = Buffer.from(ad + ad + ad.replace("ad-1", "ad-2"));
  const rows = parseReportTsv(bytes, d, { customerId: "1001" }).rows;
  assert.deepEqual(
    rows.map((r) => r.rowNumber),
    [1, 3],
  );
  const now = Date.parse("2026-10-04T03:00:00Z");
  const proof = generationProof(job, now, {
    version: "generation-window-v1",
    clockUncertaintyMs: 1000,
    rolloutUncertaintyMs: 1000,
  });
  const sha256 = blobHash(bytes);
  const f = ingestionQueryFixture({ schemaSha: d.orderedSchemaSha });
  const result = await f.repository.commitIngestion({
    job,
    identity,
    blob: {
      key: `1001/${sha256}.tsv`,
      sha256,
      size: bytes.length,
      retainUntil: "2028-10-06T00:00:00Z",
    },
    schema: d,
    rows,
    proof,
    now,
    quality: "provisional",
  });
  assert.equal(result.rowCount, 2);
  assert.equal(f.state.committed, true);
  assert.deepEqual(
    f.state.staged.map((r) => r.rowNumber),
    [1, 3],
  );
  assert.equal(f.state.metrics.length, 2);
});
test("I2 freshness rejects future or nonfinite bounds and uses the inclusive conservative age limit", async () => {
  const {
    ingestionJob: job,
    ingestionIdentity: identity,
    ingestionQueryFixture,
  } = await import("./helpers/searchad-ingestion-query-fixture.js");
  const now = Date.parse("2026-10-20T03:00:00Z");
  for (const [lower, upper, slot, want] of [
    ["2026-10-21T03:00:00Z", "2026-10-21T03:00:01Z", 20, false],
    ["not-a-date", "2026-10-20T03:00:01Z", 19, false],
    ["2026-10-19T03:00:00Z", "2026-10-19T03:00:01Z", 18, true],
    ["2026-10-19T02:59:59Z", "2026-10-19T03:00:00Z", 18, false],
  ]) {
    const row = {
      ingestion_id: "old",
      report_job_id: job.reportJobId,
      report_kind: "stat",
      report_type: "AD",
      stat_date: "2026-10-01",
      processing_state: "ingested",
      quality: "stabilized_by_policy",
      generation_sha: "a",
      spec_sha: identity.specSha,
      credential_fingerprint: identity.credentialFingerprint,
      upstream_base_url: identity.upstreamBaseUrl,
      provenance_json: {
        complete: true,
        generationWindow: {
          lower,
          upper,
          downloadCompletedAt: upper,
          slot,
          stableAge: true,
        },
      },
    };
    const f = ingestionQueryFixture({ ingestions: [row] });
    f.state.evidence.push({ id: "saved" });
    const result = await f.repository.selectSpendEvidence({
      customerId: "1001",
      entityType: "creative",
      entityId: "ad-1",
      identity,
      now,
      maxAgeMs: 86400000,
    });
    assert.equal(Boolean(result), want, lower);
  }
});
