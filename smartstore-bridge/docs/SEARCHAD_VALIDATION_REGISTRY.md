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
request/send calls. Unresolved dynamic imports and exported network aliases are
rejected. Calls to approved gateway methods and actual account-fence `fetch`
delegation are not represented as raw initiation.

`REVIEWED_TRANSPORT_BOUNDARIES` in the scanner contains 36 explicit records for
38 existing AST nodes. A record pins the file, node kind, SHA256 of the exact
node text, occurrence count, rationale and test references. No record exempts a
whole file or directory, and a new call in an approved file still fails. Existing
adapter raw-client delegations are reported as `raw_client_delegation`, separate
from raw `network_initiation`; module imports are `network_import`.

Reviewed boundaries are the SearchAd client request entry; four gateway raw
client delegations; two account-fence entries; the private mutation-gateway
captured transport entry; the inventory origin/redirect wrapper; signed report
download delegation; report archive SDK import and put/get delegations; pinned
spec-maintenance download; existing Commerce/Cafe24/Drive auth and client
transport/delegations; and four inbound HTTP server imports. Exact node hashes
and current line locations are emitted by the scanner. Existing fence behavior
and compatibility import paths are unchanged.

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
CI names both new test files explicitly, requires PostgreSQL with zero skips,
and runs the two new scripts in its static acceptance step.

Task 11 retains the pre-existing KST/PostgreSQL DATE `riskDay` portability
finding. This task does not alter time bindings, migration bytes, execution
protocols, operational gates or that acceptance obligation.
