# HAAR / AtelierPopo 네이버 검색광고 API 전체 통합 설계·구현 계약서 v2.1

> 문서 버전: 2.1  
> 작성 기준일: 2026-08-25  
> 대상 저장소: `jskjw157/AtelierPopo`  
> 기준 애플리케이션: `smartstore-bridge v0.4.0`  
> 대상 브랜드/스토어: `HAAR / 아뜰리에포포`  
> 상태: **IMPLEMENTATION CONTRACT — P0/P1 REVIEW RESOLVED**  
> 승계 문서: `NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2.md`  
> 정책: **전체 조회·생성·수정·중지·삭제 처리·보고서·추천·자동화 구현, 운영 활성화는 검증 단계에 따라 승격**

---

## 0. 문서 효력

이 문서는 네이버 검색광고 SA API 통합 개발의 최종 기준 문서다.

`NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2.md`의 범위를 유지하면서 정밀 리뷰에서 확인된 P0·P1 문제를 반영했다. 구현 중 문서 간 충돌이 발생하면 이 v2.1을 우선한다.

사용자 결정은 다음과 같이 보존한다.

1. 공식 SearchAd API에서 확인되는 기능을 가능한 범위까지 모두 구현한다.
2. 운영계정에서도 캠페인·광고그룹·키워드·소재 생성, 입찰가·예산 변경, 대량 작업, 롤백, 자동화를 사용할 수 있게 한다.
3. 삭제 처리 API도 구현한다.
4. 상품별 수익성은 초기부터 표시한다.
5. 최종적으로 `auto` 모드를 지원한다.
6. 기능을 제거하는 대신, 공개 API 여부·계정 권한·광고상품 조건·계약 조건을 명시적으로 구분한다.
7. 운영 기본값은 안전한 `observe/read-only`로 시작하고, 검증 완료 후 전체 쓰기와 `auto`로 승격한다.

“모든 기능”의 완료 정의:

```text
공식 Raw Swagger operation
= 공개 문서 operation
+ 공식 샘플 검증 operation
+ 릴리스 노트 검증 operation
+ 계정 Capability 필요 operation
+ 광고상품/계약 필요 operation
+ 내부·비공개 격리 operation
+ Deprecated operation
+ Unsupported operation

unclassified operation = 0
```

Raw Swagger에 존재한다는 이유만으로 운영 allowlist에 자동 등록하지 않는다.

---

## 1. 현재 시스템 기준선

현재 `smartstore-bridge v0.4.0`:

- Google Drive 전체 쓰기
- HAAR Drive 루트 경계 검사
- 퀸실버 카탈로그 온디맨드 다운로드·캐시
- 네이버 커머스API 공식 인덱스 115개 operation gateway
- 상품 등록·수정·삭제·상세페이지 교체·롤백
- 주문·발주·발송·취소·반품·교환·문의·정산
- HTTP API·OpenAPI·CLI·MCP
- 비동기 작업·멱등성 키·확인 문구·감사 원장

상품 데이터 기준:

- 고유 상품 1,515개
- 상품 JSON 1,515개
- 이미지 31,473개
- 약 12.89GB

SearchAd는 기존 Commerce와 Drive를 활용하지만, 인증·operation manifest·원장·보고서·자동화는 독립 모듈로 구현한다.

---

## 2. 공식 소스와 스펙 고정

### 2.1 공식 스펙 기준

네이버 공식 `naver/searchad-apidoc` 저장소의 `gh-pages` 브랜치를 기준으로 한다.

초기 기준 커밋:

```text
8e250490ab748367a627213f7d7a2917e005cb10
```

공식 문서 애플리케이션이 로드하는 Swagger 번들:

```text
assets/json/ncc-heroes-ncc.json
assets/json/ncc-heroes-tool.json
assets/json/ncc-heroes-billing.json
assets/json/atower.json
assets/json/ncc-report.json
assets/json/master-report.json
assets/json/ncc-keywordstool.json
assets/json/estimate.json
assets/json/ncc-inspect-history.json
```

공식 추가 소스:

```text
NaverSA_API_Error_Code_MAP.md
python-sample/
java-sample/
csharp-sample/
php-sample/
_posts/ release notes and notices
ads.naver.com help pages
```

### 2.2 소스 우선순위

```text
1. 최신 공식 공지·도움말
2. 공식 릴리스 노트
3. 공식 Swagger
4. 공식 샘플
5. 공식 오류 코드 맵
6. HAAR 실제 계정 Passive Probe
7. HAAR 전용 Active Canary
```

상위 소스와 하위 소스가 충돌하면 상위 소스를 따른다. 충돌은 correction registry에 기록한다.

### 2.3 스펙 버전 산출물

```text
specs/naver-searchad/
├─ source/
│  ├─ swagger/*.json
│  ├─ notices/*.md
│  ├─ samples/
│  └─ error-code-map.md
├─ corrections/
│  ├─ README.md
│  ├─ path-overrides.yaml
│  ├─ parameter-overrides.yaml
│  ├─ operation-lifecycle.yaml
│  ├─ tag-visibility.yaml
│  └─ report-schema-overrides.yaml
├─ versions/<spec-sha>/
│  ├─ raw-operation-manifest.json
│  ├─ public-operation-manifest.json
│  ├─ definitions.json
│  ├─ report-types.json
│  ├─ report-schemas.json
│  ├─ checksums.json
│  └─ coverage.json
├─ current.json
└─ coverage.json
```

---

## 3. Operation 분류 모델

모든 Swagger `path × method`를 먼저 Raw manifest에 넣고, 이후 실행 가능성을 분류한다.

### 3.1 상태

```text
implemented_verified
- 공식 근거 + 실제 계정 성공 + 계약 테스트

implemented_live_unverified
- 구현 완료, 실제 HAAR 계정 미검증

capability_required
- 계정별 실제 호출 증거 필요

ad_product_required
- 특정 광고상품 사용 조건 필요

contract_required
- 계약형 광고·브랜드·특수 기능 조건 필요

permission_required
- Principal 또는 Customer 권한 필요

public_documentation_pending
- Swagger에 있으나 공개 문서 근거 부족

internal_quarantined
- 공식 UI에서 숨김 또는 내부 성격

deprecated
- 공식 종료 또는 신규 사용 중단

unsupported
- 현재 공개 API에서 지원하지 않음
```

### 3.2 원천 분류

```text
rawSwaggerOperations
publicDocumentedOperations
sampleVerifiedOperations
releaseNoteVerifiedOperations
capabilityGatedOperations
adProductGatedOperations
contractGatedOperations
internalExcludedOperations
deprecatedOperations
unsupportedOperations
unclassifiedOperations
```

### 3.3 런타임 allowlist

다음만 기본 allowlist 후보가 된다.

```text
publicDocumented
sampleVerified
releaseNoteVerified
liveCapabilityVerified
```

`internal_quarantined`, `public_documentation_pending`, `deprecated`, `unsupported`는 generic operation gateway 실행 대상이 아니다.

### 3.4 공식 UI 숨김 태그

공식 문서 UI 설정에서 숨김 처리된 태그는 초기값을 `internal_quarantined`로 둔다.

초기 Seed 예:

```text
accesscontrol
advancedreportcontroller
apiapikey
apicustomerauth
apihistory
apikeys
apilicenses
apimyclientscontroller
auth
columncontroller
customer
customerauth
customerlinks
history
managercandidates
nccmanagedkeyword
internal controller/endpoint tags
```

관리 키워드(`ManagedKeyword`)도 실제 계정 성공 근거 전에는 일반 기능으로 노출하지 않는다.

---

## 4. Spec Correction Registry

공식 Swagger를 코드에서 몰래 보정하지 않는다. 모든 보정은 파일에 근거와 유효기간을 기록한다.

### 4.1 공통 필드

```yaml
id:
sourceFile:
rawOperationId:
rawMethod:
rawPath:
normalizedMethod:
normalizedPath:
reason:
officialEvidence:
effectiveFrom:
effectiveTo:
reviewedAt:
reviewedBy:
status:
```

### 4.2 초기 보정 규칙

#### Base URL

```text
Swagger host 값이 빈 문자열, localhost, 사설 IP, demo 도메인이어도 무시
실제 요청 Base URL:
https://api.searchad.naver.com
```

#### Path

```text
/api 접두사 제거
/api/ncc/campaigns → /ncc/campaigns
```

#### 비표준 URI template

```text
/ncc/campaigns{?baseSearchId,recordSize,selector}
→ path: /ncc/campaigns
→ query: baseSearchId, recordSize, selector
```

#### Path parameter required

Path에 포함된 `{id}` 파라미터가 Swagger에서 `required: false`여도 런타임 validator에서는 필수로 보정한다.

#### Query variant

동일 method·path라도 `fields`, `ids`, `ownerId`, `nccLabelId` 등 의미가 다른 variant는 별도 `operationKey`로 만든다.

### 4.3 변경 관리

- correction 변경은 코드 리뷰 필수
- 공식 근거 URL 필수
- Correction 적용 전·후 operation diff 생성
- 근거가 사라지거나 공식 스펙이 수정되면 correction을 종료
- `current.json`은 correction 적용 결과만 참조

---

## 5. 공식 기능 범위

## 5.1 인증·계정

- HMAC-SHA256 서명
- Access License·Secret Key·Customer ID
- Principal 1 : Customer N
- 광고계정
- 관리계정
- 하위 광고계정
- 계정 구성원·권한
- 다중 Customer 전환
- 서버 시각 편차
- Secret 회전 상태
- 인증 진단

요청 헤더:

```http
X-Timestamp: <epoch milliseconds>
X-API-KEY: <access license>
X-Customer: <customer id>
X-Signature: <base64 hmac-sha256>
```

서명 원문:

```text
{timestamp}.{HTTP_METHOD}.{URI_PATH}
```

query string은 서명 원문에 포함하지 않는 공식 샘플 계약을 고정 테스트로 검증한다.

## 5.2 비즈머니·청구

- 잔액
- 사용 가능·잠금 상태
- 충전·소진 내역
- 기간별 내역
- 청구 수신자 이력
- 청구 문서
- 잔액 임계치
- 예상 소진일
- 예산 상향 전 잔액 검사

비즈머니 충전·결제는 별도 공식 API와 권한이 확인되기 전까지 조회만 제공한다.

## 5.3 캠페인

- 목록·단건·페이지 조회
- 생성·수정·삭제 처리
- ON/OFF
- 기간
- 추적 URL·추적 모드
- 캠페인 유형별 필드
- 일예산
- 공유예산
- 다건 변경
- 쇼핑검색 URL 커스텀 파라미터
- 계약형 캠페인 조건부 지원

## 5.4 광고그룹

- 목록·단건·페이지 조회
- 생성·수정·삭제 처리
- ON/OFF
- 일예산
- 기본 입찰가
- 네트워크·디바이스 가중치
- 타게팅
- 공유예산
- 소재·키워드·상품그룹 연결
- 자동입찰
- 다건 변경

쇼핑검색 전환목표 자동입찰은 다음 Validator 조건을 강제한다.

```text
campaign type = Shopping Search
adgroup type = Online store product type
conversion logs = collecting
property = autobidStrategy
capability = supported
```

AI Ads 마스터 필드가 존재한다는 이유만으로 AI Ads 쓰기 기능을 자동 활성화하지 않는다.

## 5.5 키워드

- 목록·단건·다건 조회
- 생성·수정·삭제 처리
- ON/OFF
- 입찰가
- PC·모바일 URL
- 품질·검수 상태
- 대량 등록·대량 변경
- 검색어 기반 신규 후보
- 제외 키워드 후보·등록
- 중복·유사어 정규화

`ManagedKeyword`는 초기 `internal_quarantined`다.

## 5.6 광고·소재

공식 광고상품과 Capability가 지원하는 범위:

- 텍스트 소재
- 쇼핑상품 소재
- 카탈로그 소재
- RSA·자산·연결
- 브랜드 관련 조회 객체
- 병의원 소재
- 썸네일·배너
- 목록·단건·다건
- 생성·수정·복사·삭제 처리
- ON/OFF
- 기간
- 랜딩 URL
- 검수 상태·사유
- 이미지 검증

공식 공지에서 생성 불가로 명시된 유형은 조회만 지원한다.

예:

```text
SHOPPING_BRAND business channel create = unsupported
SHOPPING_BRAND_AD create = unsupported
일부 Shopping Brand extension create = unsupported
```

## 5.7 확장소재

- 목록·단건·다건
- owner별·label별 조회
- 생성·수정·삭제 처리
- ON/OFF
- 기간
- 다건 변경
- 이미지형 확장소재
- 검수 상태

### 이미지 Validator

```text
지원 MIME: image/jpeg, image/jpg, image/png
최대 원본 크기: 5MB
고정 크기: 214 × 214
Header: data:MIME;filename:<name>;base64,<data>
POWER_LINK_IMAGE: 최대 1개
IMAGE_SUB_LINKS: 최대 3개
생성 endpoint: /ncc/ad-extensions/create
```

필수 validator:

```text
validateImageMime
validateImageBytes
validateImageDimensions
validateDataUriHeader
validateFilename
validateExtensionImageCount
```

## 5.8 비즈채널

- 목록·단건
- 지원 유형 생성·수정·삭제 처리
- 검수·재검수
- 상태·거절 사유
- 광고그룹·소재 연결

광고상품·채널 유형별 생성 지원 Matrix를 사용한다.

## 5.9 타게팅·Criterion·Target

- 시간·요일
- 지역·반경
- 연령·성별
- 디바이스·매체·네트워크
- 오디언스
- 입찰 가중치
- 조회·생성·수정·삭제 처리
- 다건 변경
- 충돌·중복 검사

## 5.10 공유예산·계약

- 공유예산 조회·생성·수정·삭제 처리
- 캠페인·그룹 연결
- 연결 객체 역조회
- 시간 계약
- 브랜드 계약 등 공식 객체
- 기간·금액·계약 조건

계약형 기능은 `contract_required`로 시작한다.

## 5.11 라벨·참조

- 라벨 조회·생성·수정·삭제 처리
- 라벨 참조 연결·해제
- 라벨 기반 객체 조회
- 내부 운영 태그 매핑

## 5.12 상품그룹·쇼핑상품·카탈로그

- 상품그룹 조회·생성·수정·삭제 처리
- 구성원
- 쇼핑상품·NVMID 참조
- 광고그룹 연결
- 스마트스토어 상품 N:M 매핑
- 품절·판매중지·재고 회복 동기화

## 5.13 Tool API

“모든 기능” Coverage에 다음을 별도 포함한다.

### Analytics Service

- 서비스 신청
- 해지
- 전환일 변경
- 해지 취소
- 서비스 현황

### Documents

- 서류 목록
- 서류 등록
- 파일 업로드
- 상태·검수 결과

### IP Exclusions

- 사용자 제한 IP 조회
- 등록
- 변경·삭제가 공식 지원되면 조건부 추가
- 이력 조회

### Bill Recipient History

- 세금계산서 발행처 위임 일자
- 청구 수신자 이력

공식 UI에서 숨김 처리된 operation은 `internal_quarantined`로 시작하고, 공개 문서·실계정 Capability가 확인된 것만 활성화한다.

## 5.14 키워드 도구

- 연관 키워드
- PC·모바일 검색량
- 평균 클릭·CTR
- 경쟁도
- 평균 노출 광고수
- 시드 키워드·사이트·상품 기반 탐색
- 상표·금칙·중복 필터

## 5.15 입찰·성과 추정

- 최소 노출 입찰가
- 평균 순위 입찰가
- 중앙 입찰가
- 키워드별 예상 성과
- 다건 예상 성과
- 공식 NPC·Estimate 객체
- 변경 전 예상 클릭·비용
- 실제와 추정 오차

## 5.16 검수 이력

- 비즈채널
- 소재
- 확장소재
- 키워드
- Asset
- 단건·다건

공식 제한:

```text
보존/조회 범위: 최근 3개월
다건 최대: 100개
사유 없음 또는 존재하지 않는 ID: 빈 객체
empty object ≠ error
```

설정 Seed:

```text
inspectHistoryRetentionDays = 90
inspectHistoryBatchSize = 100
emptyObjectIsNotError = true
```

---

## 6. 삭제 의미

SearchAd의 DELETE를 사용자 화면과 코드에서 “영구 삭제”라고 단정하지 않는다.

정식 명칭:

```text
원격 삭제 처리
remote delete processing
```

검증:

```text
DELETE 호출
→ 재조회
→ 404 또는 delFlag=true 확인
→ delTm 기록
→ 원격 상태 저장
```

삭제 기능은 구현·활성화할 수 있지만 자동화 규칙에서는 제외한다.

확인:

```json
{
  "confirmation": "DELETE_AD_ENTITY",
  "secondConfirmation": "<customerId>:<entityId>"
}
```

---

## 7. 광고상품별 Validator Matrix

모든 생성·수정 operation은 Matrix를 통과해야 한다.

```text
campaignTp
adgroupTp
entityType
operation
createSupported
updateSupported
deleteSupported
allowedFields
requiredFields
requiredChannelTypes
requiredExtensionOwnerTypes
conversionRequired
contractRequired
capabilityRequired
imageRules
validatorVersion
effectiveFrom
effectiveTo
```

예:

```yaml
campaignTp: SHOPPING
adgroupTp: SHOPPING_MALL_PRODUCT
entityType: adgroup
operation: updateAutobid
createSupported: true
updateSupported: true
requiredFields:
  - autobidStrategy
conversionRequired: true
capabilityRequired: adgroup.autobid.shopping_conversion
```

지원되지 않는 유형은 관리자 UI·GPT Action에서 숨긴다.

---

## 8. 자격증명·계정 격리

### 8.1 Principal / Customer

```text
searchad_principals
searchad_customer_accounts
searchad_principal_grants
```

Access License와 Secret Key는 Principal 자격증명이고, `X-Customer`는 대상 광고계정이다.

### 8.2 복합키

모든 원격 엔티티는 다음 복합키를 사용한다.

```text
(customer_id, remote_entity_id)
```

예:

```sql
UNIQUE (customer_id, ncc_campaign_id)
UNIQUE (customer_id, ncc_adgroup_id)
UNIQUE (customer_id, ncc_keyword_id)
UNIQUE (customer_id, ncc_ad_id)
UNIQUE (customer_id, ncc_ad_extension_id)
```

다음도 Customer 범위에 묶는다.

```text
idempotency_key
change_plan_id
approval_id
automation_policy
budget_limit
canary_run_id
report_job_id
```

다른 광고계정의 객체를 잘못 수정하지 않도록 모든 요청에 `customerId`를 명시하고 API Key 권한에도 Customer allowlist를 둔다.

---

## 9. PostgreSQL 전환 계약

운영 보고서·쓰기·자동화 전에 PostgreSQL을 도입한다.

### 9.1 단계

```text
v0.5
- PostgreSQL schema migration 도입
- SQLite 읽기 호환 유지
- SearchAd 신규 데이터는 PostgreSQL

v0.6
- 신규 Commerce·SearchAd operation을 PostgreSQL 공통 원장에 기록
- SQLite 신규 운영 쓰기 중단

v0.7
- 기존 operation·idempotency·audit 데이터 일회성 이전
- SQLite는 로컬 개발·테스트 전용
```

### 9.2 공통 테이블

```text
platform_operations
platform_idempotency_keys
platform_audit_logs
platform_approvals
platform_execution_tokens
platform_worker_leases
platform_schema_migrations
```

### 9.3 SearchAd 테이블

```text
searchad_principals
searchad_customer_accounts
searchad_principal_grants
searchad_capability_snapshots
searchad_spec_versions
searchad_change_plans
searchad_entity_snapshots
searchad_campaigns
searchad_adgroups
searchad_keywords
searchad_ads
searchad_ad_extensions
searchad_business_channels
searchad_targets
searchad_criteria
searchad_shared_budgets
searchad_labels
searchad_label_refs
searchad_product_groups
searchad_product_group_members
searchad_report_jobs
searchad_report_files
searchad_report_rows_staging
searchad_daily_metrics
searchad_conversion_metrics
searchad_search_terms
searchad_master_snapshots
searchad_recommendations
searchad_automation_runs
searchad_profitability_snapshots
product_ad_mappings
```

### 9.4 Migration 규칙

- 모든 migration은 순방향·검증·rollback plan 포함
- schema version과 애플리케이션 버전 연결
- 운영 배포 전 backup
- Customer별 row count와 checksum 검증
- idempotency key 충돌 검사

---

## 10. ReportBlobStorage

원본 보고서를 Hostinger 임시 디스크에만 보관하지 않는다.

```text
ReportBlobStorage
├─ S3CompatibleReportStorage   # 운영 기본
├─ GoogleDriveReportArchive    # 감사·보조 백업
└─ LocalReportStorage          # 개발 전용
```

운영 흐름:

```text
원본 TSV·체크섬
→ 영속 Object Storage

파싱 임시파일
→ /tmp

정규화 결과
→ PostgreSQL

선택 감사 백업
→ HAAR Google Drive
```

### 10.1 보존 정책 기본값

```text
원본 성과·전환 보고서: 2년
원본 마스터 보고서: 2년
변경 전후 엔티티 스냅샷: 2년
감사 로그: 3년
Execution Token: 만료 후 즉시 폐기 또는 hash만 보존
임시 다운로드 URL: 저장 금지
```

보존 기간은 환경·정책 설정으로 변경 가능하다.

---

## 11. 보고서 파이프라인

```text
Report Job 생성
→ polling
→ BUILT
→ 다운로드 URL
→ 원본 저장
→ SHA-256
→ schema 선택
→ 열 수·타입 검증
→ staging
→ 정규화
→ 중복 제거
→ 집계
→ 안정화 상태 평가
```

### 11.1 상태

`finalized=true` 대신 다음 상태를 쓴다.

```text
provisional
stabilized_by_policy
changed_after_generation
quarantined
failed
```

`stabilized_by_policy`는 48시간 정책상 안정화되었다는 뜻이며 절대 불변을 의미하지 않는다.

### 11.2 스키마 레지스트리

```text
report_type
schema_version
effective_from_kst
effective_to_kst
selection_basis
expected_column_count
ordered_columns_json
value_mappings_json
source_notice
source_spec_commit
parser_version
```

선택:

```text
reportTp
+ reportCreatedAt
+ statDate
+ columnCount
+ parserVersion
```

열 수가 다르면 추측하지 않고 quarantine한다.

### 11.3 날짜 경계

```text
2025-04-09
- NAVERPAY_CONVERSION 업데이트 중단
- 2025-04-08 이후 데이터 없음

2025-05-09
- NAVERPAY_CONVERSION 과거 조회 포함 종료

2025-07-01
- 검색어 보고서 집계·검색어 유형 변경

2025-10-19
- MASTER-REPORT fileversion query 추가 시작

2025-10-27
- STAT-REPORT fileversion query 추가
- 최근 지표 최대 48시간 변경 가능

2026-03-30
- Cost VAT 기준 분기

2026-07-16
- Adgroup Master `Using Ai Ads` 필드

2026-11-16
- ADEXTENSION·ADEXTENSION_CONVERSION Business Channel ID 열 제거
- 보고서 생성시각 기준 스키마 선택
```

### 11.4 Deprecated Seed

```yaml
reportType: NAVERPAY_CONVERSION
state: deprecated
dataEndDate: 2025-04-08
updateEndDate: 2025-04-09
accessEndDate: 2025-05-09
newJobAllowed: false
historicalDownloadAllowed: false
```

### 11.5 재수집

```text
D+1 초기
D+2 재수집
D+3 재수집
48시간 이후 stabilized_by_policy 후보
데이터 변경 감지 시 새 보고서 생성
```

### 11.6 VAT

```text
reported_cost_raw
cost_vat_basis = included | excluded | unknown
normalized_cost_gross
normalized_cost_net
normalization_policy_version
```

모든 과거 데이터에 `/1.1`을 일괄 적용하지 않는다.

---

## 12. 상품·광고 연결

```text
source_product_id
→ seller_management_code
→ origin_product_no
→ channel_product_no
→ shopping_product_reference
→ product_group_id
→ adgroup_id
→ ad_id / keyword_id
```

매핑 방법:

```text
exact_seller_code
exact_channel_product_no
exact_origin_product_no
exact_shopping_reference
manual_verified
url_match
name_similarity
```

신뢰도:

```text
1.00       수동 검증 또는 정확한 ID 체인
0.90 이상  자동화 후보
0.70~0.89  분석만 허용
0.70 미만  수동 확인
```

자동화 전에 판매상태·재고·가격·대표 이미지·랜딩 URL·상세페이지 버전을 검증한다.

---

## 13. 수익성

초기부터 표시한다.

지표:

- SearchAd 귀속매출
- Commerce 결제매출
- Commerce 순매출
- 광고비
- 상품·옵션 원가
- 판매·결제 수수료
- 배송비
- 쿠폰·할인 부담
- 취소·반품 충당
- 광고 반영 공헌이익
- 공헌이익률
- 손익분기 ROAS
- 이익 ROAS
- ROAS·ACoS·CPA·CVR

상태:

```text
actual
partial
estimated
unknown
```

0원 원가로 이익을 부풀리지 않는다.

```text
광고 반영 공헌이익
= 순매출
- 원가
- 수수료
- 배송비
- 쿠폰·할인 부담
- 취소·반품 충당
- 광고비
```

---

## 14. 변경 계획·승인·Execution Token

### 14.1 Change Plan

```text
change_plan_id
customer_id
entity_type
entity_id
before_json
before_hash
requested_after_json
expected_after_hash
data_cutoff_at
reason
created_by
expires_at
```

### 14.2 Approval

```text
approval_id
change_plan_id
approved_by
approved_at
approval_expires_at
```

### 14.3 단기 실행 토큰

승인 시 다음 내용을 서명한 1회용 토큰을 발급한다.

```text
changePlanId
customerId
beforeHash
afterHash
approvalId
expiresAt
nonce
```

기본:

```text
유효기간: 10분
사용 횟수: 1회
사용 후: 폐기
```

Executor는 단순 API Key만으로 승인되지 않은 계획을 실행할 수 없다.

---

## 15. 쓰기·재시도·재조정

### 15.1 GET

- 429·502·503·504 제한 재시도
- Retry-After 우선
- exponential backoff + jitter

### 15.2 PUT/PATCH

```text
원격 현재값
→ before_hash
→ 변경
→ 재조회
→ 목표 상태 검증
```

타임아웃 후 즉시 재호출하지 않는다.

### 15.3 POST 생성

```text
unknown_outcome
→ customerId + parentId + name + fingerprint + time window 탐색
→ 0개: 제한 재실행 후보
→ 1개: 성공 reconcile
→ 2개 이상: 중복 의심·수동 확인
```

### 15.4 DELETE

- 자동 재시도 금지
- 404 또는 delFlag 검증
- 불명확하면 unknown_outcome

### 15.5 Drift

실행 직전 원격 Hash가 `expected_before_hash`와 다르면 `STALE_PLAN`으로 중단한다.

### 15.6 롤백

```text
current_hash == expected_after_hash
→ 자동 롤백 가능

current_hash != expected_after_hash
→ 다른 운영자 변경 가능
→ 자동 롤백 금지
```

---

## 16. 자동화 Circuit Breaker

기존 상한 외에 다음을 추가한다.

```dotenv
ATELIER_ADS_ENTITY_COOLDOWN_HOURS=24
ATELIER_ADS_MANUAL_CHANGE_HOLD_HOURS=24
ATELIER_ADS_MAX_INCREMENTAL_SPEND_KRW=30000
ATELIER_ADS_DAILY_LOSS_LIMIT_KRW=50000
ATELIER_ADS_MAX_CONSECUTIVE_FAILURES=3
ATELIER_ADS_MAX_UNKNOWN_OUTCOMES=3
ATELIER_ADS_POST_CHANGE_OBSERVATION_HOURS=24
ATELIER_ADS_SPEND_SPIKE_MULTIPLIER=2.0
```

Circuit Breaker:

- 연속 실패 상한 도달 → 해당 룰 중지
- unknown_outcome 상한 도달 → Customer 전체 쓰기 중지
- 일일 누적 손실 한도 도달 → 입찰·예산 상향 중지
- 광고비 급증 → 자동화 중지·알림
- 수동 변경 감지 → 엔티티 자동화 보류
- 같은 엔티티 재변경 cooldown
- 변경 후 관찰기간 동안 추가 증액 금지

---

## 17. Canary 안전 계약

이름으로 Canary 객체를 찾아 삭제하지 않는다.

```text
searchad_canary_runs
- canary_run_id
- customer_id
- created_remote_ids
- created_at
- expires_at
- initial_hashes
- final_hashes
- cleanup_status
- spend_verified_zero
```

절차:

1. `canary_run_id` 생성
2. 중지 상태 캠페인 생성
3. 반환받은 ID 저장
4. 중지 상태 재조회
5. 하드 예산 상한 검증
6. 광고그룹·키워드·소재 생성
7. ON/OFF·입찰·예산·보고서 테스트
8. 지출 0원 확인
9. 반환받은 ID만 롤백·삭제 처리
10. TTL 만료 정리

동명 객체를 이름 검색만으로 수정·삭제하지 않는다.

---

## 18. 동기화 전략

5분마다 전체 스캔하지 않는다.

```text
Master Delta 우선
editTm 기반 변경 감지
최근 변경 객체 우선
계정 규모별 adaptive interval
customer별 jitter
페이지 checkpoint
마지막 성공 cursor
```

스케줄:

```text
매 5분
- 증분 변경 확인 시작
- 비즈머니·예산 경고

매 15분
- 재고·판매상태 연동
- 자동화 정책 평가

매시간
- 당일 통계
- 예산 페이싱

매일
- D+1/D+2/D+3 보고서
- Master Delta
- 수익성·추천

매주
- Full Master
- 공식 스펙·공지 diff
```

---

## 19. HTTP API

### Reader

```http
GET /api/v1/searchad/status
GET /api/v1/searchad/spec
GET /api/v1/searchad/operations
GET /api/v1/searchad/capabilities
GET /api/v1/searchad/accounts
GET /api/v1/searchad/billing
GET /api/v1/searchad/campaigns
GET /api/v1/searchad/adgroups
GET /api/v1/searchad/keywords
GET /api/v1/searchad/ads
GET /api/v1/searchad/extensions
GET /api/v1/searchad/channels
GET /api/v1/searchad/targets
GET /api/v1/searchad/shared-budgets
GET /api/v1/searchad/product-groups
GET /api/v1/searchad/stats
GET /api/v1/searchad/reports
GET /api/v1/searchad/master-reports
GET /api/v1/searchad/inspect-history
GET /api/v1/analytics/ads/products
GET /api/v1/analytics/ads/profitability
GET /api/v1/analytics/ads/recommendations
```

### Operation Gateway

```http
POST /api/v1/searchad/operations/{operationKey}/preview
POST /api/v1/searchad/operations/{operationKey}/execute
```

Raw URL proxy는 제공하지 않는다.

### Operator

```http
POST /api/v1/searchad/capabilities/passive-probe
POST /api/v1/searchad/capabilities/active-canary
POST /api/v1/searchad/changes/plan
POST /api/v1/searchad/changes/{id}/approve
POST /api/v1/searchad/batches/plan
POST /api/v1/searchad/recommendations/{id}/accept
POST /api/v1/searchad/recommendations/{id}/reject
```

### Executor

```http
POST /api/v1/searchad/changes/{id}/execute
POST /api/v1/searchad/changes/{id}/rollback
POST /api/v1/searchad/batches/{id}/execute
POST /api/v1/searchad/entities/{type}/{id}/delete
POST /api/v1/searchad/automation/run
```

### Admin

```http
POST /api/v1/searchad/spec/sync
POST /api/v1/searchad/reports/schema/validate
POST /api/v1/searchad/reconcile
POST /api/v1/searchad/automation/pause
POST /api/v1/searchad/automation/resume
GET  /api/v1/searchad/audit
```

---

## 20. OpenAPI·GPT Action

```text
/openapi-searchad-reader.json
/openapi-searchad-operator.json
/openapi-searchad-executor.json
/openapi-searchad-admin.json
```

Reader·Operator·Executor·Admin API Key를 분리한다.

실행 응답 필수:

- Customer
- 엔티티 유형·ID·이름
- 현재값·변경값
- 예상 비용 영향
- 데이터 기준시각
- 수익성 상태
- Capability 근거
- 롤백 가능 여부
- Operation ID

비밀정보는 응답하지 않는다.

---

## 21. 환경변수 기본값과 승격

### 21.1 최초 배포 기본값

```dotenv
NAVER_SEARCHAD_BASE_URL=https://api.searchad.naver.com
NAVER_SEARCHAD_ACCESS_LICENSE=
NAVER_SEARCHAD_SECRET_KEY=
NAVER_SEARCHAD_CUSTOMER_ID=

ATELIER_SEARCHAD_GATEWAY_ENABLED=true
ATELIER_SEARCHAD_ALLOW_READS=true
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_CREATES=false
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=false
ATELIER_SEARCHAD_ALLOW_ROLLBACK=false
ATELIER_SEARCHAD_ALLOW_DELETES=false
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=false
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
```

### 21.2 검증 후 운영값

```dotenv
ATELIER_SEARCHAD_ALLOW_WRITES=true
ATELIER_SEARCHAD_ALLOW_CREATES=true
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=true
ATELIER_SEARCHAD_ALLOW_ROLLBACK=true
ATELIER_SEARCHAD_ALLOW_DELETES=true
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=true
ATELIER_SEARCHAD_AUTOMATION_MODE=auto
```

기능을 빼는 것이 아니라 시동 상태를 안전하게 두는 것이다.

---

## 22. 구현 로드맵

### S0 — 스펙 기준선

- 9개 Swagger 고정
- Raw/Public/Internal 분류
- correction registry
- lifecycle seed
- coverage

### S0.5 — 운영 인프라

- PostgreSQL migration
- 공통 operation 원장
- ReportBlobStorage
- Worker lease
- Scheduler checkpoint

### S1 — 인증·클라이언트

- HMAC
- Principal/Customer
- 오류·Rate Limit·Retry
- Secret 마스킹
- Clock diagnostics

### S2 — 공개 조회·Passive Capability

- 계정·비즈머니
- 캠페인·그룹·키워드·소재
- 확장·채널·타게팅·예산·라벨·상품그룹
- Tool API 공개 범위
- Keyword tool·Estimate·Inspect History

### S3 — 보고서·마스터

- 원본 보존
- schema registry
- lifecycle
- quarantine
- VAT
- D+1/D+2/D+3
- stabilized_by_policy

### S4 — Commerce·수익성

- 상품·광고 N:M
- 재고·판매상태
- 주문·정산·반품
- 수익성 상태

### S5 — 추천

- 키워드·검색어
- 입찰 추정
- 추천·근거·신뢰도

### S6 — 운영 수정

- ON/OFF
- 입찰·예산
- 타게팅·공유예산
- Drift
- unknown_outcome
- rollback
- execution token

### S7 — 생성·배치·삭제 처리·Canary

- 캠페인·그룹·키워드·지원 소재
- Validator Matrix
- 배치 20개
- 원격 삭제 처리
- ID 기반 Canary

### S8 — Observe·Recommend·Approve

- 정책 엔진
- Shadow Compare
- Circuit Breaker

### S9 — 제한 Auto

- 소액·소폭·고신뢰도 정책만
- 7일 관찰
- 결과 검증

### S10 — 전체 정책 Auto·UI·GPT

- 정책상 전체 활성화
- 관리자 화면
- Reader/Operator/Executor/Admin

### S11 — 운영 안정화

- 부하
- 장애 훈련
- Backup/Restore
- 장기 보관
- Runbook

---

## 23. 운영 승격 순서

```text
1. Read-only Passive Probe
2. 7일 observe
3. 7일 recommend
4. 승인형 변경
5. Active Canary
6. 제한 auto
7. 전체 정책 auto
```

각 단계는 이전 단계 완료 증거를 요구한다.

---

## 24. 완료 정의

- [ ] Raw Swagger operation이 전부 분류된다.
- [ ] Public/Internal/Conditional/Deprecated가 구분된다.
- [ ] correction registry가 적용된다.
- [ ] 미분류 operation이 0개다.
- [ ] Principal 1 : Customer N이 동작한다.
- [ ] 모든 테이블이 customer_id로 격리된다.
- [ ] PostgreSQL migration이 완료된다.
- [ ] 원본 보고서가 영속 저장된다.
- [ ] Passive Probe가 동작한다.
- [ ] Active Canary가 반환 ID만 사용한다.
- [ ] 이미지 확장소재 validator가 공식 규칙을 지킨다.
- [ ] Inspect History 90일·100개 제한을 지킨다.
- [ ] NAVERPAY_CONVERSION이 deprecated로 Seed된다.
- [ ] 보고서가 provisional/stabilized/quarantined 상태를 가진다.
- [ ] 2026-11-16 확장소재 스키마 변경을 처리한다.
- [ ] 상품·광고 N:M 매핑이 동작한다.
- [ ] 수익성이 상태·근거와 함께 표시된다.
- [ ] 승인 후 1회용 execution token을 사용한다.
- [ ] Drift·reconcile·rollback이 동작한다.
- [ ] Circuit Breaker가 동작한다.
- [ ] 원격 삭제 처리가 2단계 확인을 지킨다.
- [ ] Reader/Operator/Executor/Admin OpenAPI가 분리된다.
- [ ] Kill Switch가 즉시 동작한다.
- [ ] Secret이 로그·응답에 노출되지 않는다.
- [ ] GFA와 SearchAd 경계가 명확하다.

---

## 25. 명시적 제외·조건부

### GFA / 성과형 디스플레이광고

SearchAd와 별도다. 공개 관리 API·파트너 권한 확인 전에는:

```text
src/displayads/
```

경계만 둔다.

### 비즈머니 충전·결제

공식 쓰기 지원과 권한이 명확히 확인된 경우에만 Admin 기능으로 추가한다.

### 내부·레거시

공식 UI 숨김 또는 공개 지원 근거가 약한 operation은 구현 슬롯과 Coverage에는 포함하되 런타임 allowlist에서는 격리한다.

---

## 26. 즉시 다음 작업

문서 승인 후 개발 순서:

```text
S0
- 공식 9개 Swagger와 오류 코드 맵 고정
- correction seed 적용
- Raw/Public/Internal operation manifest
- coverage

S0.5
- PostgreSQL migration 초안
- ReportBlobStorage interface
- 공통 operation 원장

S1
- HMAC 클라이언트
- Customer 격리
- 오류·retry·rate limit
```

코드가 배포되고 자격증명이 설정되기 전에는 실제 광고계정 변경이 발생하지 않는다.

---

## Appendix A. 리뷰 해결 매핑

| 리뷰 항목 | v2.1 반영 위치 |
|---|---|
| Raw Swagger와 공개 API 분리 | 3장 |
| Spec correction registry | 4장 |
| Tool API 누락 | 5.13 |
| ManagedKeyword 격리 | 3.4, 5.5 |
| 영구 삭제 표현 | 6장 |
| 안전한 기본 환경변수 | 21장 |
| PostgreSQL migration | 9장 |
| Report storage | 10장 |
| Customer 격리 | 8장 |
| Validator Matrix | 7장 |
| 이미지 확장소재 규칙 | 5.7 |
| NAVERPAY_CONVERSION 종료 | 11.3~11.4 |
| 검수 이력 제한 | 5.16 |
| finalized 명칭 | 11.1 |
| Circuit Breaker | 16장 |
| Canary ID 추적 | 17장 |
| 단기 실행 토큰 | 14장 |
| 증분 동기화 | 18장 |
