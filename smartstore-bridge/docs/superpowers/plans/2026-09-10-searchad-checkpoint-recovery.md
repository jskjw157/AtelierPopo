# SearchAd Validated Checkpoint Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This plan is recovery-only; do not start new Active Canary production code until the recovered checkpoint is published and verified.

**Goal:** Recover the already-validated SearchAd continuation checkpoint from the immutable staged bundle, publish it as a clean direct descendant of PR #11 head `56abf47c1eeb8124fa9fb8f4f60b81e36376c109`, and establish that recovered tree as the baseline for new Active Canary development.

**Architecture:** Treat `.searchad-bootstrap/chunk-*` as transport artifacts, not source code. Reassemble them, normalize transport whitespace only, verify the decoded tarball against its pinned SHA-256, apply the three pinned checkpoint patches from the exact PR baseline, verify the intermediate known tree, run full regression, then fast-forward the existing PR branch. Temporary bootstrap files/workflows must never enter the clean candidate.

**Tech Stack:** GitHub Actions, Git, Bash, SHA-256, base64/gzip/tar, Node.js 22, existing `npm test` regression suite.

**Spec:** `smartstore-bridge/docs/superpowers/specs/2026-09-10-searchad-active-canary-design.md`

## Global Constraints

- Base commit is exactly `56abf47c1eeb8124fa9fb8f4f60b81e36376c109`.
- Existing expected transport hash: `7c55eaf56e78b65acc12a821bf2d0db47e7a075dd8e412c5153693aa75f8eb44`.
- Existing expected decoded tarball hash: `ce87f97bef1b39e5c566e8c1441cd1186ddc883feb354ab999c20ff485db1eaf`.
- Existing expected first-patch tree: `7ae8e35407de4b954d99f6fcb9b3f23e5e3e2045`.
- Never change the expected TGZ hash merely to make CI green.
- Never apply a bundle whose decoded TGZ hash differs from the pinned expected hash.
- Never fast-forward PR #11 unless the clean candidate has the exact PR head as its parent, full regression passes, and temporary bootstrap files are absent.
- No main merge, production deployment, real SearchAd credential use, or real advertising mutation is part of this plan.

---

### Task 1: Diagnose staged bundle transport without applying it

**Files:**
- Modify temporarily: `.github/workflows/searchad-continuation-bootstrap.yml` on branch `codex/searchad-continuation-20260909`

**Expected current failure:** existing workflow concatenates uploaded chunks and verifies the raw base64 text hash before decode. The latest run failed at this raw text hash check; no patch was applied.

- [ ] Replace the first verification step with a diagnostic-only step that concatenates the chunks and prints these values:
  - raw concatenated byte count and SHA-256
  - count of CR/LF/space/tab transport whitespace
  - normalized base64 byte count and SHA-256 after `tr -d '\r\n\t '`
  - decoded TGZ byte count and SHA-256
  - `tar -tzf` file list when decode succeeds
- [ ] The diagnostic job must stop before any `git reset`, `git apply`, commit, push, or PR-branch update.
- [ ] Push only this workflow change to the staging branch and inspect the resulting GitHub Actions log.
- [ ] Classify the result:
  - **A:** normalized B64 hash and TGZ hash both match pinned values → whitespace-only transport mutation.
  - **B:** normalized B64 differs but TGZ hash matches → textual wrapper changed but binary payload is intact.
  - **C:** TGZ hash differs or decode/tar fails → bundle is not proven intact; STOP recovery.

**Diagnostic shell core:**

```bash
cat "${parts[@]}" > /tmp/searchad-patches.raw.b64
tr -d '\r\n\t ' < /tmp/searchad-patches.raw.b64 > /tmp/searchad-patches.normalized.b64
sha256sum /tmp/searchad-patches.raw.b64
sha256sum /tmp/searchad-patches.normalized.b64
base64 --decode /tmp/searchad-patches.normalized.b64 > /tmp/searchad-patches.tar.gz
sha256sum /tmp/searchad-patches.tar.gz
tar -tzf /tmp/searchad-patches.tar.gz
```

**Success criterion:** the pinned TGZ SHA-256 is reproduced. If it is not, do not continue.

---

### Task 2: Repair the recovery workflows with binary immutability as the authority

**Files:**
- Modify: `.github/workflows/searchad-continuation-bootstrap.yml`
- Modify: `.github/workflows/searchad-continuation-publish.yml`

**Precondition:** Task 1 produced the exact pinned TGZ SHA-256.

- [ ] Normalize only base64 transport whitespace before decode.
- [ ] Keep a diagnostic raw B64 hash in logs, but do not use newline-sensitive raw wrapper bytes as the binary integrity authority.
- [ ] Decode normalized base64.
- [ ] Require decoded TGZ hash to equal `ce87f97bef1b39e5c566e8c1441cd1186ddc883feb354ab999c20ff485db1eaf` before extraction.
- [ ] Require all three expected patch filenames to be present.
- [ ] Keep `git apply --check` before each patch.
- [ ] After the first patch, require `git write-tree` to equal `7ae8e35407de4b954d99f6fcb9b3f23e5e3e2045`.
- [ ] After all patches, require `git diff --check`.
- [ ] Do not weaken/remove the clean-candidate checks that reject `.searchad-bootstrap/**` and `.github/workflows/searchad-continuation-*` from candidate history.

**Verification:** trigger the bootstrap workflow. It must proceed past binary verification and patch application.

---

### Task 3: Reconstruct and regression-test the clean checkpoint

**Files:** no manual production-file edits. The immutable patches produce the candidate.

- [ ] Reset workflow workspace to exact base SHA before applying the patches.
- [ ] Apply `*56abf47*.patch`.
- [ ] Verify first-patch tree exactly.
- [ ] Apply `*308_BASELINE*.patch`.
- [ ] Apply `*904b648*.patch`.
- [ ] Record final tree SHA in workflow output/log.
- [ ] Verify required checkpoint artifacts exist, including:
  - `smartstore-bridge/migrations/postgres/0017_searchad_circuit_execution_projection.sql`
  - `smartstore-bridge/docs/SEARCHAD_REPORTING_CIRCUIT_AUTOMATION_2026-09-08.md`
- [ ] Run from `smartstore-bridge`:

```bash
npm ci
npm test
```

- [ ] If the recovered checkpoint includes its own focused SearchAd/PG/safety commands, run those unchanged as additional verification.
- [ ] Commit the exact recovered tree as one clean commit whose single parent is the exact PR #11 base SHA.
- [ ] Verify the candidate tree contains no staging chunks and no continuation bootstrap/publish workflows.

**Success criterion:** clean candidate + full regression green, with exact parent relationship and no temporary recovery files.

---

### Task 4: Publish the recovered checkpoint to the existing PR branch

**Files:** branch refs only.

- [ ] Fetch `codex/searchad-write-execution-v0.7.0` immediately before publishing.
- [ ] Require its remote head to still equal `56abf47c1eeb8124fa9fb8f4f60b81e36376c109`; abort if it moved unexpectedly.
- [ ] Require PR head to be an ancestor of the candidate.
- [ ] Fast-forward, never force-push, the PR branch to the clean candidate.
- [ ] Move staging branch to the same clean candidate with force-with-lease only after PR publication succeeds.
- [ ] Verify PR #11 remains open/unmerged and now points to the recovered clean candidate.
- [ ] Verify `main` remains unchanged.

**Success criterion:** PR #11 head == validated candidate; main unchanged; no real SearchAd call occurred.

---

### Task 5: Rebase the Active Canary continuation baseline onto the recovered checkpoint

**Files:**
- Preserve/recreate: `smartstore-bridge/docs/superpowers/specs/2026-09-10-searchad-active-canary-design.md`
- Preserve/recreate: `smartstore-bridge/docs/superpowers/plans/2026-09-10-searchad-checkpoint-recovery.md`
- Later create: `smartstore-bridge/docs/superpowers/plans/2026-09-10-searchad-active-canary-implementation.md`

- [ ] Point `codex/searchad-active-canary-20260910` at the recovered clean checkpoint before production-code implementation.
- [ ] Recreate the approved Active Canary design doc on top if resetting the branch drops the documentation commits.
- [ ] Recreate this recovery plan for traceability if needed.
- [ ] Run baseline regression on the branch before adding Canary code.
- [ ] Only after the recovered baseline is proven green, write the separate Active Canary implementation plan and begin TDD.

## Final Verification

- [ ] Pinned TGZ hash reproduced exactly.
- [ ] Intermediate first-patch tree reproduced exactly.
- [ ] All three expected patch files applied with `git apply --check` first.
- [ ] Full recovered regression is green.
- [ ] Candidate parent is exact PR #11 head baseline.
- [ ] Temporary chunks/workflows are absent from candidate.
- [ ] PR #11 fast-forwarded only after verification.
- [ ] `main` unchanged.
- [ ] Real SearchAd calls/mutations: 0.
- [ ] Active Canary production code not started until recovery completes.
