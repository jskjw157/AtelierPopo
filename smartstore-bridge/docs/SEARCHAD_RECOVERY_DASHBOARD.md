# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-13

**캠페인 한 건의 서버 계획 → 기존 승인 → 원자적 전송 준비 → 서명 POST 한 번 → 반환 ID/소유권 저장 → GET 검증을 내부 경로에 연결했다. 다음은 B2b의 승인된 cleanup과 child/batch 확장이다. 전체 #26은 OPEN, PR24는 Draft다.**

실제 PostgreSQL·승인·기존 coordinator·서명 Gateway를 사용했고, 네이버 응답과 권한 증거는 테스트 fixture다. 새 서비스는 기본 OFF이며 application HTTP/bootstrap에 연결하지 않았다. 실계정 활성화나 전체 계층 완료를 뜻하지 않는다.

| 기준 | 값 |
| --- | --- |
| Repo / app | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Branch | `codex/searchad-original-recovery-20260912` |
| Protected PR base | `0adbd11359440efe43fd07c279bd01a4d8914568` |
| 검증 코드·테스트·CI | `649dafcb622799ed88acb257b6a08fe55d965403` |
| Canonical CI | **[34723583543](https://github.com/jskjw157/AtelierPopo/actions/runs/34723583543), job103633700622, completed/success; complete job log and final step conclusions checked** |
| 전체 / 필수 PG / 새 반복 PG | **462/0/0 · 172/0/0 · 48/0/0** |
| Migration | 0009, 기존 schema 변경 없음; 테스트 DB에만 적용 |

[Master#23](https://github.com/jskjw157/AtelierPopo/issues/23) · [현재#26](https://github.com/jskjw157/AtelierPopo/issues/26) · [Draft PR24](https://github.com/jskjw157/AtelierPopo/pull/24) · [현재 검증/해시/제약](SEARCHAD_0009_CAMPAIGN_CREATE_VERIFICATION.md) · [이번 계획](superpowers/plans/2026-09-13-searchad-campaign-create-handoff.md)

이 문서는 Markdown 작업판이다. GitHub Projects 보드 갱신을 주장하지 않는다. 문서 전용 후속 SHA와 CI는 #26/PR24에 별도 기록한다.

## 순차 작업판

| 단계 | 상태 |
| --- | --- |
|0007 Canary/Gateway/역할 HTTP|VERIFIED, 미병합·미배포|
|#25 /0008 activation·기존 async·실제 PG/HTTP·readiness/close|COMPLETED, 회귀 보존|
|#26-A/B1 목록·순수 계층 descriptor|INVENTORIED / VERIFIED|
|#26-B2a schema/repository/risk|VERIFIED, 정정된 storage-only 범위|
|B2b 읽기 전용 재조회·로컬 관찰 확정|VERIFIED, 기존 코드 보존|
|B2b/C/D 캠페인 LOCAL token+risk+intent|VERIFIED 기존 ecb817f를 재사용|
|**캠페인 서버 계획·단일 전송·반환 ID/소유권·GET 검증**|**VERIFIED bounded internal path, 649dafc**|
|**승인된 cleanup·child/batch progression·상위 중지·child-first 삭제**|**NEXT — PENDING**|
|C/D 일반 lifecycle scope/원자성·기존 실행기/0007 start 채택|PARTIAL, 전체 미완료|
|E 실제 lifecycle app/역할 HTTP/whole-app restart|PENDING|
|F 전체0009 acceptance/종료|PENDING|
|#18 reporting/Circuit/automation|PENDING|
|#19 worker/scheduler/registry,0019 기능 수준|PENDING|
|#20 profitability/recommendation/limited Auto|PENDING|
|#21 최종 suspend-to-send 경계·운영 준비·독립 리뷰|PENDING|
|#22 배포/실계정 검증/활성화|NOT STARTED, 별도 승인|

## 이번 변경과 검증

기존 원격에는 ecb817f의 LOCAL 캠페인 dispatch transaction과414개 검사까지 있었고 이를 중복 구현하지 않았다. 이번에는 서비스/결과 저장소2개와 PG 테스트1개·계획1개를 추가했다. CI는 이전 모든 줄·단계·pin을 유지하면서37줄만 추가했다. 이전 production source/test/schema/dependency/default gate 변경0이며 임시 resume-source export 파일은 제거했다.

계획은 서버가 생성하고 기존 승인 서비스가 token을 발급한다. 새 실행 경로는 기존 approval+risk+intent transaction을 호출한 뒤, 별도 handoff에서 현재 계정·권한·승인·risk 날짜/소비시각을 재확인한다. COMMIT 확인이 불명확하면 전송하지 않는다. 정상 응답 ID와 소유권 보류 기록을 함께 저장한 뒤 GET하며, 정확한 GET만 owned/applied로 진행한다. run은 cleanup_pending이지 passed가 아니다.

47개 child+parent=48개 새 검사는 실제 PG와 서명 계층을 조합한다. 동시/반복 실행, 생성·조회 오류, 잘못된 ID/계정/중지 상태, 세 저장 지점 rollback, 키 교체·gate OFF·만료·COMMIT 응답 손실과 생성 후 소유권 변경 등을 확인한다. 저장 ID는 이제 모의 POST 응답에서 유래하지만 실계정 생성 증거는 아니다. DB 재접속은 앱 재부팅이 아니다.

실패 우선 관측: missing-module0/1/0, risk 날짜 재결합42/2/0(부모 실패 포함). 날짜/시각 결합을 수정했다. 생성 POST를 두 번 보내는 비교 코드는29/19/0으로 실패했고 원본 복원 후48/0/0과 전체462/0/0을 확인했다. 비교 코드는 게시하지 않았으며 모든 행동의 개별 RED를 주장하지 않는다.

| Canonical code CI check | Pass / fail / skip |
| --- | --- |
| Canary/Gateway/role HTTP |51 /0 /0|
| Activation core |30 /0 /0|
| Hierarchy recipes + read-only unit |29 /0 /0|
| Existing write / HTTP-readiness |49 /0 /0 ·14 /0 /0|
| **Required PostgreSQL** |**172 /0 /0**|
| Existing Canary/activation/application PG repeat |31 /0 /0|
| Storage/risk repeat |21 /0 /0|
| Read-only unit+PG / signed Gateway PG |25 /0 /0 ·16 /0 /0|
| Existing atomic campaign dispatch PG repeat |41 /0 /0|
| **New campaign creation PG repeat** |**48 /0 /0**|
| **Full regression** |**462 /0 /0**|

All configured code-CI steps and prior/new source pins and protected diffs passed. Both final migration reruns reported `currentVersion:0009, applied:[]`. Bundled Commerce coverage116; SearchAd126 unique/117 allowlisted with no internal/deprecated runtime leaks. The bridge production dependency audit reported0 vulnerabilities. These are recorded tool results, not live-account capability or whole-system security approval.

414+48=462. 집중·반복 검사 수는 전체와 중복되며 완료율로 환산하지 않는다. 기존 write scanner16sources는 이 lifecycle 전체 보안 검사나 독립 리뷰가 아니다. 번들 API coverage는 live 검증이 아니며 bridge production audit는 root audit와 다르다. SQLite/Actions Node 경고는 남는다.

## 핵심 한계 / 다음 구현

현재 보장은 durable claim 뒤 한 번의 내부 전송 시도이며 외부 exactly-once나 반드시 한 번 전달됨을 뜻하지 않는다. 전송 전 차단/프로세스 중단/COMMIT 응답 손실로 실제 전송0회여도 risk가 소비된 미확정 기록은 그대로 남을 수 있다. 생성 응답 저장 중 DB가 실패하면 ID가 남지 않을 수도 있으며 재전송이나 이름 추정으로 복구하지 않는다.

**최종 handoff COMMIT 직후 발생한 계정 suspend와 network send 사이의 원자적 차단은 미완료(#21)다.** 키/gate 재검사를 이 문제의 해결로 확대하지 않는다. 기존 모든 raw writer/기존 executor가 같은 잠금 규칙을 채택했다는 보장도 없다.

다음 B2b는 승인된 campaign cleanup, campaign→adgroup와 그 아래 keyword/creative 각각의 생성, 매 관련 mutation 전 authoritative stopped ancestor, partial/duplicate batch와 child-first cleanup이다. 현재 서비스는 children이 있는 graph를 거부하는 캠페인 전용 경로다. live route 전 cleanup 안전성과 실제 생성 lifecycle evidence 발급 경로가 필요하다. C/D 일반화와 E/F는 계속 미완료다. 내부 risk는 UTC 용량 단위이며 광고비 원화나 한국 일예산이 아니다.

## 이전 B2a 보고 정정 — 계속 적용

raw 복합 Customer/run/parent 강제, run+risk 원자결합, dispatch/cleanup 단일승자 claim, dry-run-only release, 범용 event redaction, child-first cleanup을 B2a 완료로 설명했던 내용은 철회됐다. 실제 B2a는 명시적 Customer 필터, 저장된 부모에 대한 별도 validator, 고유성·재접속·immutable event·risk 회계까지만 증명했다. 원본과 현재 raw repository는 동일 b63fd592d186ea56297fc2f60dac13e92e97203b이고 수정복구본이라는 예전 설명은 잘못이었다. 저장소 child마다 독립 UUID schema를 사용한다.

[정정된 B2a 기록](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md)은 그대로 유효하다. **이번 별도 캠페인 transaction을 과거 B2a나 기존 전체 실행기 보장으로 소급하지 않는다.**

## 고정 이력과 운영 경계

[캠페인 LOCAL 준비/414](https://github.com/jskjw157/AtelierPopo/blob/a1dfe180a08d812f850e33e6146e4adbfe886093/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [재조회/373 및 B2a 정정](https://github.com/jskjw157/AtelierPopo/blob/c0668561e7306cfa802d3ab9eb960ee3531b8548/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [B1/311](https://github.com/jskjw157/AtelierPopo/blob/035098228dbabdd48669f42f36c054cc38fc68af/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [0008/293](https://github.com/jskjw157/AtelierPopo/blob/5a5ae1c713bfc8343be774635a8d63532030db55/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md)와 closed#25에 이전 근거가 있다. 과거#17 closed/local-only 기록은 현재 완료가 아니다.

공개 readiness는 초기화 상태이지 계정별 실행 허가/live probe가 아니다. **실제 Naver 요청·광고 변경·운영 gate·운영 migration·Hostinger 배포·main 변경·병합은 하지 않았다.**
