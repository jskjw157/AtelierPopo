# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**#26-B2a: PostgreSQL 계층 저장소·내부 리스크 계산 검증 완료. 다음은 B2b의 계층 실행 순서 복구다. B2 전체와 C/D/E/F는 아직 미완료다. #26 OPEN / PR24 Draft를 유지한다.**

이전 B1-only/migration0008 재개 지시는 아래 체크포인트로 대체한다. `0009`는 테스트 DB의 현재 스키마이며 실제 광고 실행·운영 배포를 뜻하지 않는다.

| 기준 | 값 |
| --- | --- |
| Repository / application | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568` |
| **검증 코드·테스트·CI설정** | **`5c4be3077e67bfd257ce176c3fe9727d9331a101`** |
| **완료 CI** | **[34674108418](https://github.com/jskjw157/AtelierPopo/actions/runs/34674108418), job `103500743097`, completed/success; 전체 로그 확인** |
| **전체 회귀** | **332 passed / 0 failed / 0 skipped** |
| 필수 PostgreSQL / 저장소·risk 반복 | **53/0/0 / 21/0/0** |
| 테스트 DB migration head | **0009**, 두 최종 재실행 모두 `applied:[]` |
| 다음 구현 | **#26-B2b**, 이후 C/D/E와 F |

[Master#23](https://github.com/jskjw157/AtelierPopo/issues/23) · [현재#26](https://github.com/jskjw157/AtelierPopo/issues/26) · [Draft PR24](https://github.com/jskjw157/AtelierPopo/pull/24) · [B2a 정확한 검증/해시/한계](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md) · [B2a/B2b 계획](superpowers/plans/2026-09-12-searchad-0009-storage-recovery.md)

후속 문서 전용 HEAD 및 그 CI는 #26/PR24에 코드 체크포인트와 별도로 기록한다. 이 문서는 Markdown 대시보드이며 GitHub Projects 보드 갱신을 주장하지 않는다.

## 순차 작업판

| 단계 | 상태 |
| --- | --- |
| 0007 Canary/Gateway/역할 HTTP | VERIFIED, 미병합·미배포 |
| #25 /0008 activation·async 실행·실제 PG/HTTP·공개 readiness/close | COMPLETED; #25 closed, 회귀 보존 |
| #26-A 원본 목록·이식 방침 | INVENTORIED; 전체 보안 감사가 아님 |
| #26-B1 순수 계층 validator/descriptor | VERIFIED; 기존18개 검사 유지 |
| **#26-B2a 계층 schema/repository/risk 저장소** | **VERIFIED —5c4be30** |
| **#26-B2b authoritative 원격 확인·계층 실행·cleanup/reconcile** | **NEXT — PENDING** |
| #26-C/D/E lifecycle 승인·scope/ownership·token/risk/dispatch·실제 application HTTP | PENDING |
| #26-F 전체0009 acceptance/검증/종료 | PENDING; B2a 기록 완료는 F완료가 아님 |
| #18 reporting/Circuit/automation | PENDING |
| #19 durable worker/scheduler/operation registry,0019 기능 수준 | PENDING |
| #20 profitability/recommendation/limited Auto | PENDING |
| #21 전체 운영 준비·동시성·독립 리뷰 | PENDING |
| #22 배포·실계정 검증/활성화 | NOT STARTED — 별도 승인 |

## 이번 결과

현재 원격에 이미 추가된 저장소 복구 코드를 이어서 검증했다. diagnostic20655c9/CI34672961239/job103497683302의 전체331통과/1실패는 마이그레이션 목록이0008까지만 기대한 문제였다. 5c4be30에서는 목록과 마지막 파일명 기대값 두 곳만 갱신하고, 기존 테스트4파일의6개 버전 기대값 외에는 변경되지 않았음을 역변환 해시로 검사했다. 실패를 없애려고 assertion을 제거하거나 검사를 건너뛰지 않았다.

새 PostgreSQL 검증은 계정·실행·부모 결합, 연결 재생성 후 기록 보존, 변경 금지 감사 이벤트, 동시 리스크 한도 경쟁, 예약 ID 재결합 차단, DB 전송 claim의 단일 승자, 불명확한 상태의 재진입/리스크 반환 차단, 자식 우선 cleanup 목록과 상태 claim, 이벤트 비밀정보 제거, 기존 grant의 빈 lifecycle scope 유지 등을 확인했다.

**검증 경계:** parent test의 UUID schema와 실제 PG 연결/저장소를 사용했다. 재접속은 전체 앱 재부팅이 아니며, DB claim은 실제 Naver 전송이 아니다. synthetic 원격 ID·snapshot·grant는 CI 입력이다. cleanup은 저장소의 정렬/상태 변화 검사이며 원격 삭제 검증이 아니다. 내부 risk units/UTC 날짜는 실제 광고비 또는 한국시간 일예산 정책과 별개다.

## 검사와 보존

| 코드 CI 검사 | pass/fail/skip |
| --- | --- |
| Canary / activation / pure hierarchy | 51/0/0 · 30/0/0 · 18/0/0 |
| 기존 write / 역할 HTTP·readiness | 49/0/0 · 14/0/0 |
| 필수 PostgreSQL / 기존 PG 반복 | **53/0/0** · 31/0/0 |
| 저장소+리스크 반복 | **21/0/0** |
| 전체 회귀 | **332/0/0** |

311→332는 PG parent1+child16+risk4이며20개 leaf/21 counted tests다. 집중·반복은 전체와 중복되고 제품 완료율이나 실제 허용 기능 수로 환산하지 않는다.

0009 schema와 risk service/test는 원본 blob, repository는 명시적인 수정 복구본이다. 상세6개 blob은 검증 문서에 있다. 기존 historical24/integration5/activation reverse7/B1원본6 및 새 저장소 pins, 기존 코드/의존성/0001–0008 migration 보존이 통과했다. 기존4개 테스트의6개 버전 기대값만 허용하며 reverse checker의 sourceWrites는0이다.

기존 write scanner는16 source/raw network0 범위로, 전체 보안 감사가 아니다. 번들 coverage Commerce116/SearchAd126 unique·117 allowlisted는 live검증이 아니다. bridge production audit 보고 취약점0이며 root감사는 아니다. SQLite experimental/Actions Node 경고는 남는다.

## 다음 구현과 운영 경계

B2b는 기존 orchestrator를 그대로 붙이지 말고, 매 mutation 전 authoritative stopped parent 확인, returned-ID/read-back의 Customer/parent/type 결합, 잘못된/부분/중복 batch 응답과 cleanup/reconcile을 검사하며 증분 복구한다. 기존 실행기는 유지한다.

C/D에서 승인 token+리스크 사용+dispatch intent 원자성을 별도로 입증해야 한다. 저장소의 run/risk transaction 및 claim 통과만으로 승인 실행의 원자성을 주장하지 않는다. 현재0007 start의 shared-risk 원자적 연결도 별도다. 신규 HTTP 실행 연결, 이중 확인/부모 삭제 보호, 실제 앱 재시작과 read-only reconcile은 E에 남는다.

공개 /health/ready는 초기화된 인프라 상태이지 계정별 실행 허가나 실시간 연결 검사가 아니다. guard 직후 동시 suspend 차단과 독립 리뷰는#21, 실계정 capability/Canary/활성화는#22다.

**실제 Naver 요청·광고 변경·운영 gate 변경·production migration·Hostinger 배포·main 변경·병합은 하지 않았다.**

## 고정 이력

[B1/311 고정 대시보드](https://github.com/jskjw157/AtelierPopo/blob/035098228dbabdd48669f42f36c054cc38fc68af/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [B1 원본 감사](SEARCHAD_0009_RECOVERY_AUDIT.md), [0008/293 고정 대시보드](https://github.com/jskjw157/AtelierPopo/blob/5a5ae1c713bfc8343be774635a8d63532030db55/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), closed#25에 이전 해시·RED/GREEN·범위 기록이 남아 있다. 과거#17 closed나 local-only checkpoint는 현재 복구 완료의 근거가 아니다.
