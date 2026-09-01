# 네이버 SearchAd 쓰기 실행 계층 v0.7.0

> 범위: 변경 계획, 승인, 실행, 원격 재검증, 재조정, 롤백  
> 상태: 기능 브랜치 구현  
> 원격 쓰기 기본값: Capability·Canary 전 임시 OFF

## 1. 목적

이 계층은 SearchAd 공식 operation manifest에 등록된 쓰기 API를 실제 운영에서 안전하게 사용할 수 있도록 한다.

```text
현재 원격값 조회
→ 변경 계획 저장
→ 변경 전 Hash 고정
→ 사용자 승인
→ 1회용 실행 토큰
→ 실행 직전 Drift 검사
→ 공식 operationKey 쓰기 1회
→ 원격 재조회
→ 예상값 검증
→ 적용 상태 기록
```

타임아웃·네트워크 단절 등으로 결과가 불명확하면 동일 쓰기를 반복하지 않는다.

```text
unknown_outcome
→ 원격 현재값 재조회
→ 예상 변경값과 일치: applied_reconciled
→ 변경 전 Hash와 일치: not_applied
→ 어느 쪽도 아님: manual_review
```

## 2. 모듈

```text
src/naver/searchad/write/
├─ errors.js
├─ canonical.js
├─ config.js
├─ redaction.js
├─ remote-adapter.js
├─ safe-remote-adapter.js
├─ repository.js
├─ plan-service.js
├─ approval-service.js
├─ execution-service.js
├─ safe-execution-service.js
├─ production-execution-service.js
├─ runtime.js
├─ runtime-safe.js
└─ runtime-production.js
```

실제 HTTP 연결은 `runtime-production.js`를 사용한다. 이전 runtime 파일은 기능 분해와 단위검증을 위한 하위 조합으로 남아 있다.

## 3. 저장 구조

현재 실행 런타임은 별도 SQLite 원장을 사용한다.

```text
searchad_write_change_plans
searchad_write_approvals
searchad_write_attempts
searchad_write_locks
```

운영 PostgreSQL 전환을 위한 동일 스키마는 다음 Migration에 포함된다.

```text
migrations/postgres/0006_searchad_write_execution.sql
```

이 버전에서는 PostgreSQL 스키마를 제공하지만 SearchAd 쓰기 런타임 어댑터는 SQLite다. 상태 API가 이를 명시하며 PostgreSQL 런타임을 구현한 것처럼 표시하지 않는다.

## 4. 변경 계획 입력

변경 계획은 임의 URL이나 HTTP method를 받지 않는다.

```json
{
  "customerId": "123456",
  "createdBy": "operator@example.com",
  "reason": "키워드 입찰가 조정",
  "mutation": {
    "operationKey": "<공식 manifest operationKey>",
    "pathParams": {},
    "query": {},
    "body": {},
    "confirmation": "<operation이 요구하는 확인 문구>"
  },
  "verification": {
    "read": {
      "operationKey": "<변경 대상 단건 조회 operationKey>",
      "pathParams": {},
      "query": {}
    },
    "extractPath": "",
    "expectedPatch": {
      "bidAmt": 300
    }
  },
  "rollback": {
    "mutation": {
      "operationKey": "<동일 객체 수정 operationKey>",
      "pathParams": {},
      "query": {},
      "body": {}
    },
    "bodyFromBefore": {
      "bidAmt": "bidAmt"
    }
  }
}
```

`bodyFromBefore`는 롤백 요청의 필드를 변경 전 원격 스냅샷에서 복사한다. 민감한 값이나 사용자가 임의로 제공한 이전값을 신뢰하지 않는다.

## 5. 승인과 실행 토큰

승인 확인 문구:

```text
APPROVE_SEARCHAD_CHANGE
```

승인 응답은 기본 10분 유효한 1회용 토큰을 반환한다. DB에는 토큰 원문이 아니라 SHA-256 Hash만 저장된다. 실행 시 `BEGIN IMMEDIATE` 트랜잭션으로 토큰을 선점해 같은 토큰의 동시 사용을 막는다.

## 6. Drift 검사

실행 전 조회한 전체 대상 스냅샷 Hash가 계획 작성 시 저장한 Hash와 다르면:

```text
SEARCHAD_STALE_PLAN
```

으로 중단한다. 광고주센터나 다른 운영자가 수정한 값을 덮어쓰지 않는다.

## 7. 원격 재검증

쓰기 응답이 성공이어도 완료로 처리하지 않는다.

```text
공식 단건 조회 operationKey 재호출
→ extractPath 적용
→ expectedAfter 또는 expectedPatch가 실제값의 부분집합인지 검사
```

네이버가 추가하는 동적 메타데이터 때문에 전체 객체 일치가 실패하지 않도록, 사용자가 명시한 예상 필드만 엄격히 검증한다.

## 8. 불명확한 결과

다음 오류는 결과 불명확 후보다.

```text
AbortError
Timeout
ECONNRESET
EPIPE
502
503
504
```

상태를 `unknown_outcome`으로 저장하고 동일 쓰기를 자동 반복하지 않는다. `reconcile`은 원격 읽기만 수행한다.

## 9. 롤백

롤백 확인 문구:

```text
ROLLBACK_SEARCHAD_CHANGE
```

조건:

```text
계획 상태가 applied 또는 applied_reconciled
롤백 operation이 계획에 존재
현재 원격 전체 Hash == 적용 직후 저장 Hash
동일 계획 rollback lock 획득
```

다른 변경이 감지되면 `SEARCHAD_ROLLBACK_DRIFT`로 중단한다.

롤백 요청이 수신됐지만 롤백 후 재조회가 실패하면 상태를 `rollback_unknown_outcome`으로 변경한다. 이 경우 동일 롤백을 반복하지 않고 운영자가 원격 상태를 확인한다.

## 10. HTTP API

```http
GET  /openapi-searchad-write.json
GET  /api/v1/searchad/write/status
GET  /api/v1/searchad/changes
GET  /api/v1/searchad/changes/{planId}
POST /api/v1/searchad/changes/plan
POST /api/v1/searchad/changes/{planId}/approve
POST /api/v1/searchad/changes/{planId}/execute
POST /api/v1/searchad/changes/{planId}/reconcile
POST /api/v1/searchad/changes/{planId}/rollback
```

실행과 롤백에는 `Idempotency-Key` 헤더 또는 `idempotencyKey`가 필요하다. 실제 중복 실행 방지는 승인 토큰, 계획 상태, 원격 검증, DB 잠금을 함께 사용한다.

## 11. 환경변수

```dotenv
ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED=true
ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS=true
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_ROLLBACK=false
ATELIER_SEARCHAD_ALLOW_RECONCILE=true
ATELIER_SEARCHAD_ACTIVATION_MODE=prevalidation
ATELIER_SEARCHAD_WRITE_DB_PATH=./work/searchad-write.sqlite
ATELIER_SEARCHAD_PLAN_TTL_SECONDS=1800
ATELIER_SEARCHAD_APPROVAL_TTL_SECONDS=600
```

실계정 Capability·Canary 통과 후 `ALLOW_WRITES`, `ALLOW_ROLLBACK`을 true로 승격한다. 생성·배치·삭제·자동화 Gate는 후속 단계에서 같은 승인·검증 계층에 연결한다.

## 12. 현재 단계와 후속 단계

이번 단계:

```text
일반 공식 쓰기 operation의 변경 계획·승인·실행·재검증
unknown outcome reconcile
롤백
감사 시도 원장
임시 검증 전 Gate
```

후속 단계:

```text
광고상품별 캠페인·그룹·키워드·소재 생성 Validator
대량 작업 Chunk·부분 실패·보상 계획
원격 삭제 처리의 2차 대상 확인
Active Canary 자동 생성·검증·정리
입찰·예산 정책 상한
자동화 observe/recommend/approve/auto
PostgreSQL SearchAd write runtime adapter
```
