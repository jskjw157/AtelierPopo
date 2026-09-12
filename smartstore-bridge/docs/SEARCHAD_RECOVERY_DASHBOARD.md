# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**현재 #26은 OPEN: 원본 변경 범위와 이식 방침을 정리했고, B1 계층 검사·요청 생성 모듈 복구를 검증했다. 다음은 #26-B2의 PostgreSQL 계층 저장·오케스트레이션 검토/복구다. 0009 전체 실행 기능은 아직 미완료이며 migration은0008이다.**

- [Master #23](https://github.com/jskjw157/AtelierPopo/issues/23), [현재 #26](https://github.com/jskjw157/AtelierPopo/issues/26), [Draft PR #24](https://github.com/jskjw157/AtelierPopo/pull/24).
- [0009 원본 대조·B1 검증 기록](SEARCHAD_0009_RECOVERY_AUDIT.md), [현재 복구 계획](superpowers/plans/2026-09-12-searchad-0009-recovery.md).
- [완료한0008 고정 기록](https://github.com/jskjw157/AtelierPopo/blob/5a5ae1c713bfc8343be774635a8d63532030db55/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), 종료 이슈#25. 과거#17의 닫힘은 현재0009 복구 완료가 아니다.

| 기준 | 값 |
| --- | --- |
| Repository / application | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Working branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568` |
| 이번 증분 시작 | `5a5ae1c713bfc8343be774635a8d63532030db55` |
| **검증 코드·테스트·CI설정 SHA** | **`0fe2bd013e99c29a7469b5471368847d5084d012`** |
| **완료된 GREEN CI** | **[34670962167](https://github.com/jskjw157/AtelierPopo/actions/runs/34670962167), job `103492109034`, completed/success; 전체 로그 확인** |
| **전체 회귀** | **311 passed, 0 failed, 0 skipped** |
| Migration head | **0008**,0009 스키마 미이식 |
| 현재 단계 | **#26-B1 VERIFIED / B2–F PENDING; #26 OPEN** |

이 문서는 저장소 Markdown 대시보드다. GitHub Projects 보드 갱신은 주장하지 않는다. 후속 문서 전용 HEAD와 그 CI 완료 여부는 #26/PR24에 코드 검증 SHA와 구분해 기록한다.

## 현재 순차 작업판

| 단계 | 상태 / 실제 범위 |
| --- | --- |
| 0007 Canary / Gateway / 역할 HTTP | VERIFIED; 미병합·미배포 |
| #25 /0008 활성화·현재 async 실행·실제 PG/역할 HTTP·공개 readiness | COMPLETED; 이전 코드9a0b0c8/전체293, 기록은 고정 링크/#25 |
| #26-A 원본 변경 목록·복구 구분 | INVENTORIED; 전체 모듈 보안 감사나 독립 리뷰 완료가 아님 |
| #26-B1 계층 validator / operation / descriptor recipe | **VERIFIED — 0fe2bd0**, 순수 모듈4개+원본테스트2개 |
| #26-B2 계층 PostgreSQL schema/repository/orchestration | **NEXT — PENDING** |
| #26-C/D/E 승인 실행·scope/ownership·token/risk/dispatch·실제 application HTTP | PENDING |
| #26-F 전체0009 최종 CI·기록 동기화·이슈 종료 | PENDING; B1 기록 갱신은 F완료가 아님 |
| #18 reporting / Circuit / automation | PENDING |
| #19 durable worker / scheduler / operation registry,0019 기능 수준 | PENDING |
| #20 profitability / recommendation / limited Auto | PENDING |
| #21 전체 통합·운영 준비·독립 리뷰·동시성 | PENDING |
| #22 배포·실계정 검증/활성화 | NOT STARTED — 별도 승인 필요 |

## 이번에 복구한 것과 하지 않은 것

원본 `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`의 `operations.js`, `hierarchy-validator.js`, `recipe-campaign.js`, `recipe-hierarchy.js`와 원본 테스트2개를 정확한 Git blob으로 복구했다. 경로와6개 전체 해시는 별도 대조 기록에 있다.

현재 번들의12개 API operation key 정합성, 계정/실행/부모/타입 검사, 중첩 existing-ID 주입 거부, stopped WEB_SITE 설정, keyword batch 경계와 TEXT_45 타입, 저장된 returned-ID 기반 조회/삭제 요청 생성을 검사했다. 구조는 **campaign→adgroup, 그 아래 keyword와 creative가 각각 자식**이다.

**이 모듈들은 요청 descriptor만 생성한다. 신규 lifecycle 서비스·DB0009·실행·HTTP에는 연결하지 않았다.** 테스트의 parent/object/ownership 값은 fixture이며 실제 소유권 증거나 실계정 PASS가 아니다. 새 테스트6개는 fetch호출을 금지하고0건을 확인한다. 기존PG36/반복31의 통과는0008 회귀이지0009 PG기능 검증이 아니다.

과거 실행 코드는 synchronous plan/token 접근이 포함되어 있어 그대로 가져오지 않았다. 현재 async executor/approval/locks/activation/bootstrap/server/close 및 기존 테스트·의존성·설정·migration0001–0008은 변경하지 않았다.

## 실제 RED → GREEN

| Commit | CI / job | 결과 |
| --- | --- | --- |
| `a226d15a90d343c6214a7bb49db082d7651aca80` |34670682168 /103491332326|기존293통과, 새 missing-module assertion6실패, skip0|
| **`0fe2bd013e99c29a7469b5471368847d5084d012`** |**34670962167 /103492109034**|**전체311/0/0, 설정된 모든 단계 성공**|

| GREEN 검사 | pass / fail / skip |
| --- | --- |
| 신규 계층 validator/recipe/recovery |**18/0/0**|
| Canary/Gateway/역할 HTTP |51/0/0|
| Activation core/Customer |30/0/0|
| 기존 write 집중 |49/0/0|
| 기존 역할 HTTP/readiness/runtime lifecycle |14/0/0|
| 필수 PostgreSQL |36/0/0|
| 반복 PostgreSQL |31/0/0|
| **전체 회귀** |**311/0/0**|

293→311은 원본테스트12+새테스트6이며 집중·반복은 전체와 중복되어 합산하지 않는다. 테스트 수/마이그레이션 수로 제품 전체 완료율을 계산하지 않는다.

기존 historical24/integration5/reverse-edit7, 새 historicalB1해시6,0008완료 checkpoint 대비 보존 검사, 정적 검사와 모든 기존 CI단계가 통과했다. workflow는40줄 추가만 있으며 검사 삭제는 없다. 기존 write scanner 범위16파일/rawnetwork0, bridge production audit 보고취약점0, 번들coverage Commerce116/SearchAd126unique·117allowlisted·internal누출0이다. 전체 보안 감사·root감사·live capability검증이 아니다. 두 migration 재실행은0008/applied:[]. SQLite experimental/Actions Node 경고는 남아 있다.

## 다음 구현과 운영 경계

B2에서는0009 schema/repository와 hierarchy orchestration 의존성을 검토하고 UUID별 실제PG schema로 migration 반복·불변성·소유권·재시작·unknown outcome·child-first cleanup을 검증한다. 이어 현재 async 실행에 exact lifecycle activation, ownership hold, 승인token/risk/dispatch 원자성과 실제 역할HTTP를 통합한다. 기존 CI 보존 범위의 변경도 필요 항목만 명시적으로 한다.

동시 suspend가 guard검사 직후 들어오는 상황의 원자적 차단, 독립 리뷰, live DB/credential/capability는 이번 완료 범위가 아니다. 공개 readiness는 초기화된 인프라 상태이며 계정별 실행 허가가 아니다.

**실제 Naver 요청·광고 변경·운영 gate 변경·production migration·Hostinger 배포·main 변경·PR 병합은 하지 않았다. #26은 OPEN, PR24는 Draft다.**
