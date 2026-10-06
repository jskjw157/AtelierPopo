# SearchAd remote absence: evidence decision and inventory veto

Reviewed: 2026-09-19. Scope: Issue #26 / Draft PR #28.
Baseline: `9e115f256717d3f890d28eedada00af84da60061`.
This document does not authorize deployment, live calls, gate changes, or parent deletion.

## Correction to the previous checkpoint

The baseline inventory service and repository correctly append read-only observations without creating cleanup authority. That alone did **not** ensure that an existing `cleanup_pending` parent-cleanup path checked those observations. Both the child-first repository and the childless-campaign repository ignored them during planning/execution.

The new real-PostgreSQL regression composes the existing campaign/adgroup/keyword producers, existing approval service, inventory persistence and both cleanup services. Only upstream responses and active-authority fixtures are synthetic. After isolating each producer graph in its own schema (without weakening the one-unresolved-run-per-Customer constraint), run `35435217893` / job `105876613200` reproduced nine missing-rejection failures. The existing preflight-drift and cross-Customer isolation cases already passed. Earlier run `35434956283` mixed one genuine missing rejection with fixture-isolation failures and is not evidence for all cases.

The fix adds a **negative, subtree-scoped veto** in the two existing planning/approval gates. `descendant_inventory` and legacy `partial_keyword_inventory` observations attached to the target parent or any of its local descendants block a new parent plan and an already-approved parent execution. Run-level observations with no object ID are also vetoes. No observation status or `completeAbsence`/`cleanupAuthority` payload flag can override this. Deleted local descendants are still included.

This veto does not apply to known keyword/creative leaf cleanup. Existing graph validation, returned-ID provenance, independent approval, token/risk claim, DELETE-at-most-once and GET-only reconciliation remain separate requirements. The new check is not inserted into the graph loader or observation-settlement path.

**Important remaining boundary:** a legacy internal path with no inventory event is unchanged. Absence of an observation is NOT proof that there are no external children. Those paths remain internal/default-OFF; this fix does not make unsampled graphs safe for operational exposure. A post-claim change is also not covered by an upstream atomic transaction merely because local preflight detected no drift.

## What the reviewed official sources establish

1. [Official 2016-06-29 pagination release note](https://naver.github.io/searchad-apidoc/release/2016/06/29/release-note/): campaign, adgroup and keyword lists accept cursor parameters. NEXT is the default; NEXT and PREVIOUS exclude `baseSearchId`.
2. The checked-in `specs/naver-searchad/current.json` at the baseline describes keyword-by-adgroup and adgroup-by-campaign queries as partial lists with `recordSize` between 1 and 1000. The ad-by-adgroup operation has a different, non-paginated parameter shape. These are pinned application inputs, not a claim that all future upstream schemas are identical.
3. [Official error-code map](https://raw.githubusercontent.com/naver/searchad-apidoc/master/NaverSA_API_Error_Code_MAP.md): code 3502 denotes adgroups existing inside a campaign; 3503 denotes campaign deletion failure. The map also distinguishes missing-resource and permission errors.

These sources establish cursor behavior and named error conditions. They do not, in the material reviewed here, establish a transactionally consistent, complete account/parent snapshot across pages or a universal non-cascading atomic conditional-delete contract for all three parent-child relations. No broader claim that such a guarantee can never be obtained is made.

Do not use DELETE as a probe to discover whether children exist. An error-map entry alone is not authorization to risk an external destructive call.

## Engineering decision: three distinct claims

- **Presence observed:** a qualified list response contains scoped child IDs. It can veto cleanup, but cannot assign unknown local ownership.
- **Enumeration terminated:** a cursor traversal reached its documented end condition with no malformed/cross-scope response, duplicate/cycle, missing page, timeout or exceeded bound. This would be more informative than one page, but is not automatically a coherent snapshot or absence at dispatch time.
- **Deletion-safe absence:** a server-issued, immutable proof also covers the complete relevant descendant domain, current authenticated Customer/spec/credential/parent identity, a justified completeness/consistency contract, expiry and changes between observation and mutation. Independent destructive approval is still mandatory.

Repeated empty pages, matching names, a 1000-row ceiling, all known local children being deleted, a raw `completeAbsence:true`, or successful synthetic CI do not bridge these claims.

## Remaining proof work / exit criteria

Before operational parent deletion can be enabled, establish and test an evidence source whose completeness and consistency are supported by an authoritative upstream contract. Bind it to exact scope, schema identity, generation/observation times, content digest and covered entity types. An upstream snapshot/version/conditional operation, or an enforceable isolation arrangement covering **all** writers, must address the observation-to-delete race. A local repository lock does not control changes from the advertising UI or other integrations.

Then implement the verified evidence producer and consumer with expiry, drift, malformed/partial-page, interruption and replay tests. Do not introduce a configurable “trust empty list” flag or fabricated evidence issuer. Until those criteria are met, the current inventory output stays `empty_unproven` / `completeAbsence=false` and is not consumed as positive cleanup authority.

## Verification ledger

The negative-veto unit test has a local missing-module RED and subsequent five-case GREEN. The integration regression has eleven nested cases: nine new veto expectations plus two preservation checks. Remote full-suite status and final verified SHA must be recorded from completed Actions logs in PR #28 and Issue #26; this document does not predeclare its own successor CI successful. Full #26 acceptance, independent review, production activation and full remote-absence proof remain open.
