# SearchAd operation validation registry and execution source audit

The registry is descriptive, immutable data for the pinned spec
`8e250490ab748367a627213f7d7a2917e005cb10`. It classifies all 126 unique raw
operation keys. It never issues evidence, grants activation, consumes an
approval, changes the 117-operation runtime descriptor allowlist, or enables
any of the nine internal operations. Every operation currently has
`liveVerified:false`; offline fixtures are not live Customer proof.

| State | Count | Current bounded meaning |
| --- | ---: | --- |
| `implemented_canary_proven_family` | 4 | Stopped WEB_SITE campaign create/read/budget delta-and-restore/owned canary cleanup code family, covered by offline recipe and PostgreSQL fixtures. The family does not cover every field, campaign type or Customer. |
| `implemented_manual_only` | 18 | Single-entity fixed-field stats; six stat/master registration/get/list contracts; eight exact hierarchy create/read/owned-leaf cleanup contracts; three descendant inventory reads. Each row names its bounded scope and actual source/test references. This is a validation classification: configured observation/report workers retain their existing independent gates and protocol. |
| `public_unverified` | 95 | Pinned public descriptor/generic gateway support only, with no assertion of an operation-specific implementation or live validation. |
| `internal_or_quarantined` | 9 | Pinned internal descriptors excluded from runtime execution. |

Ordinary campaign `userLock` and budget changes still need their exact existing
activation fields, Customer/spec/credential bindings, one-shot approval,
Circuit checks and the final account send fence. Canary-family membership is
never accepted by any of those guards. Public campaign/adgroup parent cleanup
remains absent with `cleanup:false`; remote absence across unmanaged descendants
and external writers remains unresolved. Canary-owned cleanup has its distinct
bounded existing protocol.

Signed report download is listed separately as `signed_report_download`, an
internal owned-job transport capability with exact origin/path/query, identity,
redirect and size checks. It is not a 127th Swagger operation and grants no
arbitrary URL capability.

`GET /api/v1/searchad/validation/operations?customerId=1001` requires an
explicitly scoped Reader principal or higher. Optional `state` accepts only the
four values above. Duplicate/unknown query fields and invalid states are
rejected. The response returns `descriptiveOnly:true`, immutable `items`, source
pin and separate `transportCapabilities`. There is no POST, activate, promote
or evidence-issuing validation route. The completion bootstrap creates the
service; role OpenAPI documents include only the Reader GET.

## Static source audit

Run from `smartstore-bridge`:

```sh
node scripts/searchad-execution-safety.mjs
node scripts/searchad-validation-coverage.mjs
npm run searchad:coverage
node scripts/searchad-write-safety.mjs
```

The expanded scanner parses ECMAScript with pinned Acorn 8.15.0. It recursively
visits every `.js`, `.mjs` and `.cjs` under `src`, so newly added nested write,
canary, lifecycle, reporting, circuit, automation, worker, validation,
profitability, HTTP routes and bootstrap/entrypoint files are included. It also
follows static and statically resolvable dynamic relative imports/re-exports,
including dependencies outside `src` but inside the project. Missing sources,
unresolved local imports, parse errors, outside-root imports and source symlinks
fail closed. The root itself is canonicalized for macOS `/var`/`/private/var`.

It detects direct/global/computed fetch, alias chains, destructured fetch/raw
request, injected fetch aliases, bound/object-carried aliases, network imports
and dynamic imports/requires, HTTP/HTTPS/undici/axios/WebSocket and raw client
request/send calls. Unresolved dynamic imports, direct or object-contained
network capability exports, capability returns (including arrow returns), and
known capabilities passed as call/constructor arguments are rejected unless the
exact injection site is reviewed. This conservatively rejects capability
escape at its source; it does not claim general cross-module data-flow analysis.
Potentially callable `.request` values also participate in export, argument and
return checks, including destructured aliases and containers. Ordinary request
data is recognized only through a bounded literal/const proof or the exact
metadata records below; object or variable spelling does not establish data.
The local proof excludes getters, functions and spreads, rejects ambiguous or
reassigned bindings, and is disabled by member writes in the module. It is not
a general interprocedural type proof. Unshadowed, unmodified one-argument
`JSON.stringify` is a serialization sink for request candidates; replacers and
known fetch capabilities retain escape checks. Harmless callbacks and data
objects remain valid.

`REVIEWED_TRANSPORT_BOUNDARIES` contains **55 explicit contextual records for
56 AST findings**: the original 38 call/import findings plus 18 exact existing
capability injection sites. A record pins file, kind, invocation-node SHA256,
**enclosing function/method context SHA256**, context name/type, occurrence
count, rationale and test references. Nested callbacks bind to their outer
function/method, including the existing guard and delegation setup. Module
imports bind to their exact import declaration. Changed guard predicates or
moving identical calls to another method invalidate the record. Additional
calls are still detected independently; no whole file/directory is exempted.
The two original identical fence invocations retain one count-2 record in the
same guarded method, while identical Drive calls in different methods now have
separate context records.

Gateway/client wrappers are `raw_client_delegation`, actual outbound entries
are `network_initiation`, module imports are `network_import`, and explicit
transport injection sites are `network_capability_transfer`. Existing approved
gateway methods and authentic account-fence fetch delegation are not labeled as
raw initiation.

The fence delegation exception requires an import of the exact named export
from `src/naver/searchad/lifecycle/postgres-account-send-fence.js` and a pinned
integrity digest of that reviewed module. This integrity check establishes
constructor provenance only: the module and its calls are still scanned and
must match their separate contextual records. Constructor/instance aliases and
namespace imports are supported. Ambiguous or shadowed declarations,
reassignments (including destructuring), method tampering, unrelated imports,
and local namesake classes receive no trusted delegation exception. Ambiguity
is conservatively rejected across the current module rather than guessed safe
from a spelling or neighboring scope.

Reviewed boundaries remain the SearchAd client request entry; four gateway raw
client delegations; two account-fence entries; the private mutation-gateway
captured transport entry; the inventory origin/redirect wrapper; signed report
download delegation; report archive SDK import and put/get delegations; pinned
spec-maintenance download; existing Commerce/Cafe24/Drive auth and client
transport/delegations; and four inbound HTTP server imports. The 18 newly
explicit injection records are unchanged application/bootstrap, hierarchy
constructor/factory, report/write client, Drive token-provider and pinned-spec
maintenance argument transfers. All hashes, enclosing context names and current
line locations are emitted by the scanner. No production transport, fence,
constructor, authority or compatibility-import behavior was changed.

`REVIEWED_REQUEST_DATA_ESCAPES` is separate from transport approval: **26
contextual records describe 28 existing candidate-only metadata escapes**.
The scanner emits these as `reviewedRequestDataEscapes`, separately from the
56 network/delegation/import/injection findings. Each record pins file, AST
node/context digest, count, producer, data shape and test references. Records
may describe only candidate transfer/return sites; they cannot accept a raw
invocation, capability export or known fetch/raw-client capability. A changed
context or added call fails. These are reviewed source contracts, not general
claims that any property named request is data.

The complete current sites are listed below. Line numbers locate the existing
source; exact contextual hashes and producer/shape/test references are in the
scanner's records and JSON output.

| Source | Lines | Producer / data use | Tests |
| --- | --- | --- | --- |
| `catalog/channel-import/import-service.js` | 20,102,125 | Import options -> canonical fingerprint and repository metadata | channel-import-service, channel-import-repository |
| `catalog/channel-import/sqlite-repository.js` | 173 | Import options -> canonical fingerprint | channel-import-repository, channel-import-service |
| `http/errors-v04.js` | 29 | Commerce client's `{method,url}` unknown-outcome detail -> HttpError | naver-client, ledger-operations |
| `http/routes-commerce.js` | 120,127,213,220,248,254 | Gateway preview or parsed detail/backup record -> idempotency/ledger; task separate | commerce-http-api, commerce-gateway, ledger-operations |
| `http/routes-drive.js` | 99,106,349,493 | Parsed Drive route/upload/permission record -> idempotency/ledger; task separate | http-drive-api, ledger-operations |
| `http/runtime.js` | 153 | Request metadata -> JSON equality against persisted request_json | ledger-operations, commerce-http-api |
| `http/server.js` | 48,55,65 | Route metadata -> idempotency/ledger; task separate | ledger-operations, commerce-http-api, http-drive-api |
| `http/server-v03.js` | 50,57,67 | Route metadata -> idempotency/ledger; task separate | ledger-operations, commerce-http-api, http-drive-api |
| `http/server-v04.js` | 53,60,70 | Route metadata -> idempotency/ledger; task separate | ledger-operations, commerce-http-api, http-drive-api |
| `http/server-v05.js` | 74 | Route metadata -> ledger; task separate | ledger-operations, commerce-http-api, http-drive-api |
| `infrastructure/ledger.js` | 113 | Request metadata -> JSON persisted through SQL placeholders | ledger-operations |
| `naver/commerce/gateway.js` | 338 | Locally constructed redacted preview record -> result.request | commerce-gateway, commerce-http-api |

Source paths in this table are relative to `src/`; test labels identify
`test/<label>.test.js`. Shared exact context/node records retain their explicit
occurrence count rather than creating a file-level exemption.

The older `searchad-write-safety.mjs` remains a **legacy narrow check** of 16
immediate write-directory JS files plus its historical required-file/evidence
checks. Its zero is not the expanded count. Neither scanner is a JavaScript
sandbox, whole-program proof against arbitrary obfuscation/reflection or third
party package behavior, nor proof of live safety or authority. Keep outbound
traps and native fence, race, approval, authorization and restart tests.

Tests mutate disposable source copies with fetch aliases and dynamic imports,
require nonzero CLI exit status, and restore the copy to a passing scan. They
also add new nested sources, change an approved file, exercise alias forms,
reject exported network aliases and test immutable registry/Reader behavior.
Additional review regressions replace the real copied fence GET/HEAD predicate
with true and move its identical invocation to an unguarded method; both must
fail scanning. A fake-transport control demonstrates the copied predicate bug's
unscoped POST effect without network/DB I/O. Callback/two-file object-export
escapes, local/unrelated fence namesakes, shadowing and reassignment negatives
have harmless callback/object and authentic constructor-alias positive controls.
The raw-request review regression also imports an exported alias in a second
module and demonstrates one fake POST before requiring scanner rejection;
its destructured equivalent, callback/container/return transfers, data mutation
and serializer-shadowing cases are covered. Plain request-data exports pass.
Metadata record mutation controls reject changed contexts and added raw calls;
forged data records cannot approve known fetch or raw invocations.
CI names both new test files explicitly, requires PostgreSQL with zero skips,
and runs the two new scripts in its static acceptance step.

Task 11 retains the pre-existing KST/PostgreSQL DATE `riskDay` portability
finding. This task does not alter time bindings, migration bytes, execution
protocols, operational gates or that acceptance obligation.
