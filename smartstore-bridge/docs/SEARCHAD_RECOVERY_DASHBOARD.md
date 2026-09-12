# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**다음은 서버 소유 캠페인 계획 생성기와 단일 전송 연결이다. 캠페인 한 건의 승인 토큰·내부 리스크·전송 예정 기록을 묶는 LOCAL 트랜잭션은 구현·검증했다. 실제 생성/삭제 전송부 또는 B2b·C/D 전체 완료는 아니다. #26 OPEN / PR24 Draft다.**

기존 읽기 전용 재조회와 새 `PostgresCampaignDispatchRepository`를 중복 구현하지 않는다. 기존 실행기는 새 coordinator를 아직 호출하지 않는다. 테스트 DB head0009는 운영 배포/활성화가 아니다.

| 기준 | 값 |
| --- | --- |
| Repository / app |`jskjw157/AtelierPopo` / `smartstore-bridge`|
| Branch |`codex/searchad-original-recovery-20260912`|
| Protected PR base |`codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568`|
| **검증 코드/테스트/CI SHA** |**`ecb817f6037253d909f8731de2c27792bcb0df25`**|
| **완료 코드 CI** |**[34680617480](https://github.com/jskjw157/AtelierPopo/actions/runs/34680617480), job103518472081, completed/success; 전체 로그·최종 단계 확인**|
| **전체 / 필수 PG / 새 반복 PG** |**414/0/0 ·124/0/0 ·41/0/0**|
| DB migration |0009, 신규/수정 migration 없음; 최종 재실행 두 번 applied:[]|
| 다음 연결 |서버 소유 계획 → 단일 전송 handoff → 응답 ID/소유권 원자적 저장|

[Master#23](https://github.com/jskjw157/AtelierPopo/issues/23) · [현재#26](https://github.com/jskjw157/AtelierPopo/issues/26) · [Draft PR#24](https://github.com/jskjw157/AtelierPopo/pull/24) · [이번 검증/해시/경계](SEARCHAD_0009_CAMPAIGN_DISPATCH_VERIFICATION.md) · [캠페인 transaction 계획](superpowers/plans/2026-09-12-searchad-campaign-dispatch.md)

후속 문서 전용 SHA와 CI는 issue26/PR24에 코드 검증과 별도로 기록한다. 이 파일은 Markdown 대시보드이며 GitHub Projects 보드 갱신을 주장하지 않는다.

## 순차 작업판

| 단계 | 상태 |
| --- | --- |
|0007 Canary/Gateway/역할 HTTP|VERIFIED, 미병합·미배포|
|#25 /0008 activation/current async/실제 PG+HTTP/readiness/close|COMPLETED, 회귀 보존|
|#26-A /B1 원본 목록·순수 계층 descriptor|INVENTORIED / VERIFIED|
|#26-B2a 원본 schema/repository/risk 저장|VERIFIED, 아래 정정된 storage-only 범위|
|#26-B2b 읽기 전용 재조회·서명 Gateway/PG|VERIFIED bounded slice, 기존 코드 보존|
|**#26-B2b/C/D 캠페인 한 건 LOCAL dispatch transaction**|**VERIFIED — ecb817f, 실제 전송 없음**|
|서버 소유 계획 생성·단일 전송·returned-ID/ownership 저장|**NEXT — PENDING**|
|B2b child/batch progression·상위 중지 검증·child-first cleanup|PENDING|
|C/D 전체 lifecycle scope/ownership/원자성 및 기존 실행기·0007 start 채택|PARTIAL; 일반화/실제 경로 연결 미완료|
|E 실제 lifecycle application/역할 HTTP/whole-app restart|PENDING|
|F 전체0009 acceptance/종료|PENDING; 부분 체크포인트를 F로 계산하지 않음|
|#18 reporting/Circuit/automation|PENDING|
|#19 durable worker/scheduler/registry,0019 기능 수준|PENDING|
|#20 profitability/recommendation/limited Auto|PENDING|
|#21 운영 준비/동시 suspend/독립 리뷰|PENDING|
|#22 배포/실계정 Capability·Canary·scoped activation|NOT STARTED, 별도 승인|

## 이번 구현이 실제 보장하는 것

하나의 PostgreSQL 연결/트랜잭션에서 기존 승인 토큰 소비, 내부 리스크 소비, object dispatching, plan/run unknown_outcome, write attempt와 immutable hierarchy dispatch intent를 함께 저장한다. 중간 실패는 모두 rollback하며, COMMIT 응답이 끊기면 성공 receipt를 반환하지 않고 연결을 폐기한다. 동일 계획을 두 연결에서 청구하면 하나만 commit한다. 기존 reserved/consumed risk와 경쟁해도 같은 일자 내부 한도를 초과하지 않는다.

입력은 로컬 Customer/run/object/plan ID와 token뿐이며 authenticated Admin/Customer를 요구한다. 서버 recipe로 재구성한 stopped WEB_SITE payload와 승인 계획이 정확히 같아야 한다. 현재 pinned registry의 public tier-B create operation, active evidence와 grant의 Customer/spec/credential/upstream/operation/create lifecycle/field scope와 유효기간을 검증한다. 생성 scope는 campaign.campaignTp/name/userLock/dailyBudget이다. 기존 update-only 권한을 승격하지 않는다. 실제 row-lock 대기 후 만료와 UTC 날짜를 재확인한다.

**성공은 dispatchCommitted:true, remoteDispatched:false다.** production planner/executor/HTTP/bootstrap은 아직 연결하지 않았고, 실제 네이버 create/delete 또는 외부 exactly-once를 보장하지 않는다. 새 test는 per-child UUID schema, 실제 approval/risk repository 및 합성 evidence/grant/plan을 사용한다. 실제0007 start가 아니라 risk service fixture가 한도 경쟁에 참여한다. DB 재접속은 whole-app restart가 아니다. 생성 scope를 발급하는 실제 evidence 경로도 남아 있다.

## 검사와 보존

로컬 baseline373/0/0 후 missing-coordinator RED0/1/0을 관측하고 구현했다. 연결 실패 오류 처리도 실패를 먼저 관측했다. 토큰만 먼저 COMMIT하도록 일부러 바꾼 로컬 비교 코드에서는 네 개 rollback 검사가 모두 실패했다(전체33pass/8fail, parent 포함). 정확한 원본을 복원한 뒤 최종 GREEN을 확인했고 비교 코드는 게시하지 않았다. 모든40개 행동의 개별 RED를 주장하지 않는다.

로컬 및 GitHub 전체414/0/0, 필수PG124/0/0, 새 campaign PG41/0/0. 기존 Canary51, activation30, hierarchy29, write49, HTTP14, priorPG31, storage/risk21, read-only25, signedGatewayPG16도 모두 fail0/skip0. **373+41=414이며 집중·반복은 중복되므로 합산하거나 완료율로 환산하지 않는다.**

기존 source/test/migration/package는 보존하고 coordinator와 test만 추가했다. CI의 기존 단계·pin·보호 diff를 유지하면서 정확한 새 파일만 예외로 추가하고 더 엄격한 baseline 보호와 반복 PG를 추가했다. 이번 임시 workspace-export workflow는 제거했다. 이전 diagnostic/bootstrap 정리는 별도 남는다. 기존 write scanner16sources와 bridge dependency audit0은 전체 보안/독립 리뷰가 아니다. 번들 Commerce116/SearchAd126unique117allowlisted는 live 검증이 아니다. SQLite/Actions Node 경고는 유지된다.

## 이전 B2a 보고 정정 — 계속 적용

raw 복합 Customer/run/parent 강제, run+risk 원자결합, dispatch/cleanup 단일승자 claim, dry-run-only release, 범용 event redaction, child-first cleanup을 B2a 완료로 설명했던 내용은 철회됐다. 실제 B2a는 명시적 Customer 필터, 저장된 부모에 대한 별도 validator, 고유성·재접속·immutable event·risk 회계까지만 증명했다. 원본과 현재 raw repository는 동일 b63fd592d186ea56297fc2f60dac13e92e97203b이고 수정복구본이라는 예전 설명은 잘못이었다. 저장소 child마다 독립 UUID schema를 사용한다.

[정정된 B2a 기록](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md)은 그대로 유효하다. **이번 별도 캠페인 transaction을 과거 B2a나 기존 전체 실행기 보장으로 소급하지 않는다.**

## 다음 작업의 안전 경계

서버 소유 campaign 계획 생산과 승인된 한 번의 전송 handoff, create 응답의 정확한 ID/Customer/type/stopped 검사, object/ownership 원자 저장과 read-only unknown recovery부터 이어간다. 합성 evidence를 운영에 복사하지 않는다. 이후 campaign→adgroup 아래 keyword와 creative를 각각 생성하며 매 관련 mutation 전 상위 중지 상태를 원격 확인한다. partial/duplicate batch와 child-first remote cleanup을 검증하고 blind retry하지 않는다.

현재 transaction의 사후 suspend/credential 변경, 기존 raw writer/실행기와 lock protocol 채택, 일반 lifecycle 원자성,0007 start shared-risk 통합은 아직 남았다. E의 실제 HTTP/앱 연결·재시작, F 최종 acceptance도 미완료다. 내부 risk units/UTC 날짜는 실제 광고비나 한국 일예산이 아니다. 공개 readiness는 초기화 상태이지 계정별 실행 권한/live probe가 아니다.

**실제 Naver 요청·광고 변경·운영 gate 변경·production migration·Hostinger 배포·main 변경·병합은 하지 않았다.**

## 고정 이력

[읽기 전용/373 및 B2a 정정](https://github.com/jskjw157/AtelierPopo/blob/c0668561e7306cfa802d3ab9eb960ee3531b8548/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [B1/311](https://github.com/jskjw157/AtelierPopo/blob/035098228dbabdd48669f42f36c054cc38fc68af/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [0008/293](https://github.com/jskjw157/AtelierPopo/blob/5a5ae1c713bfc8343be774635a8d63532030db55/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md)와 closed#25에 이전 근거가 있다. 과거 closed#17/local-only checkpoint는 현재#26 완료의 근거가 아니다.
