# #26-B2b first slice: read-only reconciliation

Base: 9ce414244ec1d978372e04d961ea4b8082ce6b73. Branch codex/searchad-original-recovery-20260912, Draft PR24, issue26 remains OPEN. No main, merge, deployment, production migration, gate change or Naver request.

## Source recheck and correction to previous B2a notes

Direct fetch at historical1051fa1 and current9ce4142 returns the SAME repository blob b63fd592d186ea56297fc2f60dac13e92e97203b. The earlier report's supposed original a17e6b51... and adapted-repository claim are incorrect. The actual 16 storage scenarios cover upgrade, explicit Customer filters, pure validator applied to stored parents, uniqueness, reconnect, immutable events and risk accounting. They do NOT establish composite Customer/run/parent enforcement in the raw repository, dispatch or cleanup claims, dry-run-only risk release, generic event redaction or child-first remote deletion. The prior332/0/0 count is a real result but these broader descriptions must be corrected in the dashboard and issue/PR.

Historical hierarchy-canary-service.js blob2029ed05c5330102e01a3477119d82496d901698 has independent token/risk/dispatch commits, ownership checked after delete, and reconcile omits delete_pending and does not settle delete_unknown. Do not import it wholesale.

## Bounded implementation

1. Add explicit failing service contracts before production code. Keep all old assertions and workflow checks; permit only the exact two new test paths for RED.
2. Add a separate HierarchyReconcileService and PostgreSQL reconciliation repository. Leave old storage, async writer, activation and migrations byte-identical.
3. Only authenticated Admin + explicit Customer/run/object IDs. Never accept caller remote ID, URL, evidence or token. Validate stored operation and full ancestor/ownership bindings before a pinned GET.
4. Treat only SearchAdError with matching upstream404 as absence. Null/empty/partial or inconsistent success responses are not deletion evidence. Require exact ID/Customer/parent/type on present responses. Recheck spec/credential/upstream context before and after GET.
5. Include delete_pending/delete_unknown. Do not replay create/delete, search by name, fabricate ownership, promote a create from GET alone, release consumed risk or mark Canary passed.
6. Capture a consistent PG snapshot; release transaction before GET. On settlement lock and compare DB row versions and graph membership. Atomically update local object/ownership/run plus an allowlisted audit observation, reject stale snapshots and live-child parent settlement, and roll back on audit failure. This is observation settlement, NOT approval+dispatch atomicity.
7. Use real PostgreSQL with per-child UUID schemas, two connections and simulated read adapter responses. Prove reconnect, race, rollback, malformed response, missing ID and no mutation path. Full application/Gateway/live-evidence validation remains separate.
8. Run fresh full/required/repeated PG and syntax/provenance checks. Record exact SHA/CI/boundaries and correct all current tracker descriptions.

Local environment is an isolated partial source mirror with hash-checked dependencies; it is not a full clone and has no PostgreSQL. Local service RED was11 failed missing-module assertions,0pass,0skip. GitHub CI is the full repository and real PostgreSQL verification environment.

Remaining B2b: create/child progression, per-mutation authoritative stopped campaign checks, strict batch response binding and child-first actual remote cleanup. C/D/E token+risk+dispatch atomicity, exact lifecycle activation and application/role HTTP integration are still required. Do not close#26 on this read-only slice.
