# #26-B2 storage-first recovery

Base: 035098228dbabdd48669f42f36c054cc38fc68af on codex/searchad-original-recovery-20260912, Draft PR24. Historical source: 1051fa1a64ab78b5f6b3adf5cb794a342ade39ae. No main change, merge, deployment, live request or production migration.

## Reviewed source and decision

Read the complete historical migration0009, lifecycle repository, risk service and hierarchy-canary-service (799 lines). Their dispatcher uses the internal remote adapter, lifecycle activation guard and an injected approval claim interface. The orchestration is NOT safe to import as a ready execution path:

1. approval.claim, risk.consume, object dispatch state and dispatch event are independent commits; their joint atomicity is absent.
2. returned-ID object updates and ownership inserts are independent; cleanup checks an ownership record only after sending the delete, not before.
3. reconcile excludes delete_pending; a verification GET failure after a delete can leave this state stranded. Reconcile reports presence/absence but does not settle delete_unknown.
4. start checks one unresolved run but child and cleanup operations have no per-run dispatch serialization. API/plan/scope binding must be revalidated using the current async implementation, not a claim-only fixture.
5. the internal raw repository/schema do not enforce all Customer/run/parent/ownership composite relations; optional unscoped internal methods are not HTTP authorization. Incoming IDs and remote batch response shapes require service validation.

Therefore split B2: **B2a internal PostgreSQL storage and risk accounting** in this increment; **B2b corrected orchestration/authoritative-parent/returned-ID response validation/child-first cleanup** remains pending. C/D/E approval+dispatch atomicity and application/role HTTP remain pending. Do not label B2 or issue26 complete on storage-only GREEN.

## Failure-first execution

- Add an isolated PostgreSQL test with an explicit missing-schema assertion before dynamic module imports; observe RED, not an import crash or silent skip.
- Restore exact historical blobs: schema ec8f25be8654febf25e5d30b5f9bb4ee45858ac7; repository b63fd592d186ea56297fc2f60dac13e92e97203b; risk service 75f375f59752674ffd28f11c39582c3a73d73e98; risk unit tests 75673597c6801fdfb33ea2c6de09330516144702.
- Keep these sources disconnected from the application and generic/Canary mutation routes.
- Actual PostgreSQL tests use fresh UUID schemas, real pools and reconnection, existing migrator and real services. Synthetic IDs/evidence are storage fixtures, never live evidence. No HTTP request is needed.
- Cover populated0008 ->0009 -> repeat, prior checksums/default-empty lifecycle scopes and immutable evidence/grants/events; unresolved-run uniqueness, explicitly scoped queries/patches, ownership uniqueness, stored unknown states and parent-child queries after reconnect.
- Cover duplicate intent and shared per-Customer risk capacity through independent pools, reserve/consume/release races, rollback on SQL constraint failure, no consumed-risk recycling and UTC rollover. This is risk-accounting atomicity, NOT approval+dispatch atomicity.
- Preserve migrations0001-0008 and all existing production code. Only exact head-version assertions in the two old full-migration PG tests may advance0008->0009; prove by reverse replacement/hash, not by disabling assertions. Keep the explicit0008-only upgrade test.
- Preserve every existing CI step and hash pin. Add only narrow source/test/migration exceptions and exact new pins. Run required PG, repeated storage tests and the complete suite; inspect actual logs.
- Record exact code SHA, CI/job/results and source/fixture boundaries; synchronize dashboard/Master26/PR24. Keep26 OPEN and24 Draft.
