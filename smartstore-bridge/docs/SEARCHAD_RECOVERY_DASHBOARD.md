# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**0008의 실제 application → 역할 HTTP → PostgreSQL activation → 현재 async 실행·승인 토큰 → 모의 upstream 변경 경로와 공개 readiness 검증이 완료됐다. 다음 구현 작업은 [#26: 0009 hierarchy/lifecycle 복구](https://github.com/jskjw157/AtelierPopo/issues/26)다. 0009 구현은 아직 시작하지 않았다.**

0008 작업/종료 기록은 [#25](https://github.com/jskjw157/AtelierPopo/issues/25), 전체 로드맵은 [#23](https://github.com/jskjw157/AtelierPopo/issues/23), 작업 PR은 [Draft #24](https://github.com/jskjw157/AtelierPopo/pull/24)다. 문서 게시, Master/PR 동기화, 문서 HEAD CI 확인 후 #25-F를 종료한다. PR 병합이나 실계정 활성화를 뜻하지 않는다.

| 기준 | 값 |
| --- | --- |
| Repository / application | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Working branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568` |
| 검증 코드/테스트 SHA | **`9a0b0c8a20154258b6d71369ae63cd8214cb2e8a`** |
| 완료된 GREEN CI | [34668918645](https://github.com/jskjw157/AtelierPopo/actions/runs/34668918645), job `103486393321`, completed/success |
| 전체 회귀 | **293 passed, 0 failed, 0 skipped** |
| Migration head | **0008**, 이번 증분에서 schema 변경 없음 |
| 다음 단계 | **#26 / 0009 — NOT STARTED** |

이 문서는 저장소 Markdown 대시보드이며 GitHub Projects 보드 갱신을 주장하지 않는다. 위 SHA는 검증된 코드/테스트 기준이다. 이 문서를 포함한 후속 HEAD의 SHA·CI는 #24에 별도로 기록하며, 문서 게시 자체를 CI 성공으로 간주하지 않는다.

## 순차 작업판

| 순서 | 범위 | 현재 복구 상태 | 이슈 |
| --- | --- | --- | --- |
| 1 | 0007 Canary core / dedicated Gateway / 역할 HTTP / bootstrap | VERIFIED, 미병합·미배포 | #24 / 과거 #12–#15 |
| 2A | 0008 activation core / schema / PostgreSQL 서비스 조합 | VERIFIED — `c3397b6` | #25-A/B |
| 2B | 현재 async execute/rollback의 activation guard | VERIFIED — `317f7d4` | #25-C |
| 2C | 역할·Customer HTTP / actual bootstrap / 내부 readiness / close | VERIFIED — `e7c1b6e` | #25-D |
| 2D | 실제 PG activation + 역할 HTTP + async mutation / 공개 readiness | **VERIFIED — `9a0b0c8`** | #25-E; F 기록은 #25/#24 |
| 3 | 0009 hierarchy / lifecycle create·batch·delete | **NEXT — NOT STARTED** | #26 / 원본 #17 |
| 4 | 0010 reporting 및 후기 Circuit/automation | PENDING | #18 |
| 5 | Durable worker/scheduler/operation registry, 0019 기능 수준 | PENDING | #19 |
| 6 | Profitability/recommendation/limited Auto | PENDING | #20 |
| 7 | 전체 회귀·운영 준비·동시성 검증 | PENDING | #21 |
| 8 | PR 통합·배포·실계정 검증/활성화 | NOT STARTED — 별도 승인 필요 | #22 |

0008의 복구 완료는 제품 전체 완료가 아니다. 과거 closed 이슈나 local-only checkpoint는 현재 브랜치의 자동 완료 근거가 아니다. 테스트 수나 migration 수로 전체 완료율을 추정하지 않는다.

## E에서 변경한 production 코드

`src/http/server-v05.js`의 v0.5 공개 `GET /health/ready`가 내부 `api.readiness()`와 같은 판단을 사용한다. 기존 v0.4 및 이전 서버 코드는 변경하지 않았다.

`ready = (base.readyForRead === true) && (!activationRequired || activationReady)`다. SearchAd가 configured이면 activation runtime의 `ready === true`를 요구한다. 문자열 `"true"` 등 truthy 값은 허용하지 않는다. 미설정인 선택적 SearchAd 때문에 기존 일반 읽기 준비 상태를 변경하지 않으며 `base.readyForRead`도 보존한다.

공개 응답에는 기존 service/version/ok/status와 `searchAdActivation: { required, initialized, ready }`의 boolean만 내보낸다. Customer, fingerprint, credential, DB URL, startup 상세 오류를 노출하지 않는다. HTTP 요청 시 upstream probe나 lazy write runtime 생성을 하지 않는다.

**이 readiness는 초기화된 인프라 상태이지 광고계정별 mutation 허가가 아니다. 매 health 요청의 실시간 DB 연결 검사나 credential/live capability 검증도 아니다.** 개별 요청의 role/Customer/activation/token/gate 검사는 기존 실행 경로가 별도로 수행한다.

E의 production 변경은 이 서버 파일 하나다. 기존 async executor, activation guard/services, bootstrap, storage/approval/plan/locks, shutdown 구현은 수정하거나 이전 동기 코드로 교체하지 않았다. 기존 테스트 assertion/fixture도 E에서 변경하지 않았다.

## 실제 전체 경로 테스트 — parent 1 + child 12

`test/postgres-searchad-application-composition.integration.test.js`는 각 하위 테스트마다 UUID 전용 PostgreSQL schema와 실제 migration을 사용한다. 실제 `bootstrapV05`, role HTTP 인증, pinned registry, credentials/signing client, Gateway, CapabilityService, activation service/guard/account control, lazy PostgreSQL write runtime, plan/approval/async executor/locks를 함께 호출한다. 저장소가 실제 `PostgresSearchAdWriteRepository`인지도 검사한다. **허용 guard나 서비스 대역을 주입하지 않는다.**

모의 upstream GET/PUT 응답과 합성 evidence만 CI 입력이다. 일반 grant는 실제 Admin activation HTTP로 생성한다. 만료된 과거 grant의 부정 테스트만 명시적인 historical fixture를 PostgreSQL에 넣는다. 합성 evidence는 실제 계정 검증/승인으로 사용할 수 없다.

전역 fetch는 외부 호출을 금지하고, 캡처한 native fetch는 localhost HTTP 테스트만 호출한다. 주입한 upstream fixture는 고정 origin/Customer별 정확한 campaign path/GET·PUT/서명 헤더를 검사한다. teardown은 해당 테스트가 만든 schema만 제거하고, 앱 소유 pool과 테스트 pool을 구분해 닫는다.

| 하위 시나리오 | 실제 확인한 결과 |
| --- | --- |
| grant 없음 | 일반/generic 실행 모두 거부, token 미사용·approved 유지·mutation 0·lock 해제 |
| Passive-only grant | 정상 mutation 허가로 승격하지 않음; 동일 보존 검사 |
| 만료된 historical grant | 허가 없음으로 거부; 동일 보존 검사 |
| field scope 불일치 | budget 범위 없는 grant는 거부; 동일 보존 검사 |
| 실제 앱 재시작 후 credential rotation | 이전 grant의 context mismatch로 거부; 같은 미사용 token 보존 |
| role 및 Customer 격리 | Reader/Operator/공통 key의 무권한 동작 차단; foreign/missing plan은 동일 404; 목록/evidence는 허용 계정만; actor는 인증 principal 사용 |
| suspend → 재시작 → resume → 단일 실행/rollback | 중단과 evidence가 PG에 남음; 같은 미사용 token으로 generic 실행 1회; 재사용 차단; rollback도 중단 검사, 재개 후 before budget 복구 |
| unknown outcome → 재시작·writes OFF·suspend → reconcile | 모의 PUT 1회 후 연결 오류; 쓰기 재전송 없이 read-only HTTP reconcile로 applied 확인 |
| drift | 계획 이후 원격 값 변경 시 409, 미사용 token·mutation 0·lock 해제 |
| 정상 0008 bootstrap public readiness | 공개 200 및 boolean 상태, 비밀 정보·upstream 호출·writer 초기화 없음 |
| DATABASE_URL 부재 | 공개 503, 실제 upstream 호출 없음 |
| 불완전 schema | 공개 503, 자동 migration 없음, 해당 schema의 table 수 0 유지 |

별도의 `test/searchad-http-readiness.test.js` 5개는 실제 HTTP fixture와 명시적 runtime-status 대역으로 missing/false/non-boolean/true/선택적 미설정 조건을 확인한다. 공개/내부 판단 일치, 기본 읽기 readiness 보존, 비밀정보 비노출, no upstream/no lazy initialization을 검사한다. 이것을 실제 PG 테스트의 대체물로 설명하지 않는다.

## Fresh CI — 9a0b0c8 / 34668918645

| 검사 | pass/fail/skip 또는 관측 결과 |
| --- | --- |
| Canary/Gateway/Canary 역할 HTTP | 51/0/0 |
| Activation core/Customer | 30/0/0 |
| Write 집중 | 49/0/0 |
| 역할 HTTP + readiness + lifecycle | **14/0/0** |
| 필수 PostgreSQL | **36/0/0** |
| 반복 Canary/activation/full application PG | **31/0/0** |
| 전체 회귀 | **293/0/0** |
| 원본·연결부·보호 기준 | historical 24 + integration 5 + reverse-edit 7 파일 모두 통과 |
| 문법/정적 검사 | 통과 |
| 기존 write safety | source 16파일, raw network calls 0 |
| 번들 coverage | Commerce 116; SearchAd 126 unique/117 allowlisted, 내부·폐기 runtime 누출 0 |
| Migration 재실행 | 2회 모두 currentVersion 0008, applied: [] |
| bridge production dependency audit | 보고된 취약점 0 |

전체 job 로그를 확인했다. 집중/반복 수치는 전체와 중복되어 합산하지 않는다. D의 275→293 증가는 readiness 5 + PG parent 1/child 12, 총 18 counted tests이며 독립 leaf는 17개다. 안전성 scanner는 기존 write 16파일 범위이고 전체 HTTP/activation 보안 감사가 아니다. 의존성 감사는 bridge 범위이며 root가 아니다. Manifest coverage는 live API 검증이 아니다. 실행 환경의 SQLite experimental/Actions Node 경고는 존재하며 warning-free라고 주장하지 않는다.

## 관측 RED → GREEN

| 커밋 | CI / job | 관측 |
| --- | --- | --- |
| `847eea325a074f4d94f784a5a45b8387b7ddb7e2` | 34668585706 / 103485440483 | 기존 275 통과, 새 readiness 5 실패, skip 0 |
| `b940e20a747850152a52bf535667b07d9ca74f50` | 34668687442 / 103485743926 | 새 PG 조합의 비-readiness 9개 통과. 공개 readiness 3개 실패; 전체 PG 32 통과/4 실패(부모 포함) |
| **`9a0b0c8a20154258b6d71369ae63cd8214cb2e8a`** | **34668918645 / 103486393321** | **모든 설정된 단계 성공, full 293/0/0** |

현재 DB/role/async 조합은 readiness 수정 전에도 비-readiness 9개 시나리오를 통과했다. E의 production 수정으로 공개 상태의 누락을 해결했으며, 통과를 위해 guard를 허용 대역으로 바꾸거나 기존 assertion을 제거하지 않았다.

## 변경 범위와 provenance

D 문서 HEAD `a517ebec085385e4df5a9608e7af7d7553844672` 대비 코드 HEAD `9a0b0c8...`는 server-v05, workflow, 새 테스트 2개만 변경했다. Packages/lockfiles, config gates, migrations 0001–0008, 원본 activation core 및 write 디렉터리는 E에서 변경 없음이다. CI는 기존 해시/보호 기준 검사를 보존하고 readiness 집중검사와 full application PG 반복검사를 추가했다.

| integration source — smartstore-bridge/ 기준 | 현재 Git blob |
| --- | --- |
| `src/http/searchad-write-access.js` | `22392a6b69b9ed782b05be9d31405dc86e10e49c` |
| `src/http/routes-searchad-write-v3.js` | `7df625756c97f74bc60aa3ab1fcbde0c2e2b328c` |
| `src/http/routes-searchad.js` | `9e50822145ae90f0b24ab557a570db9be03d5b6c` |
| `src/bootstrap-v05.js` | `e2353c67f41489d2583750afdeee7c67d8df1719` |
| `src/http/server-v05.js` | **`1b565834531a7df7abd803ec29fb3ec7a4845674`** |

서버의 이전 D blob은 `aee8e75d395d00eb17f6eac0b77a4d60f51d12f1`이다. 위 5개는 historical original이 아닌 명시적인 integration blob이다. Historical 24개와 C의 production 3/기존 fixture 4를 검사하는 reverse-edit 7개는 그대로 통과했다. Reverse-edit script는 source를 쓰지 않는다. 해시 일치만으로 전체 보안성이나 실계정 사용 가능성을 보장하지 않는다.

## 이력 — 고정된 이전 기록

[D / 275-test 및 기존 source hash·test 수정 이력](https://github.com/jskjw157/AtelierPopo/blob/a517ebec085385e4df5a9608e7af7d7553844672/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [C / 262-test](https://github.com/jskjw157/AtelierPopo/blob/cee1af6062658cb16b2931f1e64eac90b5053a93/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [A/B / 244-test](https://github.com/jskjw157/AtelierPopo/blob/eed344c4b1e0af172d547446227f3029d1b7e513/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [0007 이력](SEARCHAD_RECOVERY_STATUS_20260912.md)을 보존한다. 이력 문서의 이전 재개 위치는 현재 지시가 아니다.

0008 원본 #16은 `9cf5cf2913a4b8b182e2bef3e4c2676278a58918`; 0009 원본 #17의 기록은 `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`다. 후기 `f201118...`의 0009/0010 혼합 소스를 일괄 적용하지 않는다. 과거 local-only `a647bca...`의 0019 수준 기능은 아직 현재 원격 복구 완료 근거가 아니다.

## 남은 제한과 다음 작업

#26-A에서 원본 #17 source/schema/test의 실제 diff와 현재 async 기반을 대조한다. 이어 hierarchy/lifecycle/ownership/risk/role HTTP/PG 검증을 순서대로 복구한다. 현재 migration은 여전히 0008이다.

별도의 동시 suspend가 guard 검사 직후 도착할 때 mutation을 원자적으로 차단하는지는 이번 순차 중단·재시작 테스트로 보장하지 않는다. #21 운영 준비에서 별도 검증한다. 준비 상태 응답은 초기화 상태이며 요청별 live DB probe가 아니다. 독립 reviewer의 승인을 받은 것으로 주장하지 않으며, PR 통합 전 별도 리뷰와 전체 운영 준비 검증이 필요하다.

**실제 Naver 요청·광고 변경·운영 gate 변경·production migration·Hostinger 배포·main 변경·PR 병합을 수행하지 않았다.** 합성 evidence를 운영으로 이전하지 않는다. Public readiness 200이나 CI GREEN은 실제 광고 변경 승인이 아니다.
