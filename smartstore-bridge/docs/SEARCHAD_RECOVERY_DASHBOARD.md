# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-13

**캠페인 한 건의 별도 삭제 계획·승인·대상 이중 확인 → 중지 상태 GET → 원자적 token/risk/삭제 intent → DELETE 한 번 → GET 부재 확인·조회 복구까지 내부 경로를 연결·검증했다. 다음은 광고그룹·키워드·소재와 batch/child-first 확장이다. 전체 #26은 OPEN, PR24는 Draft다.**

이전 생성·LOCAL dispatch·일반 읽기 전용 재조회·async 실행기는 보존했다. 새 삭제 서비스는 기본 OFF이며 application HTTP/bootstrap에 연결하지 않았다. 실제 PostgreSQL·기존 생성/승인·서명 계층을 쓰지만 네이버 응답과 권한 증거는 fixture다. 실제 광고를 생성·삭제한 것은 아니다.

| 기준 | 값 |
| --- | --- |
| Repository / app |`jskjw157/AtelierPopo` / `smartstore-bridge`|
| Branch |`codex/searchad-original-recovery-20260912`|
| Protected PR base |`codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568`|
| **현재 검증 코드·테스트·CI SHA** |**`b4f150eb85c6dc47817e7e741a2f15a46ffd7abb`**|
| **Canonical code CI** |**[34728180337](https://github.com/jskjw157/AtelierPopo/actions/runs/34728180337), job103645987241, completed/success; 전체 로그·모든 최종 단계 확인**|
| **전체 / 필수 PG / 신규 삭제 반복** |**510/0/0 ·220/0/0 ·48/0/0**|
| 직전 생성 코드 / 문서 |`649dafcb622799ed88acb257b6a08fe55d965403` / `022a8d2bc1790b1bebfe2d696a5effaea050acbe`|
| 이전 문서 CI 관측 보완 |34723978483/job103634750459, completed/success; 모든 설정 단계 성공 확인|
| Migration |0009, schema·dependency·default gate 변경 없음; 테스트 DB만 사용|

[Master23](https://github.com/jskjw157/AtelierPopo/issues/23) · [현재26](https://github.com/jskjw157/AtelierPopo/issues/26) · [Draft PR24](https://github.com/jskjw157/AtelierPopo/pull/24) · [현재 검증·해시·한계](SEARCHAD_0009_CAMPAIGN_CLEANUP_VERIFICATION.md) · [삭제 계획](superpowers/plans/2026-09-13-searchad-campaign-cleanup.md)

Markdown 작업판이며 GitHub Projects 변경은 아니다. 이번 문서 전용 후속 SHA/CI는 issue26/PR24에 코드 검증과 별도로 기록한다. 이전 문서 CI 성공은 새 구현 성과가 아니다.

## 순차 작업판

| 단계 | 상태 |
| --- | --- |
|0007 Canary/Gateway/역할 HTTP|VERIFIED, 미병합·미배포|
|#25 /0008 activation·기존 async·실제 PG/HTTP·readiness/close|COMPLETED, 회귀 보존|
|#26-A/B1 목록·순수 계층 descriptor|INVENTORIED / VERIFIED|
|#26-B2a schema/repository/risk|VERIFIED, 정정된 storage-only 범위|
|B2b 일반 읽기 전용 재조회·로컬 관찰 확정|VERIFIED bounded slice, 보존|
|B2b/C/D 캠페인 LOCAL token+risk+intent|VERIFIED 기존 ecb817f, 보존|
|캠페인 서버 계획·단일 POST·반환 ID/소유권·GET|VERIFIED bounded internal create path, 649dafc 보존|
|**자식 없는 캠페인 한 건의 별도 승인 삭제·GET 복구**|**VERIFIED bounded internal cleanup, b4f150e**|
|**adgroup/keyword/creative·batch·상위 중지·child-first 삭제**|**NEXT — PENDING**|
|만료된 미사용 cleanup plan의 폐기·재계획|PENDING, 현재 자동 재계획 거부|
|C/D 일반 lifecycle scope/원자성·기존 실행기/0007 start 채택|PARTIAL, 전체 미완료|
|실제 lifecycle evidence 발급 경로|PENDING, fixture를 운영 권한으로 사용 금지|
|E 실제 lifecycle app/역할 HTTP/whole-app restart|PENDING|
|F 전체0009 acceptance/종료|PENDING|
|#18 reporting/Circuit/automation|PENDING|
|#19 worker/scheduler/registry,0019 기능 수준|PENDING|
|#20 profitability/recommendation/limited Auto|PENDING|
|#21 최종 suspend-to-send 경계·운영 준비·독립 리뷰|PENDING|
|#22 배포/실계정 검증/활성화|NOT STARTED, 별도 승인|

## 이번 구현과 실제 검증 범위

이전 source/test/schema/dependencies는 한 바이트도 바꾸지 않았다. 새 서비스86줄·PG 저장소218줄·PG 테스트275줄·계획을 추가하고 canonical workflow는 모든 기존 줄·단계·pin을 보존한 채40줄만 추가했다. 새3개 경로만 예외로 둔 뒤 시작 SHA diff와 정확한 blob pin으로 보호한다.

기존 생성 서비스가 만든 applied plan·반환 ID snapshot/hash·immutable 생성/검증 event·object/ownership의 연결을 확인한다. 서버가 별도 삭제 계획을 만들고 기존 approval 서비스가 새 token을 발급한다. delete-only active evidence/grant와 정확한 operation confirmation 및 전체 Customer/캠페인 대상 확인을 요구한다. 임의 ID/body/URL을 받지 않고, 자식이나 추가 소유권이 있으면 거부한다.

중지 상태와 정확한 ID/Customer/type/name/budget을 GET으로 확인한 뒤 동일 PG transaction에서 token/risk 소비·pending 상태·삭제 intent/audit를 저장한다. 잠금 대기 후 만료와 관찰 유효시간을 다시 확인한다. COMMIT 응답 불명확 시 전송 허가를 내주지 않는다. DELETE는 최대 한 번만 시도하며 redirect:error/maxRetries0이다.

DELETE 성공 응답만으로 완료 처리하지 않는다. 동일 저장 ID의 명시적 upstream GET404만 부재 근거다. 상태·소유권·삭제 plan·감사를 함께 확정하고, hierarchy run은 cleanup_pending에 남긴다. Canary PASS/evidence 발급·consumed risk 재사용은 없다. 삭제 응답 기록 또는 조회 감사 저장이 실패해도 GET-only reconcile로 복구하며, 계정 중단·mutation OFF에서도 조회를 유지한다.

신규47 child+parent=48 검사는 각기 UUID PostgreSQL schema를 사용한다. 기존 실제 생성 서비스로 계획·승인·모의 POST·ID 저장·GET 검증까지 거친 캠페인에 삭제 경로를 적용한다. 실제 DB·승인·registry·credentials·Gateway·signing을 사용하고 fetch 응답과 권한 evidence/grant만 fixture다. 외부 fetch trap과 서명/호출 assertion counter를 둔다. 두 pool 재구성은 전체 앱 재부팅이 아니다.

## 검사와 실패 증거

| Canonical code CI | Pass / fail / skip |
| --- | --- |
|Canary / activation / hierarchy+readonlyunit|51/0/0 ·30/0/0 ·29/0/0|
|기존 write / 역할 HTTP-readiness|49/0/0 ·14/0/0|
|**필수 PostgreSQL**|**220/0/0**|
|기존 Canary/activation/app PG 반복|31/0/0|
|storage/risk / readonlyunit+PG / signedreadonlyPG|21/0/0 ·25/0/0 ·16/0/0|
|기존 campaign dispatch / create PG 반복|41/0/0 ·48/0/0|
|**신규 campaign cleanup PG 반복**|**48/0/0**|
|**전체 회귀**|**510/0/0**|

기존462+신규48=510이다. 집중·반복은 전체와 중복되므로 합산하거나 완료율로 환산하지 않는다. 기존/신규 보존 pin·diff·정적검사와 모든 설정 단계가 통과했고 두 최종 migration은0009/applied:[]이다. Commerce116/SearchAd126unique117allowlisted/내부 runtime 누출0, bridge production audit0도 확인했다. 기존 write scanner16sources는 새 lifecycle 전체 보안 검사나 독립 리뷰가 아니며 API coverage는 live 검증이 아니다. SQLite/Actions Node 경고는 남는다.

Local RED는 missing-service0/1/0, 계획 저장 도중 만료44/2/0이다. 후자는 COMMIT 직전 expiry 확인으로 수정했다. 이전46-test 단계에서 중복 DELETE 비교 코드는38/8/0으로 실패했고 정확한 원본 복원 후46/0/0, 추가 검사 후48/0/0을 확인했다. 비교 코드는 게시하지 않았고 canonical CI에서 실행했다고 주장하지 않는다. 모든 행동의 개별 RED도 주장하지 않는다.

로컬은 이전 생성 PG 테스트 파일 하나가 없는 별도 exported snapshot이므로 로컬462/172와 canonical510/220은 범위가 다르다. 원격 CI는 이전 생성48개를 포함해 전부 실행했다. 로컬 검증·해시·소스 확보 한계는 검증 문서에 구분했다.

## 핵심 한계 / 다음 구현

한 번의 내부 전송 시도는 외부 exactly-once나 전달 보장이 아니다. COMMIT 응답 손실/프로세스 중단/전송 전 차단으로 전송0회와 consumed risk가 남을 수 있으며 재전송·risk 재활용을 하지 않는다. **최종 claim COMMIT 이후 account suspend와 실제 send 사이의 원자적 차단은 미완료(#21)**이고 원격 상태가 GET 이후 바뀌는 것도 외부 transaction으로 봉쇄하지 않는다. 모든 raw writer/기존 executor의 공통 잠금 채택도 남아 있다.

현재는 자식 없는 캠페인 전용이다. 다음은 campaign→adgroup와 그 아래 sibling keyword/creative 생성, 매 관련 mutation 직전 authoritative stopped ancestor, partial/duplicate/malformed batch 응답 결합, child-first cleanup이다. 만료된 미사용 삭제 계획의 폐기·재계획도 별도 구현한다. 실제 create/delete lifecycle evidence 발급, C/D 일반화, E 역할 HTTP·app·readiness·close·restart, F acceptance 전에는 live 경로를 노출하지 않는다. 목표는0010에서 멈추는 것이 아니라0019 기능 수준과#20–22까지다.

## 이전 B2a 보고 정정 / 고정 이력

raw 복합 Customer/run/parent 강제, run+risk 원자결합, 범용 dispatch/cleanup claim, dry-run-only release, 범용 redaction과 child-first cleanup을 B2a 성과로 표시했던 설명은 철회 상태다. 실제 B2a는 명시적 Customer 필터·저장된 부모의 별도 validator·고유성·재접속·immutable event·risk 회계다. 원본/현재 raw repository는 동일 b63fd592d186ea56297fc2f60dac13e92e97203b, 저장소 각 child는 UUID schema다. 새 삭제 coordinator를 과거 B2a나 기존 전체 실행기로 소급하지 않는다.

[직전 생성/462와 이전 전체 이력](https://github.com/jskjw157/AtelierPopo/blob/022a8d2bc1790b1bebfe2d696a5effaea050acbe/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md) · [정정된 B2a 기록](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md). 414 LOCAL,373 read-only,311 B1,293/closed25는 해당 고정 기록으로 유지한다. 과거 closed17/local-only 기록은 현재#26 완료가 아니다.

내부 risk는 UTC 용량 단위이지 광고비 원화/한국 일예산이 아니다. 공개 readiness는 초기화 상태이지 계정별 실행 허가/live probe가 아니다. **실제 Naver 요청·광고 변경·운영 gate/migration·Hostinger 배포·main 변경·병합 없음. #26 OPEN / PR24 Draft / 독립 리뷰 미완료.**
