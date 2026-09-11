# SearchAd recovery status — 2026-09-12

## Current checkpoint

- Working branch: `codex/searchad-original-recovery-20260912`.
- Draft PR: [#24](https://github.com/jskjw157/AtelierPopo/pull/24), targeting `codex/searchad-recovery-2026-09-11`; no merge performed.
- Protected baseline: `0adbd11359440efe43fd07c279bd01a4d8914568`.
- Verified code and CI checkpoint: `2ae179df3ea3acde9ac2dbb45ab3c1acf6544a05`.
- Completed successful CI: [34656800240](https://github.com/jskjw157/AtelierPopo/actions/runs/34656800240), job `103450869074`.
- Recovery scope reached: Stage 0007 Active Canary core, internal Gateway boundary, role-specific HTTP routes/authentication, and application bootstrap wiring. This is not a live-account activation or a complete recovery through 0019.

This document supersedes the **current-status and remaining-wiring statements** in `SEARCHAD_ORIGINAL_RECOVERY_0007_20260912.md`. That earlier document remains the historical record of the core-only checkpoint `48a61c1cced006bdf08baa06bc8b149a23b7c70b` and its 190-test suite. Gateway, HTTP, and bootstrap wiring were genuinely missing at that checkpoint and have now been restored.

## Work completed in this increment

Six production files were restored as exact Git blobs from historical source `29fa2214ba8cd62edb0ba92d23c1b3d1a1303ef6`. Paths are relative to `smartstore-bridge/`.

| Path | Historical/restored blob SHA |
| --- | --- |
| `src/naver/searchad/gateway.js` | `0ce28568d406119369b2156bd1d87c49a32e8e5d` |
| `src/bootstrap-v05.js` | `c3c6fb479c4d6fac279ecc8f30276092b44d9572` |
| `src/http/server-v05.js` | `6fe63d8981c7d818f55b2a6a78bf3c9a0b9ea9f9` |
| `src/http/searchad-access-control.js` | `7524eab3ebd31bb63bb34c4d58fc66b47cfff4e5` |
| `src/http/routes-searchad-canary.js` | `c89df83aa2d24ead36980b6e407df63ac188452e` |
| `src/http/openapi-searchad-canary.js` | `aaf96f35a39f3e16696a528dec217b4025f9fbb8` |

CI verifies these six hashes plus the nine previously restored core/migration hashes. The preservation check makes six explicit, hash-checked wiring exceptions rather than silently dropping baseline protection. The asynchronous `src/naver/searchad/write/` subsystem, write HTTP runtime, dependencies, and migrations 0001–0006 remain unchanged from the protected baseline. Migration head remains 0007.

The ordinary Gateway path remains unchanged and cannot be opened by caller-supplied Canary hints. The internal `executeCanary` path requires its dedicated gate, runtime allowlist, verification tier, exact confirmations, and Customer credentials; mutation retries remain disabled. The service additionally restricts execution to its server-owned recipe, authenticated Admin and matching passive evidence.

Canary HTTP routes use role-specific credentials with explicit Customer grants. Reader cannot invoke Admin actions. Generic HAAR keys and SearchAd role keys are not interchangeable. This is Canary-specific access wiring, not the later 0008 activation-control subsystem. The dedicated Canary gate is intentionally distinct from the general write gate; no production environment flags were changed.

## Tests and their actual boundary

Four original contract files were restored unchanged:

- `test/searchad-gateway-active-canary.test.js`
- `test/searchad-http-access.test.js`
- `test/searchad-http-canary-routes.test.js`
- `test/searchad-http-canary-server.test.js`

A new required integration test was added: `test/postgres-searchad-canary-wiring.integration.test.js`.

This test composes real PostgreSQL storage, migrations, the pinned operation registry, credential registry, signing client, Gateway, remote adapter, recipe and Canary service. **Only the upstream fetch response boundary is simulated.** It uses isolated, synthetic Customer/evidence IDs and test credentials. There is no live Naver network request.

The verified path is stopped WEB_SITE campaign creation, returned-ID readback, baseline stats, budget change, readback, restoration, readback, deletion, and deletion readback. It verifies the exact nine-request sequence, four mutation audit records with request IDs, persisted cleanup, repository re-instantiation, and ordinary write/create/delete gates remaining OFF. Reader access, extra execution input, and absent evidence are rejected before the simulated upstream is called.

The resulting run is **`spend_check_pending`**, with no active verification evidence issued. A successful execution test is not equivalent to a passed live Canary. The existing core tests separately exercise the observation-window and invalid-spend safeguards.

HTTP server/authentication tests and real-PostgreSQL Gateway composition tests are separate tests. This increment does not claim one end-to-end test of application bootstrap, HTTP, PostgreSQL, and live Naver in a single deployment.

## Observed RED/GREEN evidence

| Checkpoint | Actions evidence | Observed result |
| --- | --- | --- |
| `b5991045e72fae8e35ab7f777e683f6265ecea50` | Run `34656145475`, job `103448882001` | Original Gateway contracts fail because `executeCanary` is missing; full suite 191 passed / 3 failed |
| `a9b2e407bb966f36c4fa607b5de9b644c83bb55b` | Run `34656635593`, job `103450379025` | New PostgreSQL composition test fails with `SEARCHAD_CANARY_GATEWAY_REQUIRED` |
| `2ae179df3ea3acde9ac2dbb45ab3c1acf6544a05` | Run `34656800240`, job `103450869074` | Every configured verification step completed successfully |

Verified results at `2ae179d`:

| Check | Result |
| --- | --- |
| Canary core, Gateway and HTTP focused tests | 51 passed, 0 failed, 0 skipped |
| Existing SearchAd write focused tests | 41 passed, 0 failed, 0 skipped |
| Required PostgreSQL integration suite | 7 passed, 0 failed, 0 skipped |
| Repeated Canary PostgreSQL contracts | 2 passed, 0 failed, 0 skipped |
| Full regression suite | **212 passed, 0 failed, 0 skipped** |
| Original production blob provenance | 15 hashes matched |
| Protected baseline preservation | Passed |
| Syntax and existing static checks | Passed |
| Existing write safety scan | Passed; no raw network calls in write subsystem |
| Bundled Commerce manifest coverage | 116 operations |
| Bundled SearchAd manifest coverage | 126 unique, 117 runtime allowlisted, no internal/deprecated leaks |
| Migration reruns | Both report 0007 with `applied: []` |
| Bridge production dependency audit | 0 vulnerabilities reported |

Focused and PostgreSQL counts overlap the full suite; do not add them to 212. Manifest coverage is not live verification of those operations. The dependency audit ran in `smartstore-bridge`; root package files were preserved but root dependencies were not reaudited here.

## Remaining scope — original 0019 goal

The historical PR11 checkpoint report [comment 5592947573](https://github.com/jskjw157/AtelierPopo/pull/11#issuecomment-5592947573) explicitly describes local checkpoint `a647bca283ced37be3c6c0a53979616d2fc53a7d`, migration 0019, automation lifecycle Canary, a durable worker, and operation validation. The same report explicitly says **code was not published**. Its historical 420-test claim is not a current recovery test result and is not a valid completion-percentage denominator.

The goal therefore is not merely reaching migration 0010. Remaining work is grouped below for tracking, not as equal-sized effort units or a delivery-time estimate.

| Group | Remaining work | Source/recovery status |
| --- | --- | --- |
| 0008 Activation Control | Durable passive evidence and scoped activation approval/guards, account controls and revocation | Historical source available at `f20111858c3b52bae2c7249702a73b998a6eed37`; not imported into this branch |
| 0009 Hierarchy/Lifecycle | Entity relationships and lifecycle creation/deletion safeguards | Historical source available; not imported |
| 0010 Reporting Evidence | Statistics/report workflows and trusted reporting evidence | Historical source available; not imported |
| Later functionality through 0019 | Later safety/monetary controls, Circuit, automation lifecycle, durable worker/schedules, and operation-validation registry | Historical descriptions exist; complete source/provenance and integration still need recovery and verification. Do not assume the local-only checkpoint is present on GitHub |
| Integrated and operational verification | Review, deployment/migration readiness, environment-specific checks, real Passive Capability, separately approved stopped Canary, observation and scoped activation | Not performed by this recovery work; live effects require separate authorization |

Migration counts do not measure equal effort. Neither 7/19 nor 212/420 represents a defensible completion percentage. The remaining later source recovery is a material uncertainty.

## Next implementation unit and safety boundary

Next unit: restore 0008 Activation Control from the available original source, with original contracts first, real PostgreSQL composition checks, and explicit integration changes. Preserve the recovered async write contracts and the verified Canary/Gateway path. Any changes to provenance-protected files must update the record and tests explicitly; do not wholesale replace the historical write directory.

No live SearchAd request, production ad mutation, Passive Probe, Active Canary run, production DB migration, Hostinger deployment, operational gate enablement, or merge was performed. CI fixture evidence must never be promoted or represented as real-account validation evidence.
