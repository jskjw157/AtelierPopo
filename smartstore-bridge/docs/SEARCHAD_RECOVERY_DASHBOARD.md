# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**현재 이슈: [#25](https://github.com/jskjw157/AtelierPopo/issues/25). 상태: EXECUTION_VERIFIED / HTTP_BOOTSTRAP_PENDING. A/B/C 검증 완료, D/E/F 미완료. 이슈는 OPEN이다.**

**다음 작업은 #25-D: 역할·Customer별 HTTP, application bootstrap, readiness, close 연결이다. 이어서 E의 실제 PostgreSQL + 역할 HTTP + 활성화 서비스 + 현재 async executor 통합 검증을 수행한다. 아직 0009로 넘어가지 않는다.**

| 기준 | 값 |
| --- | --- |
| Master roadmap | [#23](https://github.com/jskjw157/AtelierPopo/issues/23) |
| Current issue | [#25](https://github.com/jskjw157/AtelierPopo/issues/25) |
| Draft PR | [#24](https://github.com/jskjw157/AtelierPopo/pull/24), 미병합·미배포 |
| Working branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `0adbd11359440efe43fd07c279bd01a4d8914568` on `codex/searchad-recovery-2026-09-11` |
| 검증 코드/테스트 커밋 | **`317f7d4e129d1f1593cbec184b8968f2e3290df9`** |
| 완료된 GREEN CI | [34664500356](https://github.com/jskjw157/AtelierPopo/actions/runs/34664500356), job `103473573856` |
| 전체 회귀 | **262 passed, 0 failed, 0 skipped** |
| Migration head | `0008`, 이전 스키마 변경 없음 |

이 문서는 GitHub 이슈·PR과 연결한 저장소 Markdown 대시보드다. GitHub Projects 보드를 갱신했다는 뜻은 아니다. 위 SHA는 코드/테스트 검증 기준이며, 이 문서는 후속 문서 변경이다. 문서 포함 후속 HEAD의 CI 결과는 #23과 #24에서 구분해 기록한다.

## 순차 작업판

| 순서 | 범위 | 현재 상태 | 이슈 |
| --- | --- | --- | --- |
| 1 | 0007 Canary core / dedicated Gateway / 역할 HTTP / bootstrap | VERIFIED | #24, 과거 #12–#15 |
| 2A | 0008 activation core / schema / PostgreSQL 서비스 조합 | VERIFIED — `c3397b6` | #25-A/B, 원본 #16 |
| 2B | 0008 현재 async execute / rollback에 활성화 검사 연결 | **VERIFIED — `317f7d4`** | #25-C |
| 2C | 0008 역할·Customer HTTP / bootstrap / readiness / close | **NEXT — PENDING** | #25-D |
| 2D | PG + 역할 HTTP + 실제 activation + async executor 통합, 최종 기록 | PENDING | #25-E/F |
| 3 | 0009 hierarchy / lifecycle | PENDING — #25 완료 이후 | 원본 #17 |
| 4 | 0010 reporting 및 후기 Circuit / automation | PENDING | #18 |
| 5 | Durable worker / scheduler / operation validation, 0019 수준 | PENDING | #19 |
| 6 | Profitability / recommendation / limited Auto | PENDING | #20 |
| 7 | 전체 통합 회귀 / 안전성 / 운영 준비 검증 | PENDING | #21 |
| 8 | PR 통합 / 배포 / 실계정 검증·활성화 | NOT STARTED — 별도 승인 필요 | #22 |

과거 closed 이슈는 이전 브랜치의 완료 기록이며 현재 복구 브랜치의 자동 완료 근거가 아니다. 목표는 0010에서 끝나지 않고 0019 기능 수준과 #20–#22까지다. 테스트 수·마이그레이션 수로 전체 완료율을 추정하지 않는다.

## 이번 C 단계의 실제 변경

`src/naver/searchad/write/execution-service.js`에 서버가 주입하는 activation guard를 연결했다. 기존 비동기 drift 확인이 끝난 뒤, **`approvalService.claim` 직전에 검사를 await**한다. 검사기가 없으면 `SEARCHAD_ACTIVATION_GUARD_NOT_READY`, 반환값이 명시적인 `allowed: true`가 아니면 `SEARCHAD_ACTIVATION_REJECTED`로 차단한다. 실제 guard의 만료·계정 중단·범위·자격증명 오류도 그대로 거부한다.

롤백은 drift 확인 후, 원래 forward 요청이 아니라 **저장된 변경 전 값으로 구성된 rollback descriptor**에 대해 같은 검사를 수행한다. 거부 시 원격 mutation과 상태 변경을 하지 않는다. 읽기 전용 reconcile은 이 mutation 검사를 적용하지 않아 계정 중단 및 write gate OFF 상태에서도 기존 복구 경로를 사용할 수 있다.

검사기에 전달하는 Customer는 저장된 plan의 값이며 descriptor는 분리된 복사본이다. 실행 토큰은 전달하지 않는다. 검사기가 복사본을 변경해도 승인된 실제 mutation 내용이 바뀌지 않는 계약을 검증했다.

`write/runtime-production.js`와 `http/searchad-write-runtime.js`가 이 서버 소유 guard를 전달한다. **HTTP의 lazy factory 전달부만 연결됐으며 application activation 초기화, 역할별 라우트, readiness/close가 완료된 것은 아니다.** app에 guard가 없으면 변경 실행은 차단된다. 이것을 D 완료로 표시하지 않는다.

기존 production/safe executor의 async 잠금·finally 해제·one-time token·drift·unknown outcome·재시도 금지·rollback 재조회 실패 처리와 저장소는 보존했다. 이전 동기식 write 디렉터리를 덮어쓰지 않았다. 패키지/락파일, config flags, 마이그레이션 0001–0008, 원본 activation core 및 0007 연결부는 이번 증분에서 변경하지 않았다.

## 보존 검증 — 변경 범위를 실제 해시로 제한

CI는 종전 **24개 원본 production/schema blob 해시**를 그대로 검사한다. 기준 브랜치 보존 검사에 추가된 production 예외는 아래 세 파일뿐이며, `scripts/searchad-activation-wiring-provenance.mjs`가 문서화된 추가 부분을 메모리에서 제거하면 이전의 정확한 Git blob으로 돌아오는지 확인한다. 이 스크립트는 파일을 쓰거나 패치하지 않는다.

| 경로 — smartstore-bridge/ 기준 | 현재 blob | 복원되는 이전 blob |
| --- | --- | --- |
| `src/naver/searchad/write/execution-service.js` | `3028636ccdf715f58ebc1bbd7e4d9a48b8e228d6` | `ac0afabeacdd3e4c579c10076a1e26b9bd25fe9f` |
| `src/naver/searchad/write/runtime-production.js` | `5f8b5b9e1d7daccff54c2b5240843a8f4be84bde` | `c1953e87bab893dbd9c0aa22efc666a1b0a6beab` |
| `src/http/searchad-write-runtime.js` | `6beba4926c262002a678498e3ebc697e66f275b88` | `43d6df4da02cdc11e7e0b0a254df997fe6c61857` |

기존 테스트 fixture 세 파일도 같은 방식으로 검사한다. `test/searchad-write-execution.test.js`, `test/postgres-searchad-write-runtime.integration.test.js`, `test/helpers/searchad-write-http-fixture.js`에는 명시적으로 표시한 테스트용 authorization만 주입했고 기존 검증 assertion은 변경하지 않았다. 실제 guard의 허용 범위를 fixture에 맞춰 넓히지 않았다. HTTP fixture 설명도 network와 authorization이 모두 test double임을 명시했다.

**원본 해시 일치 자체는 전체 보안성이나 실계정 사용 가능성의 증명이 아니다.** 변경 범위 보존과 실제 동작 테스트를 별도로 수행했다.

## 검증 결과 — 317f7d4 / CI 34664500356

| 검사 | 관측 결과 |
| --- | --- |
| Canary / Gateway / 역할 HTTP 집중 | 51/0/0 |
| Activation core / Customer 경계 집중 | 30/0/0 |
| Write 집중 — 신규 경계 계약 포함 | **49/0/0** |
| 필수 PostgreSQL | **19/0/0** |
| Canary + activation PostgreSQL 반복 | **14/0/0** |
| 전체 회귀 | **262/0/0** |
| 원본·기준 보존 | 24개 원본 해시 + 3개 production/3개 기존 fixture의 증분 복원 해시 모두 통과 |
| 문법·정적 검사 | 통과 |
| 기존 write safety | 통과, write 16파일 검사 범위의 raw network calls 0 |
| 번들 manifest coverage | Commerce 116, SearchAd 126 unique / 117 allowlisted, 내부·폐기 operation runtime 누출 0 |
| Migration 재실행 | 두 번 모두 `0008`, `applied: []` |
| bridge production dependency audit | 보고된 취약점 0 |

표의 수치는 pass/fail/skip이다. 집중·반복 검사는 전체와 중복되어 합산하지 않는다. 이전 244개에서 18개가 증가했다: 신규 PG 파일의 부모 테스트 1개와 하위 9개, 별도 boundary 테스트 8개다. 부모 집계도 포함되므로 18개의 독립 하위 시나리오라고 표현하지 않는다. manifest coverage는 실계정 검증이 아니며 dependency audit는 bridge 범위다. 기존 write scanner를 activation 전체 검사로 확대 해석하지 않는다.

## 새 테스트가 실제로 검증하는 범위

`test/postgres-searchad-activation-write.integration.test.js`는 매 실행마다 UUID 전용 PostgreSQL schema를 만들고 실제 migrations, pinned registry, 자격증명 해석, 서명 클라이언트, Gateway, activation services/guard/account control, PostgreSQL async write runtime, plan/approval/lock 저장소를 함께 사용한다. **네이버 upstream GET/PUT 응답 및 검증용 evidence만 fixture다.** 운영의 gate나 실계정에 접근하지 않는다. 종료 시 해당 테스트가 만든 schema만 정리한다.

검사기 없음, grant 없음, Passive-only grant, 만료, 계정 중단, 자격증명 변경, 필드 범위 불일치에서 승인 토큰 미사용·approved 상태 유지·mutation 0·lock 해제를 확인했다. 중단 해제 후 같은 미사용 토큰으로 한 번만 실행하며, 이후 중단된 계정의 롤백을 차단하고 재개 후 롤백을 허용한다. unknown outcome은 반복 쓰기 없이, 계정 중단/write OFF 상태에서 읽기 전용 reconcile로 확인한다.

`test/searchad-write-activation-boundary.test.js`는 실제 SQLite plan/approval 및 production executor에 명시적 guard/remote test double을 사용한다. 비동기 검사 대기 중 token claim/mutation 정지, 거부 시 토큰 보존, 비허용 반환값 5종 차단, 롤백의 독립적인 재검사, 저장된 Customer와 descriptor 복사본 사용을 확인한다.

기존 generic HTTP 테스트의 authorization은 fixture다. **역할 HTTP → 실제 PG activation → 현재 async executor 전체 요청 검증을 수행한 것으로 주장하지 않는다.** 그것은 D/E의 남은 작업이다. 검증 직후 별도의 동시 suspend가 발생하는 경쟁 상황의 원자적 차단도 이번 테스트 범위의 보장이 아니며 운영 준비 검증에서 별도로 다뤄야 한다.

## 관측된 RED → GREEN

| 커밋 | CI / job | 관측 결과 |
| --- | --- | --- |
| `090948edec4ce910f2ffc10ed44c817ccca6451b` | `34663851291` / `103471686413` | 실제 PG에서 차단돼야 하는 하위 조건 8개가 거부되지 않음. 그룹 집계 19개 중 10 통과/9 실패 — 실패 부모 1개 포함 |
| `0736a3741e30d8b7b8537834406d1a22a1a7de1e` | `34664155009` / `103472566021` | 기존 write 41 통과, 신규 비동기·롤백·반환값·descriptor 경계 8 실패 |
| `317f7d4e129d1f1593cbec184b8968f2e3290df9` | `34664500356` / `103473573856` | 모든 설정된 CI 단계 성공, 전체 **262/0/0** |

## 이전 검증 기록 — 현재 완료 범위와 구분

0008 원본은 #16 최종 `9cf5cf2913a4b8b182e2bef3e4c2676278a58918`이다. 후기 `f201118...`에는 0009/0010이 섞여 있어 일괄 적용하지 않는다.

- [0008 core-only 244/0/0 기록 및 원본 9개 blob 목록](https://github.com/jskjw157/AtelierPopo/blob/eed344c4b1e0af172d547446227f3029d1b7e513/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md): 코드 `c3397b6`, CI `34662636388`; 문서 HEAD `eed344c`, CI `34662941491`. 당시 C 미완료 표시는 이번 기록으로 대체된다.
- [0007 전체 연결 212/0/0 기록](SEARCHAD_RECOVERY_STATUS_20260912.md): 과거 checkpoint로 보존.
- #23의 local-only 0019 checkpoint는 원격 소스의 현재 존재/검증을 보장하지 않는다.

## 다음 작업 — D → E → F

원본 #16의 HTTP/bootstrap 계약과 현재 application을 대조한다. 역할·Customer별 activation/control 라우트 및 OpenAPI를 연결하고, startup 오류 시 차단, readiness, 자원 소유권·close를 검증한다. 기존 async 실행 guard를 우회하거나 테스트 fixture authorization을 production 초기화에 사용하지 않는다.

실제 PostgreSQL + 역할 HTTP + activation services + 현재 executor를 함께 통과하는 테스트에서 허용과 거부, token 보존, Customer 격리, 재시작 및 종료를 확인한다. 전체 회귀 CI의 실제 SHA를 #25/#23/이 대시보드/#24에 동기화하고, D/E/F가 끝난 뒤에만 #25를 닫고 0009로 이동한다.

## 운영 원칙

현재 미완료 단계 하나씩 issue 계약 → 관측 RED → 최소 구현 → GREEN → 정확한 CI SHA 기록 → issue/dashboard/PR 동기화 순서로 진행한다. A/B/C만 통과한 현재는 전체 0008 완료가 아니다.

실제 네이버 호출·광고 변경·운영 gate 변경·production migration·Hostinger 배포·main 변경·병합은 이번 작업에서 수행하지 않았다. 합성 evidence는 운영 승인에 사용할 수 없다.
