# Remote absence contract review and adversarial regression

Reviewed: 2026-09-20. Issue #26 / Draft PR #28.
Starting application SHA: `a4835764bb21590de24ad28ad2baed8ef9c4aa5d`.
Scope: review authoritative contracts and test existing negative safeguards.
This is **not** a deletion-safe proof producer, a runtime activation or completion of #26.

## New evidence that changes the investigation

### Campaign deletion is explicitly cascading

The [official NCC Swagger](https://raw.githubusercontent.com/naver/searchad-apidoc/gh-pages/assets/json/ncc-heroes-ncc.json), operation `removeUsingDELETE_5` at `/api/ncc/campaigns/{campaignId}`, explicitly describes permanent campaign deletion and deletion of all child elements when they exist. The reviewed official file listing identifies blob `d6cd7f9c0c620eacfa9ea1f22de228aa6acab7fd`.

The [official error map](https://raw.githubusercontent.com/naver/searchad-apidoc/master/NaverSA_API_Error_Code_MAP.md) also lists 3502 for groups existing in a campaign. These are not interchangeable contracts. The error entry does **not** establish an atomic, non-cascading delete-if-empty operation. For safety evaluation, assume campaign deletion can affect unknown children as the endpoint description states. Do not send DELETE as a probe.

The reviewed campaign and adgroup DELETE parameter lists contain the target path ID. They do not document an `If-Match`, expected child-set/version, or snapshot precondition. The adgroup description is only a removal operation; do not extrapolate the campaign's documented cascade rule into a verified adgroup rule. Lack of a documented precondition here is an evidence gap, not a claim about every possible future or private API.

### Master Report has a historical snapshot basis, not a deletion-time lock

In [official issue #763, collaborator naver-searchad's response of 2023-04-19](https://github.com/naver/searchad-apidoc/issues/763#issuecomment-1514210981), the report owner distinguishes snapshots from change reports. Snapshots use a reference point near the request, and the GET response supplies that reference point. Changes, including deletions, are covered over a reported interval. Reusing an older download URL still returns the older report. This historical explanation is more informative than inferring consistency from BUILT alone.

The [currently reviewed Master Report schema](https://raw.githubusercontent.com/naver/searchad-apidoc/gh-pages/assets/json/master-report.json) describes `fromTime`, `updateTime` and BUILT status. Neither that schema nor the cited reply supplies a shared version across all required report entity types, a fence against later writers, or a conditional parent DELETE consuming the report version.

**Refined conclusion:** a historical snapshot source exists. A report's historical reference time must not be represented as an atomic guarantee at mutation time. No report job was created, no report was downloaded from an advertising account, and no historical report was promoted to lifecycle or cleanup authority.

### Domain coverage must be justified separately

The same NCC schema includes owner-bound ad extensions and adgroup restricted-keyword operations, outside the three implemented inventory relations. Before claiming the *whole affected domain* is empty, establish which associated entities parent deletion affects and whether the evidence covers them. This review neither expands the supported recipe nor declares the existing three lists exhaustive.

## Regression added in this continuation

`test/postgres-searchad-remote-absence-boundary.integration.test.js` uses real migrations, `DescendantInventoryService.scan()`, PostgreSQL observation persistence and the existing `hasUnprovenInventory()` consumer. Only stored fixture identity/graph and external state/response scheduling are synthetic. No positive proof issuer or destructive adapter is constructed.

Five independent cases cover:

1. Campaign-to-adgroup: a child appears after an empty response was captured.
2. Adgroup-to-keyword: the same timing gap for a keyword.
3. Adgroup-to-creative: the same gap for the non-paginated response.
4. Two empty scans and equal ID hashes still do not exclude a writer after the second response.
5. A synthetic ordered cursor backend inserts a row behind the cursor; traversal reaches an empty page but has not observed that row. Its explicit test ranks are not a claim about Naver's real ID ordering.

Each case verifies a new, single, non-authorizing audit event; unchanged local lifecycle data **and PostgreSQL row versions**; `completeAbsence:false`; `snapshotConsistency:unproven`; no local mapping; and a parent/subtree veto evaluated using **only that case's new event**. Earlier fixture events cannot mask a missing veto. The existing producer/approval/cleanup integration suite separately checks enforcement before planning and execution; these new tests do not pretend to be a live end-to-end deletion test.

`scripts/verify-searchad-absence-boundary.mjs` runs the scenarios, temporarily disables the real veto export in its disposable CI checkout, requires all five cases to fail on the specific veto assertion, restores the exact original source, and reruns the scenarios. It verifies a clean source diff afterward. This is regression sensitivity checking, not a claim of new production RED/GREEN functionality. Full regression runs after restoration. Counts are recorded in the PR/issue only after completed Actions logs are inspected.

## Decision and remaining blockers

Preserve every current operational/default-OFF boundary. Do not add a trust-empty flag, a locally fabricated complete-absence certificate, or a conditional parameter unsupported by the reviewed API. The existing unsampled internal cleanup paths are unchanged; the absence of an inventory event is not remote absence and those paths are not approved for operational exposure.

A deletion-safe solution still needs an authoritative consistency arrangement that spans the affected domain and observation-to-mutation interval. This may require a supported upstream conditional operation or enforceable isolation covering **all** writers, including the advertising UI and other integrations. A local database lock, immutable local event, repeated snapshot, parent pause flag or local digest cannot by itself supply that remote guarantee.

### Upstream clarification draft — NOT sent

- 캠페인 DELETE 문서의 하위요소 동시 삭제와 오류 코드 3502는 각각 어떤 조건에서 적용됩니까? 원자적인 '하위요소가 없을 때만 삭제' 호출을 지원합니까?
- 광고그룹 DELETE가 영향을 주는 키워드·소재·확장소재·제외키워드 및 기타 연결 객체의 범위를 확인해 주십시오.
- 부모 삭제에 사용할 수 있는 공식 version/ETag/If-Match 또는 snapshot 조건이 있습니까? 그 조건이 자식의 생성·이동·수정도 포함합니까?
- Campaign/Adgroup/Keyword/Ad 등 Master Report들을 같은 일관된 기준 시점에 묶는 계약이나 식별자가 있습니까? 기준 시점과 반영 지연은 어떻게 확인합니까?
- 조회 이후 삭제까지 UI·다른 API 사용자까지 포함해 변경을 차단할 수 있는 공식 수단이 있습니까?

Do not post this draft publicly or change advertising-account access without separate authorization. Keep #26 OPEN and PR #28 Draft/unmerged. The independent, already-listed expired-unused-plan retirement/replanning item remains pending; do not invent its implementation or mark downstream lifecycle activation complete.
