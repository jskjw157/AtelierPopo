# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-13 / campaign → adgroup

**캠페인 생성·자식 없는 캠페인 삭제는 기존 원격 구현을 보존했다. 이번 추가 범위는 검증된 캠페인 아래 광고그룹 한 건의 서버 계획 → 별도 승인 → 중지 상태 GET → token/risk/intent 원자적 저장 → POST 한 번 → ID/부모 소유권 저장 → GET 검증이다.**

새 서비스는 기본 OFF, 내부 호출 전용이며 실제 앱 HTTP/bootstrap에는 연결하지 않았다. 실제 PostgreSQL·기존 캠페인 생성/승인·서명 Gateway를 조합하되 네이버 응답과 권한 증거는 fixture다. **실제 광고 변경 없음, #26 OPEN / PR24 Draft 유지.**

| 기준 | 값 |
| --- | --- |
| Repository / app |`jskjw157/AtelierPopo` / `smartstore-bridge`|
| Branch |`codex/searchad-original-recovery-20260912`|
| Protected PR base |`codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568`|
| 이번 코드·테스트·CI SHA |`ba22f14796a337831c60f0b366b79303d233e78a`|
| 원격 코드 CI |**[34732369828](https://github.com/jskjw157/AtelierPopo/actions/runs/34732369828), job103657392347, completed/success; 전체 로그·최종 단계 확인**|
| **원격 전체 / 필수 PG / 신규 PG 반복** |**590/0/0 ·300/0/0 ·80/0/0**|
| 로컬 새 PG 반복 |80 passed /0 failed /0 skipped|
| 로컬 확보된 회귀 / 필수 PG |494/0/0 ·204/0/0; 기존 캠페인 테스트 48+48개가 없는 export 범위, 원격 전체 수치와 구분|
| Migration |0009; schema/dependency/default gate 변경 없음|
| 직전 원격 HEAD |`6d9bc90e3261b075e3f6427d01d5e1a485662f2e`, 기존 cleanup 검증 코드 `b4f150eb85c6dc47817e7e741a2f15a46ffd7abb`|
| 직전 문서 CI 관측 |34728631484/job103647227734 completed/success, 모든 최종 단계 확인|

[Master23](https://github.com/jskjw157/AtelierPopo/issues/23) · [현재26](https://github.com/jskjw157/AtelierPopo/issues/26) · [Draft PR24](https://github.com/jskjw157/AtelierPopo/pull/24) · [이번 검증·정확한 해시·한계](SEARCHAD_0009_ADGROUP_CREATE_VERIFICATION.md) · [광고그룹 실행 계획](superpowers/plans/2026-09-13-searchad-adgroup-create.md)

## 순차 작업판

| 단계 | 상태 |
| --- | --- |
|0007 Canary/Gateway/역할 HTTP|기존 VERIFIED, 미병합·미배포|
|#25 /0008 activation·기존 async·실제 PG/HTTP·readiness/close|기존 COMPLETED, 회귀 보존|
|#26-A/B1 목록·순수 descriptor|INVENTORIED / VERIFIED|
|#26-B2a schema/repository/risk|정정된 storage-only 범위 VERIFIED|
|일반 읽기 전용 재조회·로컬 관찰 확정|기존 bounded VERIFIED|
|캠페인 LOCAL token/risk/intent, 서버 생성/응답 ID/GET|기존 bounded VERIFIED|
|자식 없는 캠페인 별도 승인 삭제·GET 복구|기존 bounded VERIFIED|
|캠페인 아래 광고그룹 한 건의 별도 승인 생성|**VERIFIED bounded internal slice — canonical590, 새80**|
|**광고그룹 승인 삭제·모든 자식 정리 후 부모 삭제**|**NEXT — PENDING**|
|keyword/creative sibling 생성·batch·부분/중복 응답|PENDING|
|만료된 미사용 plan 폐기·재계획|PENDING; 현재 자동 재계획 거부|
|일반 lifecycle evidence 실제 발급|PENDING; fixture를 운영에 복사 금지|
|C/D 전체 lifecycle/원자성·기존 실행기/0007 start 채택|PARTIAL, 전체 미완료|
|E 실제 lifecycle app/role HTTP/readiness/close/restart|PENDING|
|F 전체0009 acceptance/종료|PENDING|
|#18 reporting/Circuit/automation|PENDING|
|#19 durable worker/scheduler/registry,0019 기능 수준|PENDING|
|#20 profitability/recommendation/limited Auto|PENDING|
|#21 최종 suspend-to-send 경계·운영 준비·독립 리뷰|PENDING|
|#22 배포/실계정 검증/활성화|NOT STARTED, 별도 승인|

## 이번 변경의 의미

임의로 입력한 캠페인 ID 대신 기존 생성 서비스의 applied plan·반환 ID snapshot/hash·immutable 생성/검증 event·object/hold가 연결된 부모만 사용한다. 실제 캠페인 삭제 계획과 광고그룹 계획이 먼저 만들어지면 상대 경로가 차단되며, 동시 실행도 검사했다. 각기 별도 광고그룹 권한·승인 token이 필요하다.

상위 캠페인의 정확한 중지 상태를 조회한 뒤 승인·risk·전송 intent를 함께 저장하고 한 번만 POST한다. 부모와 연결된 반환 ID/소유권 보류를 먼저 저장한 뒤 GET 검증하며, 성공해도 hierarchy run은 cleanup_pending에 남는다. 마지막 감사 저장 도중 인증키가 변경되는 회귀를 재현해 소유권 확정 직전 재검사로 수정했다.

기존 source/test/schema/package/default gate 변경0. 신규 모듈3개·테스트1개·계획1개와 기존 줄을 모두 유지한 CI53줄 추가다. 신규 PG는79 child+parent=80개다. 명시적 Customer/부모/권한, 중복·동시 실행, 잠금 중 만료/날짜 변경, 응답 이상, 기록 rollback, 소유권 변경, COMMIT 응답 손실 등을 검사한다. 부모는 실제 기존 서비스로 만들지만 upstream 및 active evidence/grant는 모의다. pool 재구성은 전체 앱 재부팅이 아니다.

원격 CI는 기존 캠페인 생성·삭제 테스트 각48개를 포함해 전체590/0/0, 필수PG300/0/0, 새 광고그룹 반복80/0/0을 확인했다. 기존 모든 단계·보존 검사도 성공했고 최종 migration2회는0009/applied:[]다. Bridge production dependency audit0이며 SQLite/Actions Node 경고는 남는다. 집중·반복 검사 수치를 전체에 중복 합산하지 않는다. 문서 후속 CI는 별도 기록한다.

## 남은 안전 경계

내부의 최대 한 번 전송 시도는 외부 exactly-once 또는 전달 보장이 아니다. COMMIT 응답 손실·중단·전송 전 차단은 실제 전송0회와 consumed risk를 남길 수 있다. POST 응답 저장 실패 시 ID를 잃을 수 있으며, 이름 검색·임의 ID·무조건 재전송·risk 환급으로 처리하지 않는다.

최종 COMMIT 이후 계정 suspend와 실제 전송 사이를 원자적으로 막는 문제(#21), 원격 부모가 GET 이후 바뀌는 문제, 관련 raw writer 전체의 공통 잠금 적용은 미완료다. 이번 인증키 재검사는 이 문제들을 해결한 것으로 계산하지 않는다.

광고그룹 payload는 기존 고정 recipe의 nccCampaignId/name/userLock 범위다. 모든 실계정 광고그룹 유형·비즈채널 필드 지원이나 네이버의 실제 수락을 입증하지 않는다. child cleanup과 운영 lifecycle evidence, 전체 C/D/E/F 전에는 live route를 노출하지 않는다. 기존 캠페인 cleanup은 자식 레코드가 있으면 계속 거부한다. 일반 재조회도 ambiguous child create를 자동 owned로 승격하지 않는다. 독립 리뷰 승인 없음.

## 이전 기록과 정정 보존

[직전 캠페인 cleanup /510 전체 기록](https://github.com/jskjw157/AtelierPopo/blob/6d9bc90e3261b075e3f6427d01d5e1a485662f2e/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md) · [생성/462와 이전 전체 이력](https://github.com/jskjw157/AtelierPopo/blob/022a8d2bc1790b1bebfe2d696a5effaea050acbe/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md) · [정정된 B2a](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md). 이전414 LOCAL,373 read-only,311 B1,293/closed25는 고정 기록으로 유지한다.

B2a에서 raw 복합 Customer/run/parent 강제, 범용 원자적 dispatch/cleanup, dry-run-only release, 범용 redaction·child-first cleanup을 완료했다고 했던 설명은 철회 상태다. 실제 B2a는 명시적 Customer 필터·저장 부모 별도 validator·고유성·재접속·immutable event·risk 회계다. 이번 coordinator를 과거 B2a나 전체 기존 실행기에 소급하지 않는다.

내부 risk는 UTC 용량 단위이며 원화/한국 일예산이 아니다. readiness는 초기화 상태이지 실계정 실행 허가가 아니다. 기존 write scanner16sources·번들 API coverage는 전체 보안/실계정 검증이 아니다. 문서 후속 SHA/CI는 코드 CI와 별도로 #26/PR24에 기록한다. 목표는0019 기능 수준과#20–22까지이며 **#26 OPEN / PR24 Draft / 미배포**다.
