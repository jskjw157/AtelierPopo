# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**현재 이슈 [#25](https://github.com/jskjw157/AtelierPopo/issues/25): HTTP_BOOTSTRAP_VERIFIED / COMPOSITION_PENDING. A/B/C/D의 아래 명시된 범위 검증 완료, E/F 미완료. 이슈는 OPEN이다.**

**다음은 #25-E: application bootstrap → 역할 HTTP → PostgreSQL activation guard → 현재 async write/승인 토큰 → 모의 upstream 변경을 한 요청 경로로 조합해 검증한다. 공개 readiness 응답의 활성화 상태 반영도 확인·연결한다. 아직 0009로 넘어가지 않는다.**

| 기준 | 값 |
| --- | --- |
| Master roadmap | [#23](https://github.com/jskjw157/AtelierPopo/issues/23) |
| Current issue | [#25](https://github.com/jskjw157/AtelierPopo/issues/25) |
| Draft PR | [#24](https://github.com/jskjw157/AtelierPopo/pull/24), 미병합·미배포 |
| Working branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `0adbd11359440efe43fd07c279bd01a4d8914568` on `codex/searchad-recovery-2026-09-11` |
| 검증 코드/테스트 SHA | **`e7c1b6e42235a0de3e7311f5323176033f54af9b`** |
| 완료된 GREEN CI | [34667873612](https://github.com/jskjw157/AtelierPopo/actions/runs/34667873612), job `103483363436`, completed/success; 전체 로그 확인 |
| 전체 회귀 | **275 passed, 0 failed, 0 skipped** |
| Migration head | `0008`, 기존 스키마 변경 없음 |

이것은 저장소 Markdown 대시보드이며 GitHub Projects 보드가 아니다. 위 SHA는 코드/테스트 검증 기준이다. 이 후속 문서 변경을 포함한 HEAD의 CI는 PR #24에서 별도로 추적한다.

## 순차 작업판

| 순서 | 범위 | 현재 상태 | 이슈 |
| --- | --- | --- | --- |
| 1 | 0007 Canary core / dedicated Gateway / 역할 HTTP / bootstrap | VERIFIED | #24, 과거 #12–#15 |
| 2A | 0008 activation core / schema / PostgreSQL 서비스 조합 | VERIFIED — `c3397b6` | #25-A/B, 원본 #16 |
| 2B | 현재 async execute/rollback의 토큰 소비 전 activation 검사 | VERIFIED — `317f7d4` | #25-C |
| 2C | 역할·Customer HTTP / 실제 bootstrap / 내부 readiness / close | **VERIFIED — `e7c1b6e`, 아래 경계 참조** | #25-D |
| 2D | 역할 HTTP + 실제 PG activation + 현재 async mutation 통합 / 공개 readiness / 최종 기록 | **NEXT — PENDING** | #25-E/F |
| 3 | 0009 hierarchy / lifecycle | PENDING — #25 완료 후 | 원본 #17 |
| 4 | 0010 reporting 및 후기 Circuit / automation | PENDING | #18 |
| 5 | Durable worker / scheduler / operation validation, 0019 기능 수준 | PENDING | #19 |
| 6 | Profitability / recommendation / limited Auto | PENDING | #20 |
| 7 | 전체 통합 회귀 / 안전성 / 운영 준비 검증 | PENDING | #21 |
| 8 | PR 통합 / 배포 / 실계정 검증·활성화 | NOT STARTED — 별도 승인 필요 | #22 |

과거 closed 이슈는 이전 브랜치의 기록이며 현재 복구 완료 근거가 아니다. 목표는 0019 기능 수준과 #20–#22까지다. 테스트·마이그레이션 수로 전체 완료율을 계산하지 않는다.

## #25-D — 구현 및 검증 범위

### 역할·Customer HTTP

Reader는 조회, Operator는 계획 작성, Executor는 승인·실행·reconcile·rollback, Admin은 활성화·계정 중단/재개를 담당한다. 원본 activation routes와 역할별 OpenAPI를 복구해 실제 서버에 등록했다. 공통 HAAR API 키와 SearchAd 역할 키는 서로 대체할 수 없다.

계획 조회·승인·실행 전에 저장된 Customer 소유권을 `await`로 확인한다. 다른 계정의 계획과 없는 계획은 같은 404를 반환한다. 목록은 허용 Customer별 조회 후 합치며 외부 Customer 필터는 거부한다. 작성자와 승인자는 본문 이름이 아니라 인증된 principal에서 파생한다. 일반 operation 주소의 mutation도 Executor·계정 범위·승인된 계획·기존 HTTP gate를 거쳐 같은 async executor를 사용한다.

과거 동기식 HTTP 코드를 그대로 덮어쓰지 않고 조회·목록·승인 결과를 기다리도록 연결했다. 현재 repaired async execution/approval/repository/lock/drift/reconcile/no-blind-retry 코드는 D에서 변경하지 않았다.

### Application / readiness / shutdown

`bootstrapV05`가 실제로 생성한 `searchAdCapabilityService`를 activation bootstrap에 전달한다. DATABASE_URL 또는 0008 schema가 없으면 관련 HTTP는 503을 반환한다. 자동 마이그레이션은 하지 않는다.

**검증된 readiness는 내부 `api.readiness()`의 activation 상태와 activation HTTP의 fail-closed 응답이다. 공개 `/health/ready`는 기존 `readinessV04` 경로를 유지한다. 공개 health에 activation 상태가 반영됐다고 주장하지 않으며 E에서 확인·연결한다.**

종료는 진행 중인 HTTP 요청과 큐 작업을 기다린 뒤 write/Canary/activation 런타임과 ledger를 닫는다. 동시·반복 close는 같은 Promise를 공유한다. 큐 drain 미완료 시 `HTTP_SHUTDOWN_PENDING`으로 실패하고 DB 자원을 보존해 재시도한다. 실제 activation 소유 PG pool 종료와 별도 PG 연결의 생존을 검증했다.

## Fresh CI — e7c1b6e

| 검사 | pass / fail / skip |
| --- | --- |
| Canary/Gateway/Canary 역할 HTTP | 51 / 0 / 0 |
| Activation core/Customer | 30 / 0 / 0 |
| Write 집중 | 49 / 0 / 0 |
| 신규 역할 HTTP / runtime lifecycle | **9 / 0 / 0** |
| 필수 PostgreSQL 통합 | **23 / 0 / 0** |
| Canary + activation + application PG 반복 | **18 / 0 / 0** |
| 전체 회귀 | **275 / 0 / 0** |

원본·연결부 해시/보호 기준, 문법·정적 검사, 기존 write safety, 번들 manifest coverage, migration 재실행, bridge production dependency audit 모두 성공했다. Migration 재실행 두 번 모두 `currentVersion: 0008`, `applied: []`; 보고된 의존성 취약점은 0이다.

집중·반복 검사는 전체와 중복된다. 이전 262에서 13 증가: HTTP 6 + lifecycle 3 + PG 부모 1과 하위 3이다. 13개의 독립 leaf 시나리오라는 뜻이 아니다. Write scanner는 기존 16개 write source 범위에서 raw network call 0을 확인하며 HTTP/activation 전체 감사가 아니다. 의존성 감사도 bridge 범위이며 root가 아니다. Commerce 116, SearchAd 126 unique/117 allowlisted/내부·폐기 operation runtime 누출 0은 번들 분류 검증이지 live API 검증이 아니다.

## 테스트 경계 — E를 완료로 오인하지 말 것

`searchad-http-activation-recovery.test.js` 6개: 실제 HTTP와 현재 SQLite write 서비스를 사용한다. Activation control 서비스·허용 guard·upstream 응답은 명시적인 fixture다. 역할·계정 격리, actor, 민감정보 제외, OpenAPI, 정상 경로의 1회 mutation을 검사한다. 실제 PG activation을 통한 일반 변경 테스트가 아니다.

`searchad-http-runtime-lifecycle.test.js` 3개: HTTP가 지연된 소유권 조회/목록/상세/승인을 기다리는지, drain timeout 때 자원을 보존하는지, 진행 중 HTTP 실행이 끝나기 전 activation을 닫지 않는지 검사한다. 지연은 HTTP-facing 계약에만 넣고 SQLite 내부 동기 계약은 유지한다. 이를 PostgreSQL 테스트라고 부르지 않는다.

`postgres-searchad-application-bootstrap.integration.test.js`: UUID별 실제 PG schema와 실제 bootstrapV05/자격증명 해석/서명 client/Gateway/capability/activation/control HTTP를 사용한다. 모든 upstream fetch를 금지하고 localhost HTTP만 별도 native fetch로 호출한다. 완성 schema의 준비 상태·Reader 조회·Admin DB 중단·owned pool 종료, DB 부재, 불완전 schema 차단과 자동 migration 부재를 검증한다. **Upstream 요청 0이며 일반 광고 mutation을 수행하지 않는다.**

기존 C의 실제 PG activation → async executor 테스트도 계속 통과한다. 그 테스트의 upstream 응답과 검증 evidence는 fixture다. C와 D를 각각 통과했다고 전체 역할 HTTP → PG activation → 일반 mutation 통합 E를 통과한 것으로 처리하지 않는다. 합성 evidence는 CI 전용이며 운영에 사용할 수 없다.

## 보존과 provenance

0007 원본 `29fa2214ba8cd62edb0ba92d23c1b3d1a1303ef6`, 0008 원본 `9cf5cf2913a4b8b182e2bef3e4c2676278a58918`을 기준으로 한다. 후기 `f201118...`에는 0009/0010까지 있어 통째로 적용하지 않는다.

CI의 **24 historical blob**은 이전 24개 중 수정된 bootstrap/server 2개를 제외하고 정확히 복구한 activation HTTP/OpenAPI 2개를 더한 것이다. 새 연결부 해시를 원본 해시라고 부르지 않는다. 패키지/락파일, config gates, migrations 0001–0008, repaired async write, activation core는 D에서 변경하지 않았다.

### D 연결부 — 원본 복구와 구분한 5개 고정 해시

Paths relative to `smartstore-bridge/`:

| Path | D integration blob SHA |
| --- | --- |
| `src/http/searchad-write-access.js` | `22392a6b69b9ed782b05be9d31405dc86e10e49c` |
| `src/http/routes-searchad-write-v3.js` | `7df625756c97f74bc60aa3ab1fcbde0c2e2b328c` |
| `src/http/routes-searchad.js` | `9e50822145ae90f0b24ab557a570db9be03d5b6c` |
| `src/bootstrap-v05.js` | `e2353c67f41489d2583750afdeee7c67d8df1719` |
| `src/http/server-v05.js` | `aee8e75d395d00eb17f6eac0b77a4d60f51d12f1` |

정확한 원본 activation HTTP blob: `routes-searchad-activation.js` = `64a98587ad8fedd78bf91d03ca702eeee02e356c`; `openapi-searchad-activation.js` = `3897f4dddf5de8539b7bd42897b1911eee5a4c7d`.

`searchad-activation-wiring-provenance.mjs`는 문서화된 추가를 메모리에서 제거해 이전 blob으로 돌아가는지 확인한다. 7파일(C production 3 + 기존 test fixture 4), sourceWrites 0이다. Canary key-separation 테스트의 별도 수정은 이 7개 검사에 포함되지 않는다. 그 테스트는 역방향 거부 대상만 실제 공통 `/api/v1/status`로 옮기고 양쪽 401 assertion을 유지했다.

## 관측 RED → GREEN

| Commit | CI run / job | 관측 결과 |
| --- | --- | --- |
| `917f551f9373e41c19dc5fc0920c265dad0b6bf4` | `34666330285` / `103478835201` | 기존 262 통과, 새 HTTP/bootstrap 6 실패 |
| `f563c3875ace167b90736c6c72cc27565573685f` | `34667230171` / `103481497917` | 기존 PG 19 통과, application activation 부재로 부모 포함 4 실패 |
| `cd67c12fb1ed56978c06a2fb34f4b2ccb283d7fa` | `34667580798` / `103482532624` | Canary 50/1: 이전 테스트가 역할화된 SearchAd status를 공통 API로 취급 |
| `2e37d6f8afee55127cbe0cd3871b5120d4342e78` | `34667690518` / `103482851755` | 신규 HTTP/lifecycle 8/1: 지연 fixture가 SQLite 내부 동기 계약을 깨뜨림 |
| **`e7c1b6e42235a0de3e7311f5323176033f54af9b`** | **`34667873612` / `103483363436`** | fixture를 HTTP 경계로 수정; 모든 검사 성공, 전체 **275/0/0** |

첫 테스트 수정은 인증 정책에 따른 대상 변경, 두 번째는 부정확한 double 수정이다. Production 검증을 끄거나 기존 assertion을 제거하지 않았다.

이전 기록: [C / 262-test dashboard](https://github.com/jskjw157/AtelierPopo/blob/cee1af6062658cb16b2931f1e64eac90b5053a93/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [A/B / 244-test dashboard](https://github.com/jskjw157/AtelierPopo/blob/eed344c4b1e0af172d547446227f3029d1b7e513/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [0007 historical handoff](SEARCHAD_RECOVERY_STATUS_20260912.md). 현재 재개 위치가 아니라 과거 이력 참조용이다. 현재 원본·연결부 판정은 검증 SHA의 CI와 실제 파일 해시를 우선한다.

## Next — #25-E, then F

E는 하나의 application/역할 HTTP 경로에 실제 PG activation/현재 async write runtime을 조합한다. 허용 guard fixture 없이 grant 부재·Passive-only·만료·중단·범위 불일치가 token claim과 mutation 전에 차단되는지 검사한다. 정상 실행의 토큰 1회성, rollback/reconcile/계정 격리/재구성도 실제 경로에서 검증한다. 공개 `/health/ready`의 activation 상태 표면은 연결·검증 대상으로 남긴다.

검사 직후 동시 suspend와 mutation 간 원자적 차단은 C/D가 보장한 사항이 아니다. 운영 준비의 별도 경쟁 조건 검증 항목으로 유지한다. E와 최종 CI·기록 동기화 F가 완료된 뒤에만 #25를 닫고 0009로 진행한다.

실제 Naver 요청·광고 변경·운영 gate 변경·production migration·Hostinger 배포·main 변경·PR 병합은 수행하지 않았다. 구현 복구, CI fixture 검증, 실계정 활성화는 서로 다른 상태다.
