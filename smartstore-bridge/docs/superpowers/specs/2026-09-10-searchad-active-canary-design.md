# SearchAd Active Canary continuation design — 2026-09-10

## 1. 목적

이 문서는 `jskjw157/AtelierPopo`의 SearchAd 통합을 PR #11 head `56abf47c1eeb8124fa9fb8f4f60b81e36376c109` 이후에서 이어가기 위한 설계다.

목표는 두 가지다.

1. 2026-09-06 로컬 검증본에서 완료된 역할·Customer 격리·불변 capability evidence·승격 검증 계층을 원격 브랜치에 복구한다.
2. 기존 `HAAR_REAL_ACCOUNT_ACTIVATION_RUNBOOK.md`의 Gate E를 실제로 수행할 수 있는 Active Canary 실행기를 추가한다.

최종 정책은 바꾸지 않는다. 공식 SearchAd 조회·쓰기·생성·수정·배치·원격 삭제 처리·롤백·자동화를 구현 대상으로 유지하고, 실계정 Capability 및 Canary 검증을 통과한 operation/customer 범위만 단계적으로 활성화한다.

## 2. 현재 기준선

### 원격 기준

- PR #11: open / unmerged
- head: `56abf47c1eeb8124fa9fb8f4f60b81e36376c109`
- branch: `codex/searchad-write-execution-v0.7.0`
- 기존 구현: change plan, one-time approval token, drift check, exactly-once mutation attempt, remote verify, reconcile, conditional rollback, write gate, redaction, HTTP/OpenAPI, SQLite runtime ledger, PostgreSQL schema

### 2026-09-06 로컬 검증 기준

로컬 인수인계 결과에서 다음이 검증되었다.

- Reader / Operator / Executor / Admin 역할 키
- 역할별 Customer allowlist
- cross-customer plan/read/approve/execute/generic call 차단
- 접근 불가 plan의 404 projection
- Passive Probe customer override 선차단
- 실제 probe 결과 기반 immutable verification evidence 저장
- Admin이 저장된 evidence ID를 참조해 operation 범위를 승격
- account/spec/credential/upstream/operation/field scope 재검증
- client-supplied `passed: true` 비신뢰
- persistent account suspend/resume
- suspended account에서도 read-only reconcile 허용
- migration `0008`
- 역할별 OpenAPI 4종
- Node 22.16.0 / PostgreSQL 16.15 기준 전체 회귀 247 pass / 0 fail / 0 skip

이 로컬 강화본은 아직 GitHub에 반영되지 않았다. Active Canary 자체도 아직 없으며, 테스트의 canary receipt는 fixture다.

## 3. 범위

### 이번 구현에 포함

- 9/6 access-activation hardening 복구
- Active Canary state machine
- Canary 전용 PostgreSQL persistence
- Admin-scoped canary start / status / reconcile / cleanup API
- returned remote ID 기반 object tracking
- canary용 mutation safety envelope
- zero-spend verification gate
- cleanup completion gate
- per-customer concurrency lock
- unknown outcome handling
- immutable canary evidence 생성
- canary evidence를 operation/customer 승격에 연결
- CI fixture 기반 회귀·PostgreSQL 통합 테스트

### 이번 구현에 포함하지 않음

- CI에서 실제 네이버 SearchAd 호출
- 실제 광고계정에 대한 Canary 실행
- 운영 `allowWrites=true` 변경
- main merge 또는 production deploy
- 자동화 `auto` 승격
- 모든 광고상품 validator의 완성
- 모든 create/batch/delete/report automation의 완성

실계정 실행은 코드·CI 검증 이후 별도 운영 단계에서 수행한다.

## 4. 핵심 안전 불변식

Active Canary는 일반 mutation gateway의 우회로가 아니다.

1. Canary는 반드시 Admin principal과 허용된 Customer에서 시작한다.
2. 시작 전 해당 Customer의 유효한 Passive Capability evidence가 있어야 한다.
3. `ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=false`가 기본값이다.
4. `activationMode=canary`가 아니면 실제 Canary mutation을 시작하지 않는다.
5. 생성 객체는 가능한 한 최초 상태를 OFF로 만들고, OFF를 원격 재조회로 확인한다.
6. 이름 검색으로 객체를 찾거나 정리하지 않는다. 생성 응답에서 받은 remote ID만 사용한다.
7. mutation은 단계별 정확히 한 번만 전송한다. timeout/502/503/504 등 결과 불명 상태에서 같은 mutation을 재전송하지 않는다.
8. `unknown_outcome`이면 다음 mutation으로 진행하지 않고 read-only reconcile로 전환한다.
9. cleanup도 같은 규칙을 적용한다. cleanup 결과가 불명하면 반복 delete/update를 보내지 않는다.
10. 실제 spend가 0원이 아니면 Canary는 PASS가 될 수 없다.
11. cleanup 정책이 완료되지 않으면 Canary는 PASS가 될 수 없다.
12. 성공한 Canary evidence는 customer/spec/credential fingerprint/upstream/operation scope와 결합된 immutable record로 저장한다.
13. Canary evidence가 있다고 해서 다른 Customer, 다른 credential, 다른 spec, 다른 operation으로 승격하지 않는다.
14. client가 `passed`, remote ID, spend, cleanup 완료를 임의 선언하는 입력은 신뢰하지 않는다.
15. secret, token, raw signature, raw credential은 persistence/error/audit에 저장하지 않는다.

## 5. 아키텍처

### 5.1 AccessPolicy / Principal layer

2026-09-06 로컬 강화본의 역할 모델을 복구한다.

- Reader: 허용 Customer의 status/evidence/canary result 조회
- Operator: plan 생성 등 비실행 운영 작업
- Executor: 승인된 일반 change execute/reconcile/rollback
- Admin: capability evidence 승격, account suspend/resume, Active Canary start/reconcile/cleanup

Canary mutation은 최초 구현에서 Admin 전용으로 고정한다. 일반 Executor에게 Canary 시작 권한을 주지 않는다.

### 5.2 VerificationEvidenceRepository

Passive Probe 및 Canary 결과를 immutable evidence로 저장한다.

필수 결합 필드:

- `evidence_id`
- `evidence_type` (`passive_capability`, `active_canary`)
- `customer_id`
- `spec_sha`
- `credential_fingerprint`
- `upstream_base_url`
- `operation_keys`
- `field_scope`
- `result`
- `source_run_id`
- `created_at`
- `expires_at`
- `content_hash`

승격 서비스는 evidence ID만 입력받고 저장된 record를 재검증한다.

### 5.3 ActiveCanaryService

Canary의 모든 단계 전이를 한 서비스가 소유한다. HTTP route가 raw operation/body를 직접 선택하지 않는다.

서비스 책임:

- preflight
- run 생성
- per-customer lock
- allowed operation step 선택
- mutation 전송
- 원격 read-back 검증
- unknown outcome 전환
- cleanup
- spend 검증
- 최종 evidence 발급

### 5.4 CanaryRemoteAdapter

기존 SearchAd gateway의 `operationKey, input` 계약만 사용한다.

- raw URL 금지
- manifest의 sideEffect 분류 강제
- read operation과 mutation operation 분리
- request ID 보존
- nested secret redaction
- mutation 자동 retry 금지

CanaryRemoteAdapter는 일반 gateway의 새로운 bypass API를 만들지 않는다. 기존 안전 adapter 위에 canary 전용 step validation을 추가한다.

### 5.5 CanaryRepository

PostgreSQL을 권위 저장소로 사용한다. Active Canary는 운영 안전 판단에 쓰이므로 새 Canary 상태를 SQLite-only runtime으로 두지 않는다.

테이블:

#### `searchad_canary_runs`

- `canary_run_id` PK
- `customer_id`
- `status`
- `started_by_principal_id`
- `spec_sha`
- `credential_fingerprint`
- `upstream_base_url`
- `passive_evidence_id`
- `verified_operation_scope_json`
- `started_at`
- `expires_at`
- `completed_at`
- `last_error_json`
- `result_hash`

#### `searchad_canary_objects`

- `canary_run_id`
- `object_type`
- `remote_id`
- `create_operation_key`
- `read_operation_key`
- `cleanup_operation_key`
- `initial_remote_hash`
- `latest_remote_hash`
- `cleanup_status`
- `created_at`
- `cleaned_at`

remote object의 이름은 보조 audit metadata일 뿐 lookup key가 아니다.

#### `searchad_canary_events`

append-only event log:

- `event_id`
- `canary_run_id`
- `sequence_no`
- `phase`
- `operation_key`
- `status`
- `request_id`
- `remote_hash`
- `sanitized_error_json`
- `created_at`

## 6. Canary 상태 머신

정상 흐름:

```text
created
→ preflight_verified
→ campaign_create_sent
→ campaign_verified_off
→ mutation_test_sent
→ mutation_verified
→ rollback_verified
→ cleanup_pending
→ cleanup_verified
→ spend_check_pending
→ spend_verified_zero
→ passed
```

차단/실패 상태:

```text
blocked
failed
unknown_outcome
cleanup_required
cleanup_unknown_outcome
spend_detected
expired
```

`unknown_outcome`, `cleanup_unknown_outcome`, `spend_detected`는 자동으로 `passed`로 전환하지 않는다.

`passed`는 그 run의 `verified_operation_scope_json`에 적힌 operation/field scope만 통과했다는 뜻이다. campaign-only Canary PASS를 Gate E 전체 완료나 create/batch/delete 전체 승인으로 해석하지 않는다.

## 7. Canary 단계

### Phase A — Preflight

다음을 모두 확인한다.

- principal role = Admin
- Customer allowlist match
- account not suspended
- write subsystem enabled
- `allowActiveCanary=true`
- `activationMode=canary`
- valid passive capability evidence
- spec/credential/upstream fingerprint match
- required operation keys are public/verified/capability-approved
- no active canary for same Customer
- configured safety limits valid

### Phase B — Create isolated campaign

첫 번째 필수 Canary object는 전용 campaign이다.

- 생성 시 가능한 공식 필드로 OFF 상태 보장
- 안전 상한 이내의 최소 운영값 사용
- 생성 응답의 remote ID 즉시 저장
- remote ID로 단건 read-back
- OFF 상태 및 주요 field hash 검증

공식 API/계정 조건상 생성 즉시 OFF를 보장할 수 없다면 해당 create operation은 Canary 대상으로 실행하지 않는다. create 후 즉시 OFF로 바꾸면 된다는 이유로 짧은 노출 가능성을 허용하지 않는다.

### Phase C — Controlled mutation round trip

초기 runner의 campaign mutation 검증은 노출 가능한 하위 객체가 없는 상태에서만 수행한다.

- campaign에 deliverable adgroup/ad/keyword가 없는 동안에만 campaign ON/OFF round trip을 허용한다.
- 하위 객체를 만든 이후에는 campaign을 계속 OFF로 유지한다.
- 일예산 또는 입찰 필드는 해당 object/광고상품 validator가 준비된 경우에만 검증한다.
- before hash → approved patch → mutate once → read-back → applied hash → rollback once → read-back 순서를 유지한다.

광고그룹·키워드·소재 create는 각 validator가 준비될 때 step registry에 추가한다. 그때도 상위 campaign은 OFF여야 한다. 이 확장이 끝나기 전에는 해당 operation을 전체 운영 create allowlist로 승격하지 않는다.

### Phase D — Cleanup

- 이름 검색 금지
- 저장된 remote ID만 사용
- 공식 delete 처리 operation이 검증된 object는 그 operation 사용
- delete가 공개 API에서 지원되지 않거나 해당 광고상품에서 금지된 경우, verified OFF 상태와 retention reason을 기록한 `off_preserved` terminal cleanup을 허용할 수 있다.
- `off_preserved`는 delete operation 검증으로 간주하지 않으며 delete capability 승격에 사용하지 않는다.
- cleanup 후 read-back 또는 공식 상태 조회로 결과를 검증한다.

Canary PASS에 허용되는 cleanup terminal state는 `deleted_verified` 또는 정책상 명시적으로 허용된 `off_preserved_verified`다. 그 외 remote object가 남으면 `cleanup_required`다.

### Phase E — Zero-spend verification

Canary 시작 직전과 cleanup 직후의 공식 비용/통계 조회를 사용한다.

PASS 조건:

```text
verified spend delta == 0
```

보고서 지연 때문에 즉시 확정할 수 없으면 `spend_check_pending`으로 남긴다. 지연된 보고서를 0원으로 추정하지 않는다. 안정화 정책에 따라 다시 조회한 공식 데이터가 0을 확인한 뒤에만 `spend_verified_zero`로 전환한다.

## 8. 안전 한도

새 환경변수는 기본적으로 보수적 OFF 상태를 만든다.

```dotenv
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=false
ATELIER_SEARCHAD_CANARY_MAX_CONCURRENT_PER_CUSTOMER=1
ATELIER_SEARCHAD_CANARY_MAX_OBJECTS=4
ATELIER_SEARCHAD_CANARY_MAX_MUTATIONS=12
ATELIER_SEARCHAD_CANARY_TTL_SECONDS=3600
ATELIER_SEARCHAD_CANARY_MAX_SPEND_KRW=0
```

예산·입찰 값의 절대 숫자는 이 설계에서 임의로 고정하지 않는다. 공식 API validator와 실제 광고상품 최소값을 만족하면서 운영자가 설정한 별도 상한 이하인 경우에만 실행한다.

예산·입찰 상한이 미설정이거나 공식 최소값과 모순되면 fail-open하지 않고 해당 step을 preflight에서 차단한다.

## 9. HTTP API

### 조회

```http
GET /api/v1/searchad/canary/runs
GET /api/v1/searchad/canary/runs/{canaryRunId}
```

Reader 이상 + Customer allowlist.

### 실행

```http
POST /api/v1/searchad/canary/runs
POST /api/v1/searchad/canary/runs/{canaryRunId}/reconcile
POST /api/v1/searchad/canary/runs/{canaryRunId}/cleanup
```

Admin only.

Start payload는 최소 식별자만 받는다.

```json
{
  "customerId": "...",
  "passiveEvidenceId": "..."
}
```

다음 값은 클라이언트가 지정하지 못한다.

- raw URL
- operation body
- remote ID
- `passed`
- spend result
- cleanup result
- arbitrary operationKey override

step registry와 stored evidence가 실행 범위를 결정한다.

## 10. 승격 연계

Active Canary PASS는 전체 계정 쓰기 허용과 동일하지 않다.

승격 단위:

```text
customer_id
+ spec_sha
+ credential_fingerprint
+ upstream_base_url
+ operation_key
+ field_scope
```

Passive evidence와 Active Canary evidence가 둘 다 유효한 operation만 해당 production activation 상태로 올릴 수 있다.

create/batch/delete처럼 별도 Canary를 통과하지 않은 operation은 기존 조회/수정 Canary가 PASS해도 자동 승격하지 않는다.

Gate E 전체 완료는 운영자가 대상으로 정한 모든 필수 operation scope가 각각 valid active-canary evidence를 가진 뒤에만 선언한다.

## 11. Crash / Unknown outcome

- mutation 전송 직전 event를 durable하게 기록한다.
- upstream request ID가 있으면 반드시 저장한다.
- 네트워크 결과가 불명확하면 같은 mutation을 재시도하지 않는다.
- reconcile은 저장된 remote ID와 read operation만 사용한다.
- 프로세스 재시작 시 `*_sent`, `unknown_outcome`, `cleanup_*` 상태를 스캔해 read-only recovery 대상으로 표시한다.
- recovery worker가 자동 mutation을 보내지는 않는다.

## 12. 테스트 전략

TDD로 구현한다.

### 단위 테스트

먼저 실패 테스트를 추가한다.

- Admin이 아니면 start 거부
- cross-customer start/read/reconcile/cleanup 차단
- invalid/expired passive evidence 거부
- suspended account 거부
- `allowActiveCanary=false` 거부
- `activationMode!=canary` 거부
- 동일 Customer 동시 Canary 거부
- raw operation/body override 거부
- create 응답 remote ID가 없으면 실패
- name lookup 사용 금지
- mutation timeout에서 자동 재시도 없음
- unknown outcome 이후 추가 mutation 없음
- cleanup unknown outcome에서 반복 cleanup 없음
- spend > 0이면 PASS 불가
- spend 미확정이면 pending 유지
- cleanup 미완료면 PASS 불가
- `off_preserved_verified`가 delete capability로 승격되지 않음
- campaign-only PASS가 다른 operation을 승격하지 않음
- evidence scope mismatch 승격 차단

### PostgreSQL 통합 테스트

- migration first pass / second pass idempotency
- immutable evidence
- append-only canary events
- unique active run per Customer
- restart 후 state recovery
- remote IDs의 Customer/run binding

### HTTP/OpenAPI 테스트

- 역할별 접근
- inaccessible run의 404 projection
- response/error에 secret 미노출
- minimal start payload contract
- OpenAPI role surface

### 기존 회귀

9/6 강화본 복구 후 먼저 기존 247 tests를 다시 통과시킨다. 그다음 Canary 테스트를 추가한다.

CI는 fixture upstream만 사용하고 실제 SearchAd credential/remote mutation을 절대 요구하지 않는다.

## 13. 구현 순서

1. PR #11 head에서 continuation branch 유지
2. 9/6 access-activation hardening 복구
3. 복구 기준에서 기존 247-test regression 재현
4. Canary migration/repository 실패 테스트
5. Canary state machine/service 실패 테스트
6. remote adapter/step registry 실패 테스트
7. HTTP/OpenAPI 실패 테스트
8. 최소 구현
9. PostgreSQL integration
10. full regression + safety scan + coverage + `git diff --check`
11. 별도 PR로 review
12. 코드 merge 후에도 실계정 mutation은 OFF 유지
13. 운영자가 credential/Customer/고정 outbound IP/backup을 확인한 뒤 Passive Probe 실행
14. 저장된 Passive evidence ID로 실제 Active Canary 1회 수행
15. cleanup + zero-spend evidence 확인 후 operation별 승격

## 14. 완료 기준

코드 완료와 운영 완료를 분리한다.

### 코드 완료

- 9/6 hardening 복구
- Canary state machine/persistence/API 구현
- 모든 신규 테스트 통과
- 기존 회귀 통과
- PostgreSQL migration idempotency 통과
- safety scan 통과
- CI green
- 실제 네이버 호출 0건

### 운영 Canary 완료

- 실제 HAAR Customer에서 valid Passive evidence 존재
- 전용 Canary object 생성
- 반환 remote ID 저장
- controlled mutation + read-back + rollback 검증
- unknown outcome 없음 또는 명시적 reconcile 완료
- cleanup policy terminal state 검증
- 공식 spend delta 0 확인
- immutable active_canary evidence 발급
- 해당 operation scope만 승격

운영 Canary 완료 전에는 `active`, `auto`, full write enablement를 완료로 보고하지 않는다.
