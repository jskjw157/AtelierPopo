import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NaverSearchAdClient } from "../src/naver/searchad/client.js";
import { reportingFixture } from "./helpers/searchad-completion-fixture.js";
async function transport(fetchImpl, maxBytes = 64) {
  const mod = await import(
    "../src/naver/searchad/transport/report-download.js"
  ).catch(() => ({}));
  assert.equal(
    typeof mod.ReportDownloadTransport,
    "function",
    "download capability is implemented separately from raw operations",
  );
  const f = reportingFixture();
  return new mod.ReportDownloadTransport({
    client: new NaverSearchAdClient({
      credentialsRegistry: f.credentialsRegistry,
      fetchImpl,
      clock: () => 1790000000000,
      maxRetries: 0,
      logger: {},
    }),
    maxBytes,
  });
}
test("download_signature_uses_path_only_and_preserves_fileVersion", async () => {
  let calls = 0;
  const t = await transport(async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      "https://api.searchad.naver.com/report-download?authtoken=secret%2Btoken&fileVersion=v2",
    );
    assert.equal(init.redirect, "error");
    assert.equal(
      init.headers["X-Signature"],
      createHmac("sha256", "fixture-secret")
        .update("1790000000000.GET./report-download")
        .digest("base64"),
    );
    return new Response("ok");
  });
  assert.equal(
    (
      await t.download({
        customerId: "1001",
        url: "https://api.searchad.naver.com/report-download?authtoken=secret%2Btoken&fileVersion=v2",
      })
    ).toString(),
    "ok",
  );
  assert.equal(calls, 1);
});
test("download_rejects_redirect_ssrf_duplicate_token_and_oversize", async () => {
  let calls = 0;
  const t = await transport(async () => {
    calls++;
    return new Response("oversize");
  }, 3);
  for (const url of [
    "http://api.searchad.naver.com/report-download?authtoken=x",
    "https://evil.test/report-download?authtoken=x",
    "https://api.searchad.naver.com/report-download?authtoken=x&authtoken=y",
    "https://api.searchad.naver.com/report-download?authtoken=x&other=y",
    "https://api.searchad.naver.com/%72eport-download?authtoken=x",
    "https://api.searchad.naver.com:443/report-download?authtoken=x",
  ])
    await assert.rejects(t.download({ customerId: "1001", url }));
  assert.equal(calls, 0);
  await assert.rejects(
    t.download({
      customerId: "1001",
      url: "https://api.searchad.naver.com/report-download?authtoken=x",
    }),
    { code: "SEARCHAD_REPORT_DOWNLOAD_FAILED" },
  );
  const redirect = await transport(
    async () =>
      new Response("", {
        status: 302,
        headers: { location: "https://evil.test" },
      }),
  );
  await assert.rejects(
    redirect.download({
      customerId: "1001",
      url: "https://api.searchad.naver.com/report-download?authtoken=x",
    }),
  );
});
test("download_token_absent_from_db_errors_logs", async () => {
  const t = await transport(async () => {
    throw new Error("authtoken=secret-token");
  });
  try {
    await t.download({
      customerId: "1001",
      url: "https://api.searchad.naver.com/report-download?authtoken=secret-token",
    });
    assert.fail();
  } catch (error) {
    assert.equal(JSON.stringify(error).includes("secret-token"), false);
    assert.equal(String(error).includes("secret-token"), false);
    assert.equal(error.cause, undefined);
  }
});
test("bounded client cancels oversized and inconsistent bodies without changing ordinary JSON responses", async () => {
  const f = reportingFixture();
  const c = new NaverSearchAdClient({
    credentialsRegistry: f.credentialsRegistry,
    maxRetries: 0,
    fetchImpl: async () =>
      new Response("abcdef", { headers: { "content-length": "2" } }),
  });
  await assert.rejects(
    c.request({
      customerId: "1001",
      path: "/report-download",
      responseType: "arrayBuffer",
      maxBodyBytes: 3,
      redirectPolicy: "error",
    }),
  );
  c.fetchImpl = async () =>
    new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
  assert.deepEqual(
    (await c.request({ customerId: "1001", path: "/stats" })).data,
    { ok: true },
  );
});

async function composedDownloadFixture(
  t,
  {
    kind = "stat",
    responseChange = {},
    rotateAfterGet = false,
    rotateAfterFile = false,
  } = {},
) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { createReportingRuntime } = await import(
    "../src/naver/searchad/reporting/runtime.js"
  );
  const { LocalReportStorage } = await import(
    "../src/naver/searchad/reporting/blob-storage.js"
  );
  const { REPORT_OPERATION_KEYS } = await import(
    "../src/naver/searchad/reporting/operations.js"
  );
  const f = reportingFixture();
  const now = Date.parse("2026-10-05T03:00:00Z");
  const calls = [],
    persisted = [];
  const reportJobId = "11111111-1111-1111-1111-111111111111";
  const remoteJobId = kind === "stat" ? "51" : "master-51";
  const reportType = kind === "stat" ? "AD" : "Campaign";
  const uri =
    kind === "stat" ? "/stat-reports/51" : "/master-reports/master-51";
  const identity = f.identityResolver("1001");
  const job = {
    ...identity,
    customerId: "1001",
    reportJobId,
    kind,
    reportType,
    statDate: kind === "stat" ? "2026-10-01" : null,
    fromTime: null,
    claimId: "22222222-2222-2222-2222-222222222222",
    remoteJobId,
    processingState: "built",
    quality: "provisional",
    reportCreatedAt: kind === "stat" ? null : new Date(now).toISOString(),
    registrationAttemptedAt: new Date(now).toISOString(),
    registrationInitiatedAt: new Date(now).toISOString(),
    registrationAcknowledgedAt: new Date(now).toISOString(),
    firstBuiltObservedAt: new Date(now).toISOString(),
  };
  const content = Buffer.from(
    kind === "stat"
      ? "2026-10-01\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t100\t2\t110\t100\t0\n"
      : "1001\tcmp-1\tCampaign\t1\t1\t0\t\t\t2026-10-01T00:00:00Z\t\t0\t\n",
  );
  const response = {
    ...(kind === "stat"
      ? {
          reportJobId: 51,
          reportTp: reportType,
          statDt: "2026-09-30T15:00:00Z",
          updateTm: new Date(now).toISOString(),
        }
      : {
          id: remoteJobId,
          item: reportType,
          updateTime: new Date(now).toISOString(),
        }),
    status: "BUILT",
    downloadUrl:
      "https://api.searchad.naver.com/report-download?authtoken=private-composed-token&fileVersion=v2",
    ...responseChange,
  };
  f.gateway.client.fetchImpl = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, "https://api.searchad.naver.com");
    assert.ok([uri, "/report-download"].includes(target.pathname));
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["X-Customer"], "1001");
    assert.equal(
      init.headers["X-Signature"],
      createHmac("sha256", "fixture-secret")
        .update(`${now}.GET.${target.pathname}`)
        .digest("base64"),
    );
    calls.push(target.pathname);
    if (target.pathname === uri) {
      if (rotateAfterGet) f.rotate();
      return Response.json(response);
    }
    assert.equal(
      target.searchParams.get("authtoken"),
      "private-composed-token",
    );
    assert.equal(target.searchParams.get("fileVersion"), "v2");
    if (rotateAfterFile) f.rotate();
    return new Response(content);
  };
  f.gateway.client.clock = () => now;
  f.gateway.client.redirectPolicy = "error";
  const repository = {
    async createReportIntent() {
      assert.fail("download cannot register");
    },
    async getReportJob(scope) {
      return scope.customerId === "1001" && scope.reportJobId === reportJobId
        ? structuredClone(job)
        : null;
    },
    async settleReportJob(input) {
      persisted.push(structuredClone(input));
      assert.equal(input.customerId, "1001");
      assert.equal(input.reportJobId, reportJobId);
      return structuredClone(job);
    },
    async getIngestionBinding() {
      return null;
    },
    async commitIngestion(input) {
      persisted.push(structuredClone(input));
      return {
        reportJobId,
        rowCount: input.rows.length,
        quality: input.quality,
      };
    },
    async quarantineIngestion(input) {
      persisted.push(structuredClone(input));
      return { reportJobId, quality: "quarantined", rowCount: 0 };
    },
  };
  const root = await mkdtemp(path.join(tmpdir(), "composed-report-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = await createReportingRuntime({
    ...f,
    repository,
    pool: {
      query() {
        assert.fail("GET must not use mutation SQL");
      },
      connect() {
        assert.fail("GET must not acquire mutation connection");
      },
    },
    blobStorage: new LocalReportStorage({ root }),
    clock: () => now,
    reportingConfig: {
      enabled: true,
      allowReportingJobs: false,
      generationPolicy: {
        version: "generation-window-v1",
        clockUncertaintyMs: 1000,
        rolloutUncertaintyMs: 1000,
      },
    },
  });
  t.after(() => runtime.close());
  return {
    runtime,
    gateway: f.gateway,
    calls,
    persisted,
    content,
    input: { customerId: "1001", reportJobId },
    context: {
      principal: {
        principalId: "operator",
        role: "operator",
        customerIds: ["1001"],
      },
      requestId: "composed-download",
    },
    key:
      kind === "stat"
        ? REPORT_OPERATION_KEYS.getStat
        : REPORT_OPERATION_KEYS.getMaster,
    request: {
      customerId: "1001",
      pathParams:
        kind === "stat" ? { reportJobId: remoteJobId } : { id: remoteJobId },
    },
  };
}
for (const kind of ["stat", "master"])
  test(`composed ${kind} download consumes the private URL while public generic GET remains redacted`, async (t) => {
    const f = await composedDownloadFixture(t, { kind });
    await assert.rejects(
      f.runtime.ingestionService.ingest(f.input, {
        ...f.context,
        principal: { ...f.context.principal, role: "reader" },
      }),
      { status: 403 },
    );
    assert.equal(f.calls.length, 0);
    const result = await f.runtime.ingestionService.ingest(f.input, f.context);
    assert.equal(result.rowCount, 1);
    assert.equal(result.quality, "provisional");
    assert.equal(f.calls.filter((p) => p === "/report-download").length, 1);
    assert.equal(
      JSON.stringify(f.persisted).includes("private-composed-token"),
      false,
    );
    assert.equal(JSON.stringify(result).includes("downloadUrl"), false);
    const publicRead = await f.gateway.execute(f.key, f.request);
    assert.equal(publicRead.data.downloadUrl, "[REDACTED]");
    assert.equal(
      JSON.stringify(publicRead).includes("private-composed-token"),
      false,
    );
  });
for (const [label, options] of [
  ["wrong returned ID", { responseChange: { reportJobId: 52 } }],
  ["wrong report type", { responseChange: { reportTp: "AD_DETAIL" } }],
  ["not BUILT", { responseChange: { status: "REGIST" } }],
  ["identity rotation after job GET", { rotateAfterGet: true }],
  [
    "untrusted download origin",
    {
      responseChange: {
        downloadUrl:
          "https://evil.invalid/report-download?authtoken=private-composed-token",
      },
    },
  ],
])
  test(`composed download rejects ${label} before any signed file request`, async (t) => {
    const f = await composedDownloadFixture(t, options);
    await assert.rejects(
      f.runtime.ingestionService.ingest(f.input, f.context),
      (error) => {
        assert.equal(error.code, "SEARCHAD_REPORT_DOWNLOAD_FAILED");
        assert.equal(error.cause, undefined);
        assert.equal(
          JSON.stringify(error).includes("private-composed-token"),
          false,
        );
        return true;
      },
    );
    assert.equal(f.calls.filter((p) => p === "/report-download").length, 0);
    assert.equal(
      JSON.stringify(f.persisted).includes("private-composed-token"),
      false,
    );
  });
test("internal transient capability rejects list, advertising, raw flags and unbound paths", async (t) => {
  const { REPORT_OPERATION_KEYS } = await import(
    "../src/naver/searchad/reporting/operations.js"
  );
  const f = await composedDownloadFixture(t);
  const consume = () =>
    assert.fail("invalid request cannot consume a provider response");
  for (const key of [
    REPORT_OPERATION_KEYS.listStat,
    REPORT_OPERATION_KEYS.listMaster,
    REPORT_OPERATION_KEYS.registerStat,
  ])
    await assert.rejects(
      f.gateway.consumeReportDownloadResponse(key, f.request, consume),
      { code: "SEARCHAD_REPORT_OPERATION_FORBIDDEN" },
    );
  const advertising = f.gateway.registry.manifest.operations.find(
    (op) => op.path === "/ncc/campaigns" && op.method === "GET",
  ).operationKey;
  await assert.rejects(
    f.gateway.consumeReportDownloadResponse(advertising, f.request, consume),
    { code: "SEARCHAD_REPORT_OPERATION_FORBIDDEN" },
  );
  for (const request of [
    { ...f.request, raw: true },
    { ...f.request, unredacted: true },
    { ...f.request, query: { authtoken: "invented" } },
    { customerId: "1001", pathParams: { reportJobId: "51/other" } },
    { customerId: "1001", pathParams: { reportJobId: "51", id: "other" } },
  ])
    await assert.rejects(
      f.gateway.consumeReportDownloadResponse(f.key, request, consume),
      { code: "SEARCHAD_REPORT_INPUT_INVALID" },
    );
  await assert.rejects(
    f.runtime.ingestionService.ingest(
      { ...f.input, customerId: "2002" },
      f.context,
    ),
    { status: 403 },
  );
  assert.equal(f.calls.length, 0);
  const publicRead = await f.gateway.execute(f.key, {
    ...f.request,
    raw: true,
    unredacted: true,
  });
  assert.equal(publicRead.data.downloadUrl, "[REDACTED]");
  assert.equal(
    JSON.stringify(publicRead).includes("private-composed-token"),
    false,
  );
});
test("internal report GET retains read gates and scrubs its temporary response reference", async (t) => {
  const f = await composedDownloadFixture(t);
  f.gateway.config.allowReads = false;
  await assert.rejects(
    f.gateway.consumeReportDownloadResponse(f.key, f.request, () =>
      assert.fail(),
    ),
    { code: "SEARCHAD_GATE_DISABLED" },
  );
  assert.equal(f.calls.length, 0);
  f.gateway.config.allowReads = true;
  let consumed;
  const result = await f.gateway.consumeReportDownloadResponse(
    f.key,
    f.request,
    (data) => {
      consumed = data;
      assert.equal(typeof data.downloadUrl, "string");
      return { received: true };
    },
  );
  assert.deepEqual(result, { received: true });
  assert.equal(consumed.downloadUrl, undefined);
  assert.equal(
    JSON.stringify(result).includes("private-composed-token"),
    false,
  );
});
test("composed download rejects identity rotation during file response before archive or promotion", async (t) => {
  const f = await composedDownloadFixture(t, { rotateAfterFile: true });
  await assert.rejects(f.runtime.ingestionService.ingest(f.input, f.context), {
    code: "SEARCHAD_REPORT_DOWNLOAD_FAILED",
  });
  assert.equal(f.calls.filter((p) => p === "/report-download").length, 1);
  assert.equal(
    f.persisted.some((value) => Array.isArray(value.rows)),
    false,
  );
  assert.equal(
    JSON.stringify(f.persisted).includes("private-composed-token"),
    false,
  );
});
