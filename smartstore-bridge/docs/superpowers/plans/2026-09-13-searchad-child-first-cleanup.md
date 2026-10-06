# Approved two-node child-first cleanup

Approved continuation of #26: delete one verified adgroup, then its verified campaign using separate server plans and existing approval tokens. Preserve existing producers, old childless-cleanup rejection, schemas, default gates and HTTP wiring.

Scope is exactly one server-created campaign and one server-created adgroup. This does not include generic graphs, keywords/ads, unmanaged remote descendants, raw IDs, automatic approval, evidence issuance or live activation.

- [x] Read remote8e274689 and canonical590 boundary; recover five producer modules by exact hash. Local export is not the full remote history.
- [x] Observe missing-implementation failure before adding source.
- [x] Add real PG + existing producers/approval + signing Gateway tests. Simulate only upstream and authority rows.
- [x] Implement internal/default-OFF service and coordinator. Parent requires child server-plan/intent/observation, consumed approval/risk and exact absence snapshot; deleted flags alone are insufficient.
- [x] Before child DELETE re-read stopped campaign and child; before parent DELETE re-read child absence and stopped campaign. Atomically claim token/risk/intent after fresh observations. Maximum one DELETE attempt per acknowledged claim; never blind-replay.
- [x] Qualify GET404 as absence, preserve uncertainty and provide GET-only recovery with mutations OFF or account suspended. Preserve target/parent identity and immutable proof.
- [x] Exercise races, altered flags/IDs/proof, foreign descendants, stale reads, capacity locks, expiry, key rotation and transaction failures. Run disposable duplicate-send control and restore exact source.
- [x] Local new PG68/0/0 and available-export regression482/0/0; distinguish missing176 remote producer cases.
- [x] Publish implementation f88fa859 by fast-forward without force or merge.
- [x] Canonical CI34747342643/job103697577990 completed SUCCESS; observed full658/0/0, new cleanup repeat68/0/0 and all final steps/teardown success.
- [ ] Publish this documentation successor and synchronize #26, Master23 and PR24. Record final writes and successor CI observation in a tracker comment after they occur. Whole #26 remains OPEN.

Local evidence: missing0/1, edge65/3 (two failures plus parent), fixed68/0. Disposable duplicate-DELETE control53/15; exact restore68/0. Interrupted repeat is not a pass. Final uploaded hold/object equality assertion source was retested68/0. No independent reviewer approval.

Next implementation unit: keyword/creative siblings and partial/duplicate/malformed batch contracts with corresponding ownership and cleanup extension. Keep unsupported graph shapes blocked. Stopped GET is not an upstream transaction; final suspend/send fencing, all-writer shared locks, remote unmanaged descendants, actual lifecycle issuer, application HTTP and independent review remain separate. No actual Naver request or production change is authorized.
