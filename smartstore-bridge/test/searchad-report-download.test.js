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
