# HAAR SearchAd — Recovery Dashboard

## RESUME HERE

**현재 작업: [#25 — 0008 Activation Control 복구](https://github.com/jskjw157/AtelierPopo/issues/25), IN PROGRESS.**

- Master: [#23](https://github.com/jskjw157/AtelierPopo/issues/23)
- Draft PR: [#24](https://github.com/jskjw157/AtelierPopo/pull/24)
- 작업 브랜치: `codex/searchad-original-recovery-20260912`
- 마지막 확인된 GREEN: `fe6551d6fef98179f6c9be7dd8f3a96fe3aa5b44`, CI `34657089431`, 전체 212/0/0.
- 이 커밋은 0008 복구 전 실패를 확인하는 테스트 단계다. 테스트 추가를 기능 완료로 간주하지 않는다.

## 순차 작업판

| 순서 | 범위 | 현재 복구 상태 | 연결 이슈 |
| --- | --- | --- | --- |
| 1 | 0007 Canary core / Gateway / HTTP | VERIFIED, 미병합·미배포 | #24, 과거 #12–#15 |
| 2A | 0008 activation core / schema / 계약 | IN PROGRESS | #25, 원본 #16 |
| 2B | 0008 repaired async write / HTTP / bootstrap 연결 | PENDING — 2A 이후 | #25 |
| 3 | 0009 hierarchy / lifecycle | PENDING — #25 완료 이후 | 과거 #17 |
| 4 | 0010 reporting 및 이후 Circuit / automation | PENDING | #18 |
| 5 | durable worker / scheduler / operation validation | PENDING | #19 |
| 6 | profitability / recommendation / limited Auto | PENDING | #20 |
| 7 | 통합 회귀 / PostgreSQL / safety / migration 검증 | PENDING | #21 |
| 8 | PR 통합 / 배포 / 실제 계정 검증·활성화 | NOT STARTED — 별도 승인 필요 | #22 |

## 상태 운영 규칙

한 번에 현재 미완료 단계 하나만 진행한다. 순서는 IN PROGRESS → 구현 → 해당 SHA의 테스트/CI 검증 → 이슈·대시보드·PR 갱신이다. 핵심 모듈만 복구됐으면 CORE_VERIFIED / WIRING_PENDING으로 적고 전체 이슈는 닫지 않는다. 각 이슈의 과거 closed 상태는 이전 브랜치의 완료 기록이지 현재 복구 브랜치에 동일 코드가 있다는 뜻이 아니다.

0008 원본은 `9cf5cf2913a4b8b182e2bef3e4c2676278a58918`로 고정한다. 후기 `f201118...`에는 0009/0010도 포함되므로 일괄 덮어쓰지 않는다. 기존 repaired async write, 패키지/락파일, 이전 마이그레이션은 보존한다. 변경한 원본 연결부는 해시/테스트를 별도로 기록한다.

실제 네이버 호출·광고 변경·운영 gate 변경·Hostinger 배포·main 변경은 하지 않는다. 테스트 fixture evidence는 실계정 승인 근거가 아니다. 전체 목표는 0019 및 #20–#22의 잔여 범위를 포함하며, 마이그레이션/테스트 숫자로 완료율을 계산하지 않는다.
