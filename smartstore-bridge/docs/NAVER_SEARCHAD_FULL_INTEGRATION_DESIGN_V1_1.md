# HAAR / AtelierPopo 네이버 광고 통합 플랫폼 설계서 v1.1

> 문서 버전: 1.1  
> 작성 기준일: 2026-08-24  
> 대상 저장소: `jskjw157/AtelierPopo`  
> 대상 애플리케이션: `smartstore-bridge`  
> 상태: **OWNER APPROVED — 운영계정 쓰기·생성·자동화 활성화 방향 승인**  
> 목표: 네이버 커머스API, 네이버 검색광고 SA API, 퀸실버 상품 카탈로그, Google Drive 원본 저장소를 하나의 운영 플랫폼으로 통합한다.

---

## 0. 문서 효력과 사용자 결정

이 문서는 v1.0 설계와 2026-08-24 정밀 리뷰의 보완점을 합친 실제 구현 기준 문서다.

사용자 결정에 따라 다음 정책을 확정한다.

1. 리뷰에서 **보완 후 개발**로 분류한 보고서 적재, 상품별 분석, 추천 엔진은 필요한 보완을 적용한 뒤 구현한다.
2. 리뷰에서 **운영계정 활성화 금지**로 권고한 생성·입찰가 변경·예산 변경·자동 롤백·대량 생성 기능도 운영계정에서 사용할 수 있게 구현하고 활성화한다.
3. 수익성 데이터가 완전히 확정되지 않은 단계에서도 상품별 수익성 화면과 지표를 표시한다.
4. 단, 데이터 무결성을 위해 모든 수익성 값에는 `actual`, `partial`, `estimated` 상태와 근거·기준시각을 함께 표시한다. 추정값을 확정값으로 위장하지 않는다.
5. “활성화”는 기능을 실제 운영계정에서 호출할 수 있게 한다는 뜻이다. 모든 작업을 무제한·무기록으로 실행한다는 뜻은 아니다. 금액 상한, 상태 Drift 검사, 감사 로그, 원격 결과 재조정은 유지한다.
6. 영구 삭제 API도 운영 기능으로 구현하되, 삭제는 자동화 규칙에서 제외하고 별도 2단계 확인을 요구한다.

현재 이 문서는 설계·개발 기준을 확정한 것이다. 네이버 광고 API 키 연결과 새 코드 배포 전에는 실제 광고계정에 변경이 발생하지 않는다.

---

## 1. 목표와 핵심 원칙

현재 `smartstore-bridge`의 커머스 상품 검증·미리보기·등록 구조를 유지하면서 SearchAd 도메인을 추가한다.

핵심 원칙:

- Commerce와 SearchAd API 클라이언트, 데이터 모델, 작업 큐를 분리한다.
- 공식 문서·Swagger의 존재와 실제 계정 지원 여부를 구분한다.
- API 기능은 실제 계정 Capability 결과에 따라 상태를 기록한다.
- 운영계정 쓰기·생성·자동화를 지원한다.
- 쓰기는 변경 전후 스냅샷, 상태 Drift 검사, 결과 재조회, 감사 로그를 반드시 거친다.
- 로컬 멱등성 키를 네이버 원격 멱등성으로 오해하지 않는다.
- 보고서 원본·스키마 버전·VAT 기준·재수집 상태를 보존한다.
- 상품별 수익성은 데이터 상태와 신뢰도를 함께 표시한다.
- SearchAd와 성과형 디스플레이광고는 별도 어댑터로 관리한다.

---

## 2. 데이터 기준선

퀸실버 카탈로그 기준:

- 고유 상품 1,515개
- 상품 JSON 1,515개
- 이미지 31,473개
- 약 12.89GB

광고 통합은 1,500개 이상 상품을 일괄 분석·매핑·운영하는 구조를 전제로 한다.

Google Drive를 원본 저장소로 두고, Hostinger 애플리케이션은 필요한 상품 JSON·이미지를 Google Drive API로 선택 다운로드하거나 캐시한다.

---

## 3. API 지원 등급

모든 기능을 다음 세 등급으로 관리한다.

```text
Tier A
- 현재 공식 도움말 또는 공식 샘플에 근거가 있음
- 아뜰리에포포 실제 계정 호출도 성공함
- 운영 활성화 가능

Tier B
- 공식 Swagger 또는 보고서 사양에 존재함
- 실제 계정 Passive Probe 또는 Active Canary 필요
- Probe 성공 시 운영 활성화

Tier C
- 내부·레거시 흔적 또는 공개 지원 범위가 불명확함
- 구현체는 어댑터 슬롯으로 둘 수 있음
- 실제 호출은 별도 검증 전 차단
```

Capability는 Boolean이 아니라 증거를 포함한다.

```json
{
  "capability": "shopping_product_ad_create",
  "state": "supported",
  "tier": "B",
  "evidence": "live_write_canary",
  "httpStatus": 200,
  "errorCode": null,
  "checkedAt": "2026-08-24T00:00:00Z",
  "specCommit": "..."
}
```

`403`, `404`, 빈 배열은 자동으로 미지원으로 확정하지 않는다. 권한 없음, 데이터 없음, 계약 미보유, 호출 조건 오류를 구분한다.

---

## 4. 운영 활성화 범위

운영계정에서 다음 기능을 구현·활성화한다.

### 4.1 조회

- 광고계정·관리계정·하위계정·구성원
- 비즈머니 잔액·잠금·충전·소진 내역
- 캠페인·광고그룹·키워드·소재·확장소재
- 비즈채널·타게팅·공유예산·라벨
- 상품그룹·쇼핑상품·카탈로그 관련 지원 객체
- 실시간 통계·세부 통계
- 성과 보고서·전환 보고서·검색어 보고서
- 마스터 보고서·Delta 보고서
- 검수 이력
- 연관 키워드·검색량·경쟁도
- 입찰가·노출·클릭·비용 추정

### 4.2 쓰기

- 캠페인 ON/OFF·기간·예산·공유예산 변경
- 광고그룹 ON/OFF·입찰가·예산·네트워크 가중치 변경
- 키워드 생성·수정·입찰가·ON/OFF·URL·제외 키워드
- 지원 소재 생성·수정·복사·ON/OFF
- 지원 확장소재 생성·수정·기간·ON/OFF
- 비즈채널 지원 유형 생성·수정·재검수 요청
- 타게팅·입찰 가중치 변경
- 라벨·연결 관리
- 캠페인·광고그룹·키워드·소재·확장소재 대량 생성
- 승인된 자동 입찰가·예산 최적화
- 변경 실패 또는 성과 악화 시 자동 롤백
- 영구 삭제 API

### 4.3 삭제 정책

삭제 기능은 활성화하되 자동화 룰에서는 제외한다.

필수 조건:

```text
ATELIER_ADS_ALLOW_DELETES=true
confirmation=DELETE_AD_ENTITY
secondConfirmation=<entity id>
최근 원격 상태 재조회
삭제 대상과 하위 영향 표시
감사 로그
```

---

## 5. 목표 아키텍처

```text
ChatGPT Action / HAAR Admin / CLI / Scheduler
                     │
                     ▼
Hostinger smartstore-bridge HTTP Gateway
  ├─ Reader API
  ├─ Operator API
  ├─ Executor API
  ├─ Auth / Rate Limit / Request ID
  ├─ Change Plan / Approval / Execution
  └─ OpenAPI Documents
                     │
                     ▼
Application Services
  ├─ CommerceService
  ├─ SearchAdService
  ├─ CapabilityService
  ├─ ReportIngestionService
  ├─ ProductAdLinkingService
  ├─ ProfitabilityService
  ├─ RecommendationEngine
  ├─ AutomationPolicyEngine
  └─ ReconciliationService
                     │
                     ▼
Infrastructure
  ├─ NaverCommerceClient
  ├─ NaverSearchAdClient
  ├─ GoogleDriveCatalogProvider
  ├─ PostgreSQL
  ├─ Object/File Storage
  ├─ Scheduler / Queue
  └─ Structured Audit Log
```

---

## 6. SearchAd 자격증명 모델

SearchAd 인증은 `Principal 1 : Customer N` 모델로 구현한다.

```text
searchad_principals
- principal_id
- access_license_secret_ref
- secret_key_secret_ref
- status
- issued_at
- secret_rotated_at

searchad_customer_accounts
- customer_id
- account_name
- status
- timezone

searchad_principal_grants
- principal_id
- customer_id
- role
- capabilities_json
- last_verified_at
```

요청 헤더:

```http
X-Timestamp: <epoch milliseconds>
X-API-KEY: <access license>
X-Customer: <customer id>
X-Signature: <base64 hmac>
```

서명 메시지:

```text
{timestamp}.{HTTP_METHOD}.{URI_PATH}
```

---

## 7. Capability Probe

### 7.1 Passive Probe

운영계정 연결 즉시 실행한다.

- 계정·캠페인·광고그룹·키워드·소재 조회
- 비즈채널·타게팅·공유예산 조회
- 비즈머니 조회
- 기존 보고서·마스터 보고서 Job 목록 조회
- 실제 응답 필드·enum·오류 코드 저장

### 7.2 Active Canary

사용자 결정에 따라 운영계정에서도 활성화한다. 단, 영향을 제한하기 위해 전용 객체를 사용한다.

```text
[HAAR_API_CANARY] 캠페인
[HAAR_API_CANARY] 광고그룹
[HAAR_API_CANARY] 키워드/소재
```

검증 순서:

1. 중지 상태 테스트 캠페인 생성
2. 중지 상태 광고그룹 생성
3. 테스트 키워드·지원 소재 생성
4. 소액 입찰가·예산 설정
5. ON/OFF 왕복
6. 보고서 Job 생성·polling·다운로드
7. 생성 객체 정리 또는 비활성 보존
8. Capability 증거 저장

Canary 객체가 아닌 실제 운영 객체는 Capability 검증 대상으로 사용하지 않는다.

---

## 8. 쓰기·재시도·결과 재조정

### 8.1 조회 재시도

```text
GET
- 429, 502, 503, 504
- 지수 백오프 + jitter
- Retry-After 우선
```

### 8.2 상태 변경

```text
PUT ON/OFF·입찰가·예산
- 요청 전 현재값 조회
- expected_before_hash 저장
- 호출 후 원격 상태 재조회
- 목표값이면 성공
- 타임아웃이면 자동 재호출 전에 재조회
```

### 8.3 생성

```text
POST 캠페인·광고그룹·키워드·소재
- request_fingerprint 저장
- 타임아웃 뒤 즉시 자동 재호출 금지
- status=unknown_outcome
- 이름·부모 ID·생성시각·자연키로 원격 탐색
- 중복 여부를 판정한 뒤 reconcile
```

### 8.4 삭제

```text
DELETE
- 자동 재시도 금지
- 결과 불명확 시 원격 재조회
- 하위 객체·참조 영향 기록
```

`searchad_operations` 필수 필드:

```text
operation_id
customer_id
operation_type
entity_type
entity_id
request_fingerprint
expected_before_hash
expected_after_hash
remote_transaction_id
outcome
reconciliation_result
request_json
response_json
created_at
executed_at
verified_at
```

---

## 9. 변경 계획과 Drift 검사

변경 계획:

```text
plan_data_cutoff_at
expected_before_hash
requested_after_json
approved_at
approval_expires_at
max_allowed_drift
actor
reason
```

실행 직전:

1. 원격 엔티티 재조회
2. 현재 Hash와 `expected_before_hash` 비교
3. 다르면 `STALE_PLAN`
4. 자동화 룰은 최신 데이터로 새 계획 생성
5. 승인형 작업은 새 계획 재승인

자동 롤백:

```text
현재 Hash == 우리가 적용한 expected_after_hash
→ 자동 롤백 가능

현재 Hash != expected_after_hash
→ 다른 운영자 변경 가능성
→ 롤백 보류 + 알림
```

---

## 10. 데이터베이스와 저장소

### 10.1 단계 결정

- 개발·단위 테스트: SQLite 허용
- 운영 읽기 PoC: 단일 프로세스 SQLite 허용
- 보고서 적재·상품별 분석·쓰기·다중 Worker: PostgreSQL 사용
- 분산 Queue 또는 다중 인스턴스: PostgreSQL lease/advisory lock, 필요 시 Redis 추가

### 10.2 금액·시간 타입

```text
광고비·매출·원가·수수료: BIGINT KRW
비율: DECIMAL
수량: BIGINT
원격 시각: TIMESTAMPTZ
통계 기준일: DATE + timezone=Asia/Seoul
원시 JSON: JSONB
```

### 10.3 원본 파일

- 보고서 원본 TSV
- 마스터 보고서 원본
- 체크섬
- 다운로드 시각
- reportTp
- reportCreatedAt
- parserVersion
- schemaVersion
- quarantine 상태

을 파일 또는 오브젝트 저장소에 보존한다.

---

## 11. 보고서 수집 파이프라인

```text
Report Job 생성
→ polling
→ BUILT 확인
→ 원본 다운로드
→ SHA-256 체크섬
→ report_schema_registry 조회
→ 열 개수 검증
→ staging 적재
→ 정규화
→ 중복 제거
→ 집계 갱신
→ 데이터 완결성 상태 기록
```

### 11.1 스키마 레지스트리

```text
report_schema_registry
- report_type
- schema_version
- effective_from_kst
- effective_to_kst
- expected_column_count
- ordered_columns_json
- report_created_at_rule
- source_notice_id
- source_spec_commit
- parser_version
```

파서 선택:

```text
reportTp
+ 보고서 생성시각
+ 기준일자
+ 열 개수
= schemaVersion
```

열 개수가 일치하지 않으면 추측하지 않고 quarantine한다.

### 11.2 확장소재 보고서 변경

2026-11-16 이후 생성되는 `ADEXTENSION`, `ADEXTENSION_CONVERSION` 보고서는 Business Channel ID 열 삭제 사양을 사용한다.

보고서 기준일이 과거여도 “생성시각”이 변경일 이후면 새 스키마를 적용한다.

### 11.3 재수집

```text
D+1 초기 수집
D+2 재수집
D+3 재수집
48시간 이후 finalized 후보
데이터 변경됨 상태 감지 시 신규 보고서 생성
```

---

## 12. VAT와 광고비 정규화

원시값을 항상 보존한다.

```text
reported_cost_raw
cost_vat_basis = included | excluded | unknown
stat_date
report_created_at
normalization_policy_version
normalized_cost_gross
normalized_cost_net
```

정책:

```text
2026-03-30 이후 해당 보고서 Cost
→ VAT 포함 기준

2026-03-30 이전 Cost
→ VAT 미포함 기준

기준 확인 불가
→ unknown, 원시값만 확정
```

모든 기간에 무조건 `/1.1`을 적용하지 않는다.

---

## 13. 상품·광고 N:M 연결

단일 `product_ad_links` 행에 모든 ID를 넣지 않는다.

```text
commerce_products
commerce_product_variants
searchad_business_channels
searchad_shopping_products
searchad_product_groups
searchad_product_group_members
searchad_campaigns
searchad_adgroups
searchad_ads
searchad_keywords
product_ad_mappings
```

매핑 필드:

```text
source_product_id
seller_management_code
origin_product_no
channel_product_no
remote_entity_type
remote_entity_id
mapping_method
mapping_confidence
verified_at
verified_by
```

매핑 신뢰도가 낮아도 분석 화면에는 표시할 수 있다. 자동 변경에는 설정된 최소 신뢰도 이상만 사용한다.

---

## 14. 수익성 표시 정책

사용자 결정에 따라 상품별 수익성 화면은 초기 버전부터 표시한다.

### 14.1 표시 지표

- SearchAd 귀속매출
- Commerce 결제매출
- Commerce 순매출
- 광고비
- 공급가 기반 원가
- 옵션 원가 또는 옵션 추가금 대체값
- 판매·결제 수수료
- 배송비 부담
- 쿠폰·할인 부담
- 취소·반품 충당
- 광고 반영 공헌이익
- 공헌이익률
- 손익분기 ROAS
- 이익 ROAS
- ROAS·ACoS·CPA·CVR

### 14.2 데이터 상태

모든 계산 결과에 다음 상태를 붙인다.

```text
actual
- 정산·주문·취소·반품·원가가 확정됨

partial
- 일부 실제값 + 일부 정책값/대체값

estimated
- 공급가·옵션 추가금·기본 수수료율 등으로 추정
```

UI 예시:

```text
실제 수익성  18,420원
상태: 추정(estimated)
기준: 공급가 + 기본 수수료율 + 기본 배송비 정책
기준시각: 2026-08-24 14:00 KST
신뢰도: 0.62
```

화면 섹션명은 `실제 수익성`으로 제공할 수 있지만 상태 배지와 산출 근거를 숨기지 않는다.

### 14.3 계산식

```text
광고 반영 공헌이익
= 순매출
- 상품·옵션 원가
- 판매·결제 수수료
- 배송비 부담
- 쿠폰·할인 부담
- 취소·반품 충당
- 광고비
```

```text
공헌이익률 = 광고비 제외 공헌이익 / 순매출
손익분기 ROAS = 1 / 공헌이익률 × 100
이익 ROAS = 광고 반영 공헌이익 / 광고비 × 100
```

원가 데이터가 없을 때 우선순위:

1. 상품·옵션 실제 원가
2. 공급가 + 옵션별 실제 원가
3. 공급가 + 옵션 추가금 대체값
4. 카테고리 기본 원가율
5. 미입력 시 0원 처리 금지, `unknown` 표시

---

## 15. 자동화 엔진

운영 기본값은 `auto`다.

```dotenv
NAVER_SEARCHAD_ALLOW_WRITES=true
ATELIER_ADS_HTTP_ALLOW_WRITES=true
ATELIER_ADS_ALLOW_CREATES=true
ATELIER_ADS_ALLOW_BATCH_WRITES=true
ATELIER_ADS_ALLOW_ROLLBACK=true
ATELIER_ADS_ALLOW_DELETES=true
ATELIER_ADS_AUTOMATION_MODE=auto
```

### 15.1 자동 실행 허용

- 품절·판매중지 상품 광고 중지
- 재고 회복 상품 광고 재개
- 무전환 고지출 키워드 입찰가 인하
- 고성과·재고 충분 키워드 입찰가 상향
- 캠페인·그룹 예산 페이싱
- 목표 ROAS 기반 소폭 예산 조정
- 검색어 기반 신규 키워드 생성
- 무전환 검색어 제외 키워드 등록
- 승인된 템플릿 기반 캠페인·광고그룹·키워드·소재 대량 생성
- 성과 악화 또는 적용 실패 시 자동 롤백

### 15.2 자동 실행 전 데이터 조건

```text
report_schema_valid=true
product_mapping_verified=true 또는 mapping_confidence 임계치 이상
inventory_freshness 임계치 이내
commerce_watermark >= 분석 기준시각
광고 데이터 finalized 또는 룰에서 지연 허용
remote_state_hash 일치
```

조건 미달 시 자동 실행 대신 경고와 추천을 생성한다.

### 15.3 금액·변경 상한

기본값:

```dotenv
ATELIER_ADS_MAX_BID_CHANGE_PERCENT=20
ATELIER_ADS_MAX_BUDGET_CHANGE_PERCENT=20
ATELIER_ADS_MAX_DAILY_BUDGET_KRW=100000
ATELIER_ADS_MAX_BATCH_SIZE=20
ATELIER_ADS_MAX_DAILY_OPERATIONS=200
ATELIER_ADS_MIN_CONVERSION_SAMPLE=3
```

상한은 Admin 정책에서 변경할 수 있다.

### 15.4 대량 생성

- 기본 배치 크기 20
- 캠페인·광고그룹·소재 유형별 template profile
- 각 배치 전 Dry Run
- 성공·실패·unknown outcome 분리
- 다음 배치는 이전 배치 reconcile 완료 후 시작

---

## 16. 외부 HTTP API

### 16.1 Reader

```http
GET  /api/v1/ads/status
GET  /api/v1/ads/capabilities
GET  /api/v1/ads/accounts
GET  /api/v1/ads/billing
GET  /api/v1/ads/campaigns
GET  /api/v1/ads/adgroups
GET  /api/v1/ads/keywords
GET  /api/v1/ads/creatives
GET  /api/v1/ads/channels
GET  /api/v1/ads/product-groups
GET  /api/v1/ads/stats
GET  /api/v1/analytics/ads/products
GET  /api/v1/analytics/ads/profitability
GET  /api/v1/analytics/ads/recommendations
```

### 16.2 Operator

```http
POST /api/v1/ads/capabilities/passive-probe
POST /api/v1/ads/capabilities/active-canary
POST /api/v1/ads/changes/plan
POST /api/v1/ads/changes/{id}/approve
POST /api/v1/ads/batches/plan
```

### 16.3 Executor

```http
POST /api/v1/ads/changes/{id}/execute
POST /api/v1/ads/changes/{id}/rollback
POST /api/v1/ads/batches/{id}/execute
POST /api/v1/ads/entities/{type}/{id}/delete
```

네이버 원시 프록시 엔드포인트는 제공하지 않는다.

---

## 17. ChatGPT Action 권한 분리

OpenAPI를 세 문서로 분리한다.

```text
/openapi-reader.json
- 조회·통계·수익성·추천

/openapi-operator.json
- Probe·변경계획·승인

/openapi-executor.json
- 실행·롤백·배치·삭제
```

사용자 결정에 따라 Executor도 ChatGPT에 연결할 수 있다.

실행 시 반드시 응답에 포함한다.

- 광고계정
- 엔티티 유형·ID·이름
- 현재값·변경값
- 예상 금액 영향
- 데이터 기준시각
- 수익성 상태
- Rollback 가능 여부
- Operation ID

---

## 18. 관리자 화면

### 18.1 대시보드

- 오늘·7일·30일 광고비
- SearchAd 귀속매출
- Commerce 결제·순매출
- 실제 수익성 섹션
- 수익성 상태 배지
- ROAS·CPA·ACoS·CVR
- 비즈머니 잔액
- 예산 소진 속도
- 품절 광고
- 검수 오류
- 자동화 실행·실패·unknown outcome

### 18.2 상품별 화면

- 퀸실버 원본 정보
- 스마트스토어 상품 정보
- 광고 연결 그래프
- 재고·판매상태
- 검색어·키워드·소재
- 광고비·귀속매출·순매출
- 실제 수익성·공헌이익·손익분기 ROAS
- 상태·신뢰도·계산 근거
- 최근 자동화·수동 변경 이력

### 18.3 운영 제어

- 전체 쓰기 Kill Switch
- 자동화 모드 전환
- 일일 예산·변경 상한
- Capability 상태
- Canary 실행
- Batch 실행
- unknown outcome reconcile
- 롤백

---

## 19. 보안과 감사

### 19.1 비밀정보

Hostinger Secret 또는 별도 Secret Manager에만 저장한다.

- SearchAd Access License
- SearchAd Secret Key
- Customer ID
- Commerce Client ID·Secret
- Google 서비스 계정 키
- Atelier API Keys

### 19.2 권한

```text
Reader Key
Operator Key
Executor Key
Admin Key
```

### 19.3 감사 로그

```text
request_id
actor
source
customer_id
action
entity_type
entity_id
before_json
after_json
reason
approval_id
idempotency_key
request_fingerprint
remote_response
outcome
reconciliation_result
executed_at
verified_at
rollback_status
```

---

## 20. 장애 대응

| 상황 | 처리 |
|---|---|
| Invalid Signature | 서버 시각·URI·메서드·키 확인, 자동 재시도 금지 |
| 401/403 | Principal·Customer grant·권한 재검증 |
| 429 | Retry-After + 백오프 |
| 조회 5xx | 제한 재시도 |
| 쓰기 타임아웃 | `unknown_outcome`, 원격 reconcile |
| 생성 결과 불명확 | 자연키·부모 ID·시각으로 중복 탐색 |
| stale plan | 실행 중단 또는 최신 상태로 재계획 |
| 보고서 열 불일치 | quarantine |
| DB 장애 | 신규 쓰기 중단, 실행 중 작업 reconcile |
| 비즈머니 부족 | 예산·입찰 상향 중단 |
| 재고 지연 | 재고 기반 자동 재개 보류 |
| 수익성 데이터 누락 | 화면 표시 유지, 상태를 `partial/estimated`로 강등 |

전체 쓰기 Kill Switch:

```dotenv
NAVER_SEARCHAD_ALLOW_WRITES=false
ATELIER_ADS_HTTP_ALLOW_WRITES=false
ATELIER_ADS_AUTOMATION_MODE=observe
```

---

## 21. 테스트 전략

### 21.1 단위 테스트

- HMAC 서명 고정 벡터
- Secret 마스킹
- 금액·VAT 정책
- 날짜별 보고서 스키마
- 수익성 상태 결정
- 상품·광고 매핑
- Drift hash
- operation reconciliation
- 자동화 상한
- 롤백 hash 조건

### 21.2 계약 테스트

- 공식 응답 fixture
- 신규 enum 보존
- 누락 필드 안전 처리
- 페이지네이션
- 보고서 상태 전이
- 2026-11-16 전후 확장소재 보고서 파서

### 21.3 운영계정 Canary

- `[HAAR_API_CANARY]` 캠페인 생성
- 광고그룹·키워드·소재 생성
- ON/OFF
- 입찰가·예산 변경
- 보고서 생성·다운로드
- 롤백
- 삭제
- unknown outcome 수동 시뮬레이션

### 21.4 자동화 Shadow 기록

운영 자동화는 활성화하되, 각 룰에 `shadowCompare=true`를 지원한다. 실제 실행 결과와 실행하지 않았을 가상 결과를 함께 기록해 정책을 보정한다.

---

## 22. 구현 로드맵

### Phase 0 — 기반

- Principal/Customer 자격증명 모델
- HMAC 클라이언트
- API 지원 Tier 레지스트리
- Passive Probe
- 운영계정 Active Canary
- Reader/Operator/Executor OpenAPI 분리

### Phase 1 — 핵심 조회

- 계정·비즈머니
- 캠페인·광고그룹·키워드·소재
- 비즈채널·타게팅·공유예산
- Capability 저장

### Phase 2 — 보고서

- schema registry
- 원본 보존
- quarantine
- VAT 정책
- D+1/D+2/D+3 재수집
- 성과·전환·검색어·마스터 보고서

### Phase 3 — Commerce 연결

- 상품·옵션·주문·취소·반품·정산 데이터 계층
- N:M 광고 매핑
- 재고·판매상태 동기화
- 수익성 actual/partial/estimated 계산
- 실제 수익성 화면 즉시 노출

### Phase 4 — 조사·추천

- 연관 키워드
- 입찰 추정
- 검색어 확장
- 제외 키워드
- 지출·재고·수익성 추천

### Phase 5 — 운영 쓰기 활성화

- ON/OFF
- 입찰가·예산
- 타게팅·공유예산
- Drift 검사
- unknown outcome reconcile
- 자동 롤백

### Phase 6 — 운영 생성·배치

- 캠페인·광고그룹·키워드·지원 소재 생성
- template profiles
- Batch 20개
- 대량 생성 운영 활성화

### Phase 7 — 운영 자동화

- `auto` 기본
- 품절 중지·재개
- 입찰가·예산 최적화
- 키워드 생성·제외
- 템플릿 기반 광고 구조 생성
- 자동 롤백

### Phase 8 — 관리자 UI·ChatGPT

- 전체 대시보드
- 실제 수익성 표시
- 운영 제어
- Reader/Operator/Executor Actions
- Runbook

### Phase 9 — 디스플레이광고

공식 관리 API 또는 파트너 권한 확보 후 `src/displayads/`로 별도 구현한다.

---

## 23. 운영 환경변수 기준

```dotenv
NAVER_SEARCHAD_BASE_URL=https://api.searchad.naver.com
NAVER_SEARCHAD_ACCESS_LICENSE=
NAVER_SEARCHAD_SECRET_KEY=
NAVER_SEARCHAD_CUSTOMER_ID=

NAVER_SEARCHAD_ALLOW_WRITES=true
ATELIER_ADS_HTTP_ALLOW_WRITES=true
ATELIER_ADS_ALLOW_CREATES=true
ATELIER_ADS_ALLOW_BATCH_WRITES=true
ATELIER_ADS_ALLOW_ROLLBACK=true
ATELIER_ADS_ALLOW_DELETES=true
ATELIER_ADS_AUTOMATION_MODE=auto

ATELIER_ADS_MAX_BID_CHANGE_PERCENT=20
ATELIER_ADS_MAX_BUDGET_CHANGE_PERCENT=20
ATELIER_ADS_MAX_DAILY_BUDGET_KRW=100000
ATELIER_ADS_MAX_BATCH_SIZE=20
ATELIER_ADS_MAX_DAILY_OPERATIONS=200
ATELIER_ADS_MIN_CONVERSION_SAMPLE=3

ATELIER_ADS_READER_API_KEYS=
ATELIER_ADS_OPERATOR_API_KEYS=
ATELIER_ADS_EXECUTOR_API_KEYS=
ATELIER_ADS_ADMIN_API_KEYS=
```

배포 초기에는 키가 없으므로 기능이 실행되지 않는다. 키 연결과 Capability 성공 후 운영 활성 상태가 된다.

---

## 24. 완료 정의

- [ ] Principal 1 : Customer N 인증 모델이 동작한다.
- [ ] Tier A/B/C와 Capability 증거가 저장된다.
- [ ] Passive Probe와 운영계정 Active Canary가 동작한다.
- [ ] 보고서 스키마 레지스트리와 quarantine가 동작한다.
- [ ] VAT 기준일과 원시 광고비가 보존된다.
- [ ] D+1/D+2/D+3 재수집과 finalized 상태가 동작한다.
- [ ] 상품·광고 N:M 매핑이 동작한다.
- [ ] 실제 수익성 화면이 `actual/partial/estimated` 상태와 함께 표시된다.
- [ ] 운영계정 ON/OFF·입찰가·예산 변경이 가능하다.
- [ ] 운영계정 캠페인·그룹·키워드·소재 생성이 가능하다.
- [ ] 대량 생성과 자동화가 활성화된다.
- [ ] Drift 검사와 unknown outcome reconciliation이 동작한다.
- [ ] 자동 롤백이 after hash 조건을 지킨다.
- [ ] 삭제 기능이 2단계 확인과 감사 로그를 거친다.
- [ ] Reader/Operator/Executor OpenAPI가 분리된다.
- [ ] 전체 쓰기 Kill Switch가 동작한다.

---

## 25. 다음 산출물

1. `NAVER_SEARCHAD_API_COVERAGE.md`
2. `NAVER_SEARCHAD_DATA_MODEL.md`
3. `NAVER_SEARCHAD_HTTP_API.md`
4. `NAVER_SEARCHAD_AUTOMATION_POLICY.md`
5. `NAVER_SEARCHAD_IMPLEMENTATION_PLAN.md`
6. `NAVER_SEARCHAD_RUNBOOK.md`
7. `NAVER_SEARCHAD_REPORT_SCHEMA_REGISTRY.md`
8. `NAVER_SEARCHAD_PROFITABILITY_POLICY.md`

이후 Phase 0 코드 구현을 시작한다.
