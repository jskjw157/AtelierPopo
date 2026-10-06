# SearchAd completion planning report

Baseline `0c2b4a1fe20c243c19e2cfd8e97d500fa833061f`; design and eleven-task plan written on 2026-10-05 KST. This is an architectural review, not implementation/test/live evidence. No production code, migrations, commits, remote changes or Naver requests were made by the planning worker.

Reviewed authoritative v2.1 implementation contract, v1.1 integration design, current recovery dashboard, issue18/19/20/21/23/26 bodies and latest comments, migrations0001–0009, gateway/client, plan/approval/execution, account fence, activation mappings, bootstrap/HTTP/readiness, PG/HTTP fixtures and current CI/scanner.

## Material decisions

- Eleven increments with application/role/OpenAPI wiring owned by each subsystem task; full bootstrap+worker acceptance closes the software path.
- Append0010–0013; reuse0002 report-job/schema tables and0006 write approvals. Preserve original migration checksums.
- Canonical identity uses `haar_product_id`; after0005 the channel UUID is `channel_product_id` and the stable text key is `channel_product_key`. No duplicate Cafe24/HAAR channel.
- Report registration has a committed single-attempt local intent. A lost remote ID cannot be recovered from a convenient unique list match. Signed downloads refresh response-returned URLs in memory; no stored authtoken/URL.
- Circuit derives durable outcomes from existing attempts/intents/events and denies subsequent dispatch on projection uncertainty without rewriting the primary mutation result.
- Worker recovery delegates to existing durable service claims; lease expiry is never mutation-retry authority.
- Initial executable limitedAuto remains within current campaign budget/userLock activation mappings. Proposals for other operation families are descriptive until exact implementation/activation exists.

## Hard blockers and fail-closed semantics

| Condition | Required disposition |
| --- | --- |
| Unmanaged descendants/all external writers | No pinned API snapshot or conditional-delete/writer-exclusion contract establishes complete absence. #26 remains unresolved; no public campaign/adgroup deletion; empty scan never authorizes. |
| Live account validation/deployment | #22 is excluded. All offline fixtures remain synthetic; no live evidence/grant, gate changes, deployment or merge. |
| Report POST response loses remote job ID | GET-only diagnostic collection permitted; cannot claim ownership by type/date/time or single candidate; remain manual_review and never resend. |
| Complete report schema unavailable | Official pinned markdown has AD/AD_CONVERSION/EXPKEYWORD and extension tables; official embedded gist has Campaign/Adgroup/Keyword/Ad tables. Implement those functioning formats with revision/hash provenance. Only remaining unavailable formats are quarantined/unsupported; matching count alone is insufficient. |
| Report Cost VAT correction provenance | Resolved source: pinned `_posts/2026-02-11-notice1.md`, effective2026-03-30 by statDate, rounded long/VAT-included COST; older regenerated data unchanged. Add its URL to the correction and tests; never retroactively change preboundary basis. Bundled `/stats.salesAmt` also explicitly documents VAT-included cost. |
| Signed report-download source coverage | Official notice confirms `/report-download`, authtoken and fileVersion; this operation is absent from126 Swagger entries. Pin an official signing sample during Task3; represent separately, not as forged raw-manifest operation. |
| Missing channel settlement/cost/stock authority | Adapter capabilities are explicit. Missing components produce partial/unknown profitability and block corresponding Auto; manual estimates never become upstream actual evidence. |
| Bid/create/delete/negative-keyword/unlock auto | Current ordinary activation guard maps campaign.dailyBudget and campaign.userLock only; no blanket family promotion. Unsupported recipes remain nonexecuting proposals. |
| External exactly-once delivery | Neither account-row fence nor worker lease proves it. Guarantee local single-attempt claims; retain unknown state after ambiguous transport/storage. |

No product preference is required to begin implementation. Official-source gaps are implementation research/coverage decisions with explicit blocked outcomes; they are not permission to invent semantics. RealPG tests can be optional locally when no test DB exists, but fresh CI must use PostgreSQL16 and assert zero skipped tests. The local planning worker ran no test suite and claims no fresh pass count.

The parent controller should inspect and commit these docs before implementation, then use the planned sequential Superpowers review gates. Final reporting must distinguish completed software from blocked operational #22 and unresolved #26 rather than announcing unconditional project completion.

Controller supplied source discoveries during review: pinned official markdown is cached at `/workspace/scratch/12f4c61df5c6/searchad-official-markdown-en-US.json`; master gist metadata is cached at `/workspace/scratch/12f4c61df5c6/searchad-master-gist.json`. These are source research inputs, not live account evidence. Controller also observed local baseline453 top-level /406pass /3existing realPG-dependent failures /44missingPG skips; none establishes fresh PostgreSQL completion. Canonical baseline1059pass is separate existing CI evidence.

Final controller discovery resolved the VAT-source gap and pinned master gist revision `8f5aed7a003af91e00fc2eede43e8452fd369a33` / content SHA256 `7d94d45b4db76e2faa1a828eeb9611f7e398d9b2ba1c06af53a8d690027d818e`. Design/Task3 now mandate these concrete sources and functional minimum schemas.
