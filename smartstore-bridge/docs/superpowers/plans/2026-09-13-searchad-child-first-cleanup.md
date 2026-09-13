# Approved two-node child-first cleanup

Approved continuation of issue #26: delete one verified adgroup, then its verified campaign, using separate server plans and existing approval tokens. Preserve all existing producers, the old childless cleanup guard, schemas, default gates and HTTP wiring.

Scope is exactly one server-created campaign and one server-created adgroup. No generic graph, keywords/ads, raw IDs, unmanaged remote descendants, automatic approval, evidence issuance, or live activation is claimed.

- [x] Read current remote checkpoint 8e274689 and prior 590-test boundary. Recover five producer modules with exact Git hashes; local snapshot is an exported subset, not the full remote history.
- [x] Observe a missing-implementation failing test before adding source.
- [x] Add real PG + current producers + existing approval + signed Gateway tests. Simulate only upstream responses and authority rows.
- [x] Implement an internal default-OFF cleanup service and PG coordinator. Reject parent planning until child deletion has a matching server plan, immutable intent/observation, consumed approval/risk and exact absence snapshot. Never trust deleted flags alone.
- [x] Re-read the stopped campaign and selected child before child DELETE; before parent DELETE re-read child absence and stopped campaign. Claim token, risk and intent atomically only after strict fresh observations. One DELETE attempt per acknowledged claim; no replay on errors.
- [x] Verify saved ID through GET404; preserve unresolved outcomes. Add GET-only recovery when mutation is disabled or account suspended. Preserve all target/parent IDs and immutable proofs.
- [x] Exercise duplicate/racing calls, fake deletion flags, foreign links, injected IDs, stale observations, capacity locks, approval/evidence expiry, credential rotation and transaction failures. Run a disposable duplicate-send negative control and restore exact source.
- [x] Run the new local PostgreSQL suite: 68/0/0. Run the available exported regression: 482/0/0 (not the complete remote suite).
- [ ] Run canonical GitHub CI including every existing suite. Record actual results; do not infer success from expected totals.
- [ ] Commit without force or merge and synchronize issue26, Master23, PR24 and the dashboard. Full #26 stays OPEN.

Remaining boundaries: stopped GET is not an upstream transaction; post-claim suspension/send fencing, all-writer shared locks, remote unmanaged descendants, full lifecycle evidence issuer, HTTP/bootstrap and independent review remain separate. A counted local attempt is not external exactly-once delivery. No actual Naver request or production change is authorized.

Observed local RED: missing implementation 0/1/0. Edge regressions 65/3/0 exposed stale final observations and disabled-read-gate audit mutation; both fixed, followed by 68/0/0. Disposable duplicate-DELETE control 53/15/0, then exact restoration and 68/0/0. An interrupted repeat is not a pass. Upload consistency adds an explicit redundant hold/object equality check and the resulting exact blob is retested 68/0/0. No independent reviewer approval was obtained.
