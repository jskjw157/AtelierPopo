# HAAR / AtelierPopo 네이버 검색광고 API 전체 통합 설계·구현 계획 v2.0

> 문서 버전: 2.0  
> 작성 기준일: 2026-08-25  
> 대상 저장소: `jskjw157/AtelierPopo`  
> 기준 애플리케이션: `smartstore-bridge v0.4.0`  
> 대상 브랜드/스토어: `HAAR / 아뜰리에포포`  
> 상태: **IMPLEMENTATION READY — OWNER APPROVED FOR FULL READ/WRITE/CREATE/AUTOMATION**  
> 대체 문서: `NAVER_SEARCHAD_FULL_INTEGRATION_DESIGN_V1_1.md`의 구현 기준을 이 문서가 승계·구체화한다.

---

## 0. 문서 효력과 확정된 사용자 결정

이 문서는 네이버 검색광고 SA API 개발을 실제 코드로 착수하기 위한 최종 설계 및 작업 계획이다.

사용자 결정에 따라 다음 정책을 확정한다.

1. 공식 SearchAd API에서 확인되는 조회·생성·수정·중지·삭제·보고서·도구 기능을 가능한 범위까지 모두 구현한다.
2. 운영 광고계정에서도 캠페인·광고그룹·키워드·소재 생성, 입찰가·예산 변경, 대량 작업, 자동 롤백, 자동화 기능을 사용할 수 있게 한다.
3. 자동화 기본 모드는 최종적으로 `auto`를 지원한다.
4. 삭제 API도 구현·활성화하되, 삭제는 자동화 규칙에 넣지 않고 별도 2단계 확인을 요구한다.
5. 상품별 수익성은 초기부터 표시한다. 데이터 완결성에 따라 `actual`, `partial`, `estimated`, `unknown` 상태와 산출 근거를 함께 보존한다.
6. 지원 여부가 불명확한 기능을 임의로 가능한 것처럼 표시하지 않는다. 공식 스펙 근거와 실제 계정 Capability 증거를 분리해 저장한다.
7. SearchAd와 네이버 성과형 디스플레이광고/GFA는 별도 제품·API로 취급한다. SearchAd 자격증명으로 GFA 전체를 제어할 수 있다고 가정하지 않는다.
8. 네이버 비밀키, Access License, Customer ID, Google 자격증명은 GitHub·로그·ChatGPT 대화에 노출하지 않는다.

“모든 기능”은 다음 조건으로 정의한다.

```text
공식 SearchAd 스펙·공지·도움말에서 확인되는 기능
= 구현 완료
+ 실제 계정 검증 완료
+ 권한/상품/계약 조건으로 현재 계정에서 비활성
+ 공식 지원 범위가 불명확해 별도 격리
```

완료 시 미분류 기능은 0개여야 한다.

---

## 1. 현재 기준선

### 1.1 기존 시스템

현재 `smartstore-bridge v0.4.0`에는 다음이 존재한다.

- Google Drive 전체 쓰기 및 HAAR 루트 경계 검사
- 퀸실버 카탈로그 온디맨드 다운로드·캐시
- 네이버 커머스API 공식 인덱스 기반 115개 operation gateway
- 상품 등록·수정·삭제·상세페이지 교체·롤백
- 주문·발주·발송·클레임·문의·정산·판매자정보
- HTTP API, OpenAPI, CLI, MCP
- 비동기 Operation, 멱등성 키, 확인 문구, 감사 원장

SearchAd 구현은 이 구조를 재사용하되 Commerce 코드와 직접 섞지 않는다.

### 1.2 상품 데이터 규모

광고·상품 연결 기준선:

- 상품 1,515개
- 상품 정보 JSON 1,515개
- 이미지 31,473개
- 약 12.89GB

따라서 광고 통합은 수동으로 몇 개 캠페인을 관리하는 도구가 아니라, 1,500개 이상 상품을 매핑·분석·운영할 수 있는 구조를 전제로 한다.

---

## 2. 공식 스펙 기준선과 버전 고정

### 2.1 공식 문서 소스

SearchAd 기능 레지스트리는 네이버 공식 `naver/searchad-apidoc` 저장소의 `gh-pages` 브랜치를 기준으로 생성한다.

초기 구현 기준 커밋:

```text
8e250490ab748367a627213f7d7a2917e005cb10
2026-08-14
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

### 2.2 스펙 소스 우선순위

```text
1. 최신 공식 도움말·공지
2. 공식 gh-pages Swagger 번들
3. 공식 샘플 코드
4. 공식 오류 코드 맵
5. 실제 HAAR 광고계정 Passive Probe
6. 전용 Canary 객체 Active Probe
```

Swagger에 객체나 경로가 있다는 사실만으로 현재 모든 광고상품에서 정식 지원된다고 단정하지 않는다.

### 2.3 기능 근거 등급

```text
Tier A — Verified
- 공식 문서 근거 있음
- 실제 HAAR 계정 호출 성공
- 요청/응답 계약 테스트 보유

Tier B — Documented
- 공식 Swagger·공지·샘플에 존재
- 실제 계정 Capability 확인 필요

Tier C — Conditional
- 특정 광고상품·계약·권한·베타 조건 필요
- 호출 성공 근거가 있는 계정에서만 활성

Tier D — Quarantined
- 레거시/내부 흔적 또는 공개 지원 여부 불명확
- 코드 어댑터 슬롯만 두고 운영 호출 금지

Tier E — Deprecated
- 공식 종료·대체 공지 확인
- 신규 실행 차단, 과거 데이터 파싱만 유지
```

Capability는 단순 Boolean이 아니라 증거를 저장한다.

```json
{
  "capability": "adgroup.autobid.target_roas",
  "state": "supported",
  "tier": "C",
  "evidence": "live_canary",
  "customerId": "masked",
  "httpStatus": 200,
  "errorCode": null,
  "specCommit": "8e250490...",
  "checkedAt": "2026-08-25T00:00:00Z"
}
```

`403`, `404`, 빈 배열은 자동으로 `unsupported` 처리하지 않는다. 권한 없음, 객체 없음, 광고상품 미사용, 계약 미보유, 잘못된 파라미터를 구분한다.

---

## 3. 전체 기능 범위

## 3.1 인증·계정

- HMAC-SHA256 요청 서명
- Access License·Secret Key·Customer ID 관리
- Principal 1 : Customer N 모델
- 광고계정 목록
- 관리계정 목록
- 하위 광고계정 목록
- 계정 구성원·권한 조회
- 다중 광고계정 전환
- 서버 시각 편차 감지
- 비밀키 회전 상태 기록
- 인증·권한 진단

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

서명에는 query string이 아닌 공식 샘플 기준 URI path를 사용하며, 실제 구현 전 고정 테스트 벡터로 검증한다.

## 3.2 비즈머니·청구·문서

- 비즈머니 잔액
- 잠금·사용 가능 상태
- 충전 내역
- 소진 내역
- 기간별 내역
- 청구 수신자 이력
- 청구 문서 조회·관리
- 잔액 임계치 경고
- 예상 소진일 계산
- 예산 상향 전 잔액 검사

## 3.3 캠페인

- 목록·단건 조회
- 생성
- 전체·부분 수정
- ON/OFF
- 기간 설정
- 추적 URL·추적 모드
- 캠페인 유형별 필드
- 일예산
- 공유예산 연결
- 계약형 캠페인 지원 객체
- 삭제
- 다건 변경
- 이름·유형·상태 기반 검색

## 3.4 광고그룹

- 목록·단건 조회
- 생성·수정·삭제
- ON/OFF
- 일예산
- 기본 입찰가
- 매체·디바이스·네트워크 가중치
- 타게팅 연결
- 공유예산 연결
- 소재·키워드·상품그룹 연결
- 자동입찰 전략
- 전환 목표·목표 CPA·목표 ROAS
- AI Ads/ADVoost 관련 필드 조건부 지원
- 다건 변경

## 3.5 키워드·관리 키워드·검색어

- 키워드 목록·단건·ID 다건 조회
- 생성·수정·삭제
- ON/OFF
- 개별 입찰가
- 랜딩 URL
- PC·모바일 URL
- 품질·검수·상태
- 대량 등록·대량 변경
- 관리 키워드 조회
- 검색어 보고서 기반 신규 키워드 후보
- 제외 키워드 후보·등록
- 검색량·클릭·CTR·경쟁도
- 중복·유사어 정규화

## 3.6 광고 소재·광고

공식 객체·광고상품이 지원하는 범위에서:

- 텍스트 소재
- 쇼핑상품 소재
- 카탈로그 소재
- 브랜드 관련 소재
- RSA 및 RSA 자산·연결
- 병의원 관련 소재
- 썸네일·배너 유형
- 단건·다건 조회
- 생성·수정·복사·삭제
- ON/OFF
- 기간 설정
- 랜딩 URL
- 검수 상태·거절 사유
- 소재 템플릿
- 이미지 업로드·검증

광고상품별 생성 가능 여부는 Capability에 따라 메뉴와 Action을 노출한다.

## 3.7 확장 소재

- 목록·단건·ID 다건 조회
- 캠페인·광고그룹 owner별 조회
- 생성·수정·삭제
- ON/OFF
- 노출 기간
- 다건 변경
- 이미지·이미지 서브링크 등 지원 유형
- 검수 상태
- 2026-11-16 전후 성과·전환 보고서 스키마 분기

## 3.8 비즈채널

- 비즈채널 목록·단건 조회
- 사이트·쇼핑몰·플레이스·브랜드스토어 등 지원 유형
- 생성·수정·삭제
- 검수·재검수 요청
- 상태·거절 사유
- 광고그룹·소재 연결 관계

지원되지 않는 채널 유형은 생성 UI에서 숨긴다.

## 3.9 타게팅·Criterion·Target

- 시간대
- 요일
- 지역
- 반경
- 연령
- 성별
- 디바이스
- 매체
- 오디언스
- 네트워크
- 입찰 가중치
- 목록·생성·수정·삭제
- 다건 변경
- 충돌·중복 검사

## 3.10 공유예산·계약

- 공유예산 목록·단건 조회
- 생성·수정·삭제
- 캠페인·광고그룹 연결
- 연결 객체 역조회
- 시간 계약
- 브랜드 계약 등 공식 스펙상 계약 객체
- 기간·금액·상태 검증

## 3.11 라벨·즐겨찾기·참조

- 라벨 생성·조회·수정·삭제
- 라벨 참조 연결·해제
- 라벨 기준 캠페인·그룹·키워드·소재 조회
- 내부 운영 태그와 네이버 라벨 매핑

## 3.12 상품그룹·쇼핑상품·카탈로그

- 상품그룹 목록·단건 조회
- 생성·수정·삭제
- 상품그룹 구성원
- 쇼핑상품 연결
- 카탈로그·상품 참조
- 검색광고 객체와 스마트스토어 상품 N:M 매핑
- 품절·판매중지·재고 회복 동기화
- 상품별 광고 성과

## 3.13 실시간 통계

- 캠페인·그룹·키워드·소재 단위 통계
- 기간별 통계
- 세부 breakdown
- 노출·클릭·광고비
- CTR·CPC
- 전환·전환매출
- CVR·CPA·ROAS·ACoS
- 시간·디바이스·지역·매체별 분석
- 최신성 워터마크

## 3.14 성과 보고서

- 보고서 작업 목록
- 작업 생성
- 상태 polling
- 다운로드
- 작업 삭제
- 실패·지연 재처리
- 원본 파일 보존
- 스키마 검증
- 정규화·중복 제거

지원 보고서 유형은 공식 도움말·실제 계정 응답으로 레지스트리화한다.

핵심 범위:

- 광고 성과
- 상세 광고 성과
- 전환
- 상세 전환
- 확장소재 성과·전환
- 파워링크 검색어
- 쇼핑검색 검색어 상세·전환
- 쇼핑브랜드형 상품 성과·전환
- 타게팅 성과·전환

## 3.15 마스터 보고서

- 캠페인
- 예산·공유예산
- 비즈채널
- 광고그룹
- 키워드
- 소재
- 확장소재
- 품질·검수
- 라벨·라벨 참조
- 매체·산업 분류
- 쇼핑상품·상품그룹·카탈로그
- 썸네일·배너
- 타게팅
- RSA 자산·연결·광고
- 병의원 소재 등 공식 지원 유형
- Full·Delta 스냅샷

## 3.16 키워드 도구

- 연관 키워드
- PC·모바일 검색량
- 평균 클릭수
- 평균 CTR
- 경쟁 정도
- 월평균 노출 광고수
- 시드 키워드·사이트·상품 기반 탐색
- 신규 키워드 후보 점수화
- 상표·금칙·중복 필터

## 3.17 입찰·성과 추정

공식 estimate Swagger 범위에 따라:

- 최소 노출 입찰가
- 평균 순위 입찰가
- 중앙 입찰가
- 키워드별 예상 성과
- 다건 예상 성과
- NPC 등 공식 스펙상 예상 성과 객체
- 입찰 변경 전 예상 클릭·비용 영향
- 실제 결과와 추정 오차 추적

## 3.18 검수 이력

- 단건 검수 이력
- 다건 검수 이력
- 최근 기간 조회
- 거절 사유 분류
- 재검수 작업 연결
- 소재·키워드·채널 운영 알림

## 3.19 전환 추적 진단

API 관리 범위와 별개로 운영 진단 기능을 둔다.

- 전환 추적 사용 여부
- 전환 데이터 최근 수신 여부
- 중복 스크립트 위험 체크리스트
- 전환 목표별 수집 상태
- 전환 데이터 미수신 경고
- SearchAd 귀속 전환과 Commerce 주문 매출 분리

스크립트를 프로그램이 임의로 설치하거나 웹사이트를 수정하지 않는다.

## 3.20 공식 공지·스펙 변경 감지

- 9개 Swagger 파일 체크섬
- 공식 gh-pages 기준 커밋
- release note·notice 변경
- 경로·메서드·파라미터·definition diff
- 보고서 열 변경
- 신규 enum
- 제거·deprecated API
- CI에서 coverage 실패
- 운영 적용 전 사람 검토

---

## 4. 목표 아키텍처

```text
ChatGPT Action / HAAR Admin / CLI / Scheduler
                     │
                     ▼
Hostinger smartstore-bridge v0.5+
  ├─ Commerce HTTP API
  ├─ SearchAd Reader API
  ├─ SearchAd Operator API
  ├─ SearchAd Executor API
  ├─ SearchAd Admin API
  ├─ Auth / Rate Limit / Request ID
  └─ Operation / Approval / Audit
                     │
                     ▼
Application Services
  ├─ SearchAdCapabilityService
  ├─ SearchAdEntitySyncService
  ├─ SearchAdReportService
  ├─ SearchAdChangePlanService
  ├─ SearchAdExecutionService
  ├─ SearchAdReconciliationService
  ├─ SearchAdRecommendationService
  ├─ SearchAdAutomationService
  ├─ ProductAdMappingService
  └─ ProfitabilityService
                     │
                     ▼
Infrastructure
  ├─ NaverSearchAdClient
  ├─ SearchAdSpecRegistry
  ├─ NaverCommerceClient
  ├─ GoogleDriveCatalogProvider
  ├─ PostgreSQL
  ├─ Object/File Storage
  ├─ Scheduler / Worker Queue
  └─ Structured Audit Log
```

### 4.1 실행 구조

초기에는 모듈형 모놀리스로 배포한다.

```text
API Process
- HTTP/OpenAPI
- 읽기 요청
- 변경 계획 작성
- 작업 접수

Worker Process
- 보고서 다운로드·파싱
- 쓰기 실행
- 원격 결과 검증
- reconcile·rollback

Scheduler Process
- entity sync
- report D+1/D+2/D+3
- 예산 페이싱
- 자동화 평가
- 스펙 변경 검사
```

단일 Hostinger 인스턴스에서는 하나의 Node 프로세스 안에서 역할을 분리할 수 있지만, 쓰기·보고서 적재가 시작되면 PostgreSQL lease를 사용한다.

---

## 5. 목표 코드 구조

```text
smartstore-bridge/
├─ specs/naver-searchad/
│  ├─ source/
│  │  ├─ swagger/*.json
│  │  ├─ notices/*.md
│  │  └─ error-code-map.md
│  ├─ versions/<spec-sha>/
│  │  ├─ operation-manifest.json
│  │  ├─ definitions.json
│  │  ├─ report-types.json
│  │  ├─ report-schemas.json
│  │  └─ checksums.json
│  ├─ current.json
│  └─ coverage.json
├─ src/naver/searchad/
│  ├─ auth.js
│  ├─ client.js
│  ├─ errors.js
│  ├─ rate-limit.js
│  ├─ spec-registry.js
│  ├─ gateway.js
│  ├─ capability.js
│  ├─ entities/
│  ├─ billing/
│  ├─ reports/
│  ├─ master-reports/
│  ├─ keyword-tool/
│  ├─ estimates/
│  └─ inspect-history/
├─ src/application/searchad/
│  ├─ account-service.js
│  ├─ sync-service.js
│  ├─ report-service.js
│  ├─ change-plan-service.js
│  ├─ execution-service.js
│  ├─ reconciliation-service.js
│  ├─ recommendation-service.js
│  ├─ automation-service.js
│  ├─ mapping-service.js
│  └─ profitability-service.js
├─ src/http/searchad/
│  ├─ routes-reader.js
│  ├─ routes-operator.js
│  ├─ routes-executor.js
│  ├─ routes-admin.js
│  └─ openapi.js
├─ src/workers/searchad/
├─ src/schedulers/searchad/
├─ scripts/
│  ├─ searchad-spec-sync.mjs
│  ├─ searchad-coverage.mjs
│  ├─ searchad-report-schema-check.mjs
│  └─ searchad-remote-smoke.mjs
└─ test/searchad-*.test.js
```

Commerce와 SearchAd는 공통 `api_operations` 개념을 공유할 수 있지만, SearchAd 전용 상세 원장은 별도로 둔다.

---

## 6. 공식 operation manifest

### 6.1 생성 규칙

9개 Swagger 파일의 모든 `paths × methods`를 읽어 중앙 manifest를 생성한다.

```json
{
  "operationKey": "ncc.campaign.create",
  "sourceFile": "ncc-heroes-ncc.json",
  "sourceOperationId": "addUsingPOST_...",
  "method": "POST",
  "rawPath": "/api/ncc/campaigns",
  "normalizedPath": "/ncc/campaigns",
  "domain": "campaign",
  "action": "create",
  "sideEffect": true,
  "destructive": false,
  "batch": false,
  "tier": "B",
  "requiredCapability": "campaign.create",
  "confirmation": "CREATE_AD_ENTITY",
  "retryPolicy": "reconcile-before-retry",
  "specCommit": "8e250490..."
}
```

### 6.2 경로 정규화

공식 Swagger의 표현을 실제 요청 형식으로 변환한다.

- `/api` 접두사 제거 규칙
- `{?fields}`, `{?ids}`, `{?ownerId}`를 query parameter로 변환
- 동일 path·method의 query variant를 operationKey로 분리
- Swagger 2.0 body·formData·query·path를 통합 요청 모델로 정규화
- multipart·Base64 이미지 입력 구분

### 6.3 Coverage 합격 조건

```text
sourceOperations == classifiedOperations
classifiedOperations == implemented + capabilityGated + quarantined + deprecated
unclassifiedOperations == 0
duplicateOperationKeys == 0
unknownDefinitions == 0
```

공식 operation 수는 문서에 고정 숫자로 박지 않고 spec sync 결과에서 계산한다.

---

## 7. 자격증명·다중 계정 모델

```text
searchad_principals
- principal_id
- access_license_secret_ref
- secret_key_secret_ref
- status
- created_at
- secret_rotated_at
- last_auth_success_at

searchad_customer_accounts
- customer_id
- account_name
- currency
- timezone
- status
- manager_customer_id
- last_synced_at

searchad_principal_grants
- principal_id
- customer_id
- role
- capability_snapshot_id
- verified_at
```

Access License·Secret Key는 호출 Principal의 자격증명이고, `X-Customer`는 대상 광고계정이다. 광고계정마다 무조건 별도 키를 저장하는 모델로 만들지 않는다.

### 7.1 시각 안정성

- 서버 NTP 상태 검사
- 서명 직전 epoch milliseconds 생성
- 허용 시각 편차 진단
- `Invalid Signature` 발생 시 자동 쓰기 재시도 금지
- URI path·메서드·timestamp·서명 입력을 민감정보 없이 감사 로그에 저장

---

## 8. Capability Probe

### 8.1 Passive Probe

운영 연결 직후 자동 실행 가능:

- 계정·구성원
- 비즈머니
- 캠페인·그룹·키워드·소재
- 비즈채널·타게팅·공유예산·라벨
- 보고서·마스터 보고서 목록
- 키워드 도구
- estimate
- 검수 이력

Passive Probe는 원격 객체를 만들거나 수정하지 않는다.

### 8.2 Active Canary

사용자 승인 정책에 따라 실제 운영계정에서도 실행할 수 있다.

전용 객체:

```text
[HAAR_API_CANARY] Campaign
[HAAR_API_CANARY] Adgroup
[HAAR_API_CANARY] Keyword
[HAAR_API_CANARY] Creative
[HAAR_API_CANARY] Extension
```

Canary 절차:

1. 중지 상태 캠페인 생성
2. 중지 상태 그룹 생성
3. 최소 요건 키워드·소재 생성
4. 낮은 입찰가·예산 설정
5. ON/OFF 왕복
6. 입찰가·예산 변경
7. 보고서 Job 생성·polling·다운로드
8. 원격 상태 재조회
9. 롤백
10. 삭제 또는 중지 상태 보존

Canary가 실제 노출·과금되지 않도록 생성 직후 중지 상태와 예산 상한을 확인한다.

---

## 9. 데이터 모델

운영 쓰기·보고서 적재 전 PostgreSQL을 사용한다.

### 9.1 핵심 테이블

```text
searchad_principals
searchad_customer_accounts
searchad_principal_grants
searchad_capability_snapshots
searchad_spec_versions
searchad_operations
searchad_change_plans
searchad_approvals
searchad_entity_snapshots
searchad_campaigns
searchad_adgroups
searchad_keywords
searchad_ads
searchad_ad_extensions
searchad_business_channels
searchad_criteria
searchad_targets
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

### 9.2 타입

```text
광고비·매출·원가·수수료: BIGINT KRW
비율·ROAS·CTR·CVR: DECIMAL
원격 시각: TIMESTAMPTZ
통계 기준일: DATE, timezone=Asia/Seoul
원시 응답: JSONB
원본 보고서 체크섬: SHA-256
상태 Hash: SHA-256 canonical JSON
```

### 9.3 스냅샷

모든 변경 대상은 최소 다음을 보존한다.

```text
before_json
before_hash
after_requested_json
after_expected_hash
after_remote_json
after_remote_hash
spec_version
data_cutoff_at
actor
reason
```

---

## 10. 보고서 수집·파싱

## 10.1 파이프라인

```text
Report Job 생성
→ polling
→ BUILT 확인
→ 다운로드 URL 확인
→ 원본 TSV 저장
→ SHA-256
→ report schema 선택
→ 열 수·타입 검증
→ staging
→ 정규화
→ 중복 제거
→ 집계 갱신
→ finalized 상태 평가
```

원본 보고서는 재현성과 사양 변경 대응을 위해 삭제하지 않는다.

## 10.2 스키마 레지스트리

```text
report_schema_registry
- report_type
- schema_version
- effective_from_kst
- effective_to_kst
- selection_basis
- expected_column_count
- ordered_columns_json
- value_mappings_json
- source_notice
- source_spec_commit
- parser_version
```

선택 키:

```text
reportTp
+ reportCreatedAt
+ statDate
+ columnCount
+ parserVersion
```

열 수가 맞지 않으면 자동 추측하지 않고 quarantine한다.

## 10.3 반드시 반영할 날짜 경계

```text
2025-07-01
- 검색어 보고서 집계/키워드 유형 변경 대응

2025-10-27
- 최근 지표가 최대 48시간 내 변경될 수 있음
- D+1/D+2/D+3 재수집

2026-03-30
- Cost VAT 포함/미포함 기준 분기

2026-07-16
- 광고그룹 마스터 AI Ads 관련 필드 대응

2026-11-16
- ADEXTENSION, ADEXTENSION_CONVERSION
- Business Channel ID 열 제거
- 이후 열 순서 이동
- 기준일이 아니라 보고서 생성시각으로 스키마 선택
```

## 10.4 재수집

```text
D+1 초기 적재
D+2 재적재
D+3 재적재
48시간 이후 finalized 후보
데이터 변경됨 상태면 새 보고서 생성
지연·장애 시 exponential backoff와 운영 알림
```

## 10.5 광고비 정규화

```text
reported_cost_raw
cost_vat_basis = included | excluded | unknown
normalized_cost_gross
normalized_cost_net
normalization_policy_version
```

모든 과거 데이터에 일괄 `/1.1`을 적용하지 않는다.

---

## 11. Commerce·Drive·SearchAd 연결

퀸실버 상품 1,515개와 스마트스토어·광고 객체를 N:M으로 연결한다.

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

### 11.1 매핑 방법

```text
exact_seller_code
exact_channel_product_no
exact_origin_product_no
exact_shopping_reference
manual_verified
name_similarity
url_match
```

### 11.2 신뢰도

```text
1.00  수동 검증 또는 정확한 ID 체인
0.90+ 자동화 허용 후보
0.70~0.89 분석만 허용
0.70 미만 수동 확인
```

임계치는 정책에서 조정한다.

### 11.3 상세페이지와 광고 랜딩

HAAR 상세페이지 완성본이 스마트스토어 상품에 반영되면:

- 광고 랜딩 URL 유효성
- 판매상태
- 재고
- 상품명·가격
- 대표 이미지
- 상세페이지 버전

을 광고 자동화 입력으로 사용한다.

---

## 12. 수익성

초기부터 화면에 표시하되 상태를 숨기지 않는다.

### 12.1 계산 요소

- SearchAd 귀속매출
- Commerce 결제매출
- Commerce 순매출
- 광고비
- 공급가·옵션 원가
- 판매·결제 수수료
- 배송비 부담
- 쿠폰·할인 부담
- 취소·반품 충당
- 광고 반영 공헌이익
- 공헌이익률
- 손익분기 ROAS
- 이익 ROAS

### 12.2 상태

```text
actual
- 정산·원가·주문·취소·반품 확정

partial
- 일부 실제값 + 일부 정책값

estimated
- 공급가·옵션 추가금·기본 수수료 정책 기반

unknown
- 핵심 입력 누락으로 계산 불가
```

### 12.3 계산식

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
손익분기 ROAS = 1 / 광고비 제외 공헌이익률 × 100
ACoS = 광고비 / 귀속매출 × 100
이익 ROAS = 광고 반영 공헌이익 / 광고비 × 100
```

0원 원가로 임의 계산하지 않는다.

---

## 13. 추천 엔진

추천은 근거·기준시각·예상 영향·신뢰도를 포함한다.

### 13.1 규칙 기반

- 품절 광고 중지
- 판매중지 상품 광고 중지
- 재고 회복 광고 재개
- 무전환 고지출 키워드 감액
- 저CTR·충분한 노출 소재 교체 후보
- 고ROAS·재고 충분 키워드 증액
- 예산 조기 소진 캠페인 페이싱
- 비즈머니 부족 경고
- 검색어 기반 신규 키워드
- 무전환 검색어 제외 키워드
- 검수 거절 소재 수정 후보
- 랜딩 상품 상태 불일치

### 13.2 통계 조건

- 최소 노출
- 최소 클릭
- 최소 전환 표본
- 데이터 finalized 여부
- 최근 7/14/30일 비교
- 요일·시즌성
- 신상품 cold start
- 이상치 제외

### 13.3 추천 객체

```json
{
  "recommendationId": "...",
  "type": "DECREASE_KEYWORD_BID",
  "entityId": "...",
  "currentValue": 300,
  "proposedValue": 250,
  "reason": "7일 광고비 25000원, 전환 0",
  "dataCutoffAt": "...",
  "confidence": 0.83,
  "expectedImpact": {},
  "profitabilityState": "estimated"
}
```

---

## 14. 자동화 엔진

최종 운영 모드는 `auto`를 지원한다.

### 14.1 모드

```text
observe
- 조회·수집만

recommend
- 추천 생성, 실행 없음

approve
- 사용자 승인된 계획만 실행

auto
- 정책 허용 범위 내 자동 계획·실행·검증·롤백
```

### 14.2 자동 실행 가능 작업

- 품절·판매중지 광고 중지
- 재고 회복 광고 재개
- 입찰가 소폭 상하향
- 캠페인·그룹 예산 페이싱
- 목표 ROAS 기반 소폭 예산 조정
- 검색어 기반 키워드 생성
- 제외 키워드 등록
- 템플릿 기반 캠페인·그룹·키워드·소재 생성
- 실패·성과 급락 시 조건부 롤백

### 14.3 자동 실행 제외

- 영구 삭제
- 소유권·계정 권한 변경
- 비즈머니 결제·충전
- 상한을 넘는 예산 상향
- Capability 미검증 광고상품
- 매핑 신뢰도 미달 상품

### 14.4 실행 전 조건

```text
report_schema_valid=true
metrics_finalized=true 또는 정책상 허용
product_mapping_confidence >= threshold
inventory_freshness <= threshold
commerce_watermark >= data_cutoff_at
remote_before_hash == expected_before_hash
capability.state == supported
remaining_budget >= safety_floor
```

조건 미달 시 `recommend`로 강등한다.

### 14.5 기본 제한

```dotenv
ATELIER_ADS_MAX_BID_CHANGE_PERCENT=20
ATELIER_ADS_MAX_BUDGET_CHANGE_PERCENT=20
ATELIER_ADS_MAX_DAILY_BUDGET_KRW=100000
ATELIER_ADS_MAX_BATCH_SIZE=20
ATELIER_ADS_MAX_DAILY_OPERATIONS=200
ATELIER_ADS_MIN_CONVERSION_SAMPLE=3
ATELIER_ADS_MAX_UNKNOWN_OUTCOMES=3
```

---

## 15. 쓰기·재시도·멱등성·재조정

로컬 `idempotencyKey`는 네이버 원격 멱등성을 보장하지 않는다.

## 15.1 GET

- 429·502·503·504 제한 재시도
- `Retry-After` 우선
- exponential backoff + jitter

## 15.2 PUT 상태 변경

```text
현재값 조회
→ before_hash
→ PUT
→ 원격 재조회
→ 목표 상태 확인
```

타임아웃이면 PUT을 바로 재호출하지 않고 원격 상태를 먼저 조회한다.

## 15.3 POST 생성

타임아웃 시:

```text
status=unknown_outcome
→ 부모 ID + 이름 + 요청 fingerprint + 생성시각으로 탐색
→ 0개: 제한 재실행 후보
→ 1개: 성공 reconcile
→ 2개 이상: 중복 의심, 사람 확인
```

## 15.4 DELETE

- 자동 재시도 금지
- 삭제 후 조회로 확인
- 결과 불명확 시 `unknown_outcome`

## 15.5 Drift

변경 계획:

```text
expected_before_hash
expected_after_hash
plan_data_cutoff_at
approved_at
approval_expires_at
```

실행 직전 원격 Hash가 달라졌으면 `STALE_PLAN`으로 중단하고 새 계획을 만든다.

## 15.6 롤백

```text
current_hash == expected_after_hash
→ 자동 롤백 가능

current_hash != expected_after_hash
→ 다른 운영자 변경 가능
→ 자동 롤백 금지
```

---

## 16. HTTP API

## 16.1 Reader

```http
GET  /api/v1/searchad/status
GET  /api/v1/searchad/spec
GET  /api/v1/searchad/operations
GET  /api/v1/searchad/capabilities
GET  /api/v1/searchad/accounts
GET  /api/v1/searchad/billing
GET  /api/v1/searchad/campaigns
GET  /api/v1/searchad/adgroups
GET  /api/v1/searchad/keywords
GET  /api/v1/searchad/ads
GET  /api/v1/searchad/extensions
GET  /api/v1/searchad/channels
GET  /api/v1/searchad/targets
GET  /api/v1/searchad/shared-budgets
GET  /api/v1/searchad/product-groups
GET  /api/v1/searchad/stats
GET  /api/v1/searchad/reports
GET  /api/v1/searchad/master-reports
GET  /api/v1/searchad/inspect-history
GET  /api/v1/analytics/ads/products
GET  /api/v1/analytics/ads/profitability
GET  /api/v1/analytics/ads/recommendations
```

## 16.2 Operation Gateway

공식 manifest의 operationKey만 호출한다.

```http
POST /api/v1/searchad/operations/{operationKey}/preview
POST /api/v1/searchad/operations/{operationKey}/execute
```

임의 URL·메서드를 받는 raw proxy는 제공하지 않는다.

## 16.3 Operator

```http
POST /api/v1/searchad/capabilities/passive-probe
POST /api/v1/searchad/capabilities/active-canary
POST /api/v1/searchad/changes/plan
POST /api/v1/searchad/changes/{changePlanId}/approve
POST /api/v1/searchad/batches/plan
POST /api/v1/searchad/recommendations/{id}/accept
POST /api/v1/searchad/recommendations/{id}/reject
```

## 16.4 Executor

```http
POST /api/v1/searchad/changes/{changePlanId}/execute
POST /api/v1/searchad/changes/{changePlanId}/rollback
POST /api/v1/searchad/batches/{batchId}/execute
POST /api/v1/searchad/entities/{entityType}/{entityId}/delete
POST /api/v1/searchad/automation/run
```

## 16.5 Admin

```http
POST /api/v1/searchad/spec/sync
POST /api/v1/searchad/reports/schema/validate
POST /api/v1/searchad/reconcile
POST /api/v1/searchad/automation/pause
POST /api/v1/searchad/automation/resume
GET  /api/v1/searchad/audit
```

---

## 17. 확인 문구와 권한

### 17.1 역할

```text
SearchAd Reader
SearchAd Operator
SearchAd Executor
SearchAd Admin
```

### 17.2 확인 문구

```text
일반 수정        UPDATE_AD_ENTITY
신규 생성        CREATE_AD_ENTITY
대량 실행        EXECUTE_AD_BATCH
자동화 활성화    ENABLE_AD_AUTOMATION
롤백             ROLLBACK_AD_CHANGE
삭제             DELETE_AD_ENTITY
Canary            RUN_SEARCHAD_CANARY
```

삭제 요청:

```json
{
  "confirmation": "DELETE_AD_ENTITY",
  "secondConfirmation": "<entityId>"
}
```

---

## 18. ChatGPT Action

OpenAPI를 분리한다.

```text
/openapi-searchad-reader.json
/openapi-searchad-operator.json
/openapi-searchad-executor.json
/openapi-searchad-admin.json
```

### 18.1 Reader Action

- 현황·성과·수익성·추천
- 비즈머니
- 캠페인·그룹·키워드·소재
- 보고서 상태

### 18.2 Operator Action

- Capability Probe
- 변경안 작성
- 예상 영향
- 승인

### 18.3 Executor Action

- 승인된 실행
- 배치
- 롤백
- 사용자 결정에 따라 연결 가능

### 18.4 응답 필수 필드

- 광고계정
- 엔티티 ID·이름·유형
- 현재값·변경값
- 예상 비용 영향
- 데이터 기준시각
- 수익성 상태
- Capability 근거
- 롤백 가능 여부
- Operation ID

비밀정보는 절대 응답하지 않는다.

---

## 19. 관리자 UI

## 19.1 대시보드

- 오늘·7일·30일 광고비
- 귀속매출·Commerce 매출
- ROAS·ACoS·CPA·CVR
- 실제 수익성 및 상태
- 비즈머니 잔액·예상 소진일
- 예산 페이싱
- 품절 광고
- 검수 거절
- 보고서 지연·격리
- 자동화 실행·실패·unknown outcome

## 19.2 계층 탐색

```text
Account
└─ Campaign
   └─ Adgroup
      ├─ Keyword
      ├─ Ad/Creative
      ├─ Extension
      ├─ Target
      └─ Product Group
```

## 19.3 상품별 화면

- Drive 원본
- 스마트스토어 상품
- 광고 객체 연결
- 재고·판매상태
- 검색어·키워드·소재
- 광고비·귀속매출·순매출
- 공헌이익·손익분기 ROAS
- 변경·자동화 이력

## 19.4 운영 제어

- 전체 Kill Switch
- 모드 전환
- 예산·입찰 상한
- 계정별 자동화 허용
- Capability
- Canary
- Batch
- reconcile
- rollback

---

## 20. 보안·개인정보·감사

### 20.1 Secret

Hostinger Secret 또는 전용 Secret Manager에만 저장:

- SearchAd Access License
- SearchAd Secret Key
- Customer ID
- Commerce Client ID·Secret
- Google 자격증명
- API Keys

### 20.2 로그 마스킹

```text
secret
signature
authorization
api key
access license
customer id 전체값
다운로드 임시 URL
개인정보
```

### 20.3 감사 로그

```text
request_id
actor
source
customer_id_masked
action
operation_key
entity_type
entity_id
before_hash
after_hash
reason
approval_id
idempotency_key
request_fingerprint
remote_status
remote_error_code
outcome
reconciliation_result
executed_at
verified_at
rollback_status
```

---

## 21. 스케줄링

```text
매 5분
- 핵심 광고 엔티티 변경 확인
- 비즈머니·예산 경고

매 15분
- 품절·판매중지 동기화
- 자동화 정책 평가

매시간
- 당일 통계 갱신
- 예산 페이싱

매일 02:00 KST
- D+1 보고서
- 마스터 Delta

매일 04:00 KST
- D+2/D+3 재수집

매일 06:00 KST
- 수익성·추천 갱신

매주
- Full master snapshot
- 공식 스펙·공지 diff
- Capability 재검증 후보
```

네이버 호출 제한과 실제 보고서 생성 시간을 기준으로 조정한다.

---

## 22. 장애 대응

| 상황 | 처리 |
|---|---|
| Invalid Signature | 서버 시각·path·method·키 점검, 쓰기 재시도 금지 |
| 401/403 | Principal·Customer grant·Capability 재검증 |
| 429 | Retry-After·백오프·큐 감속 |
| 조회 5xx | 제한 재시도 |
| 쓰기 타임아웃 | `unknown_outcome`, 원격 reconcile |
| 생성 결과 불명확 | 자연키·부모 ID·시각·fingerprint 탐색 |
| stale plan | 실행 중단·재계획 |
| 보고서 열 불일치 | quarantine·알림 |
| 보고서 생성 지연 | polling 간격 증가·SLA 경고 |
| 비즈머니 부족 | 예산·입찰 상향 차단 |
| 재고 데이터 지연 | 재고 기반 재개 보류 |
| DB 장애 | 신규 쓰기 중단·진행 작업 reconcile |
| Capability 변경 | 관련 Action·자동화 즉시 비활성 |

Kill Switch:

```dotenv
NAVER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
```

---

## 23. 테스트 전략

## 23.1 단위 테스트

- HMAC 고정 벡터
- path 정규화
- timestamp
- Swagger manifest 생성
- query variant
- Secret 마스킹
- VAT 정책
- 보고서 스키마 버전
- D+1/D+2/D+3
- Drift hash
- reconciliation
- 자동화 상한
- 롤백 조건
- 수익성 상태

## 23.2 계약 테스트

- 공식 Swagger fixture
- 공식 샘플 요청
- 신규 enum 보존
- 누락 필드 허용
- 목록·페이지네이션
- 다건 응답
- report state transition
- report download URL `fileversion` query
- 2026-11-16 전후 확장소재 파서

## 23.3 HTTP 테스트

- API Key 역할
- Reader/Operator/Executor/Admin 분리
- raw path 차단
- confirmation
- secondConfirmation
- idempotency
- body size
- rate limit
- 개인정보 마스킹

## 23.4 Live Passive Test

- 인증
- 계정
- 비즈머니
- 캠페인·그룹·키워드·소재
- 통계
- 기존 report job

## 23.5 Active Canary

- 생성
- ON/OFF
- 입찰·예산
- 보고서 생성·다운로드
- 롤백
- 삭제
- unknown outcome 시뮬레이션

## 23.6 Shadow Test

자동화 룰은 `shadowCompare=true`를 지원한다.

```text
실제 실행 결과
vs
실행하지 않았다고 가정한 결과
```

를 함께 저장해 정책을 보정한다.

---

## 24. 환경변수

```dotenv
# SearchAd 자격증명
NAVER_SEARCHAD_BASE_URL=https://api.searchad.naver.com
NAVER_SEARCHAD_ACCESS_LICENSE=
NAVER_SEARCHAD_SECRET_KEY=
NAVER_SEARCHAD_CUSTOMER_ID=

# Spec
NAVER_SEARCHAD_SPEC_REPOSITORY=naver/searchad-apidoc
NAVER_SEARCHAD_SPEC_REF=8e250490ab748367a627213f7d7a2917e005cb10
ATELIER_SEARCHAD_SPEC_AUTO_SYNC=false

# Gateway
ATELIER_SEARCHAD_GATEWAY_ENABLED=true
ATELIER_SEARCHAD_ALLOW_READS=true
ATELIER_SEARCHAD_ALLOW_WRITES=true
ATELIER_SEARCHAD_ALLOW_CREATES=true
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=true
ATELIER_SEARCHAD_ALLOW_ROLLBACK=true
ATELIER_SEARCHAD_ALLOW_DELETES=true
ATELIER_SEARCHAD_ALLOW_BILLING_READS=true
ATELIER_SEARCHAD_ALLOW_ACCOUNT_ADMIN=false
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=true

# Automation
ATELIER_SEARCHAD_AUTOMATION_MODE=auto
ATELIER_ADS_MAX_BID_CHANGE_PERCENT=20
ATELIER_ADS_MAX_BUDGET_CHANGE_PERCENT=20
ATELIER_ADS_MAX_DAILY_BUDGET_KRW=100000
ATELIER_ADS_MAX_BATCH_SIZE=20
ATELIER_ADS_MAX_DAILY_OPERATIONS=200
ATELIER_ADS_MIN_CONVERSION_SAMPLE=3
ATELIER_ADS_MAPPING_CONFIDENCE_THRESHOLD=0.90

# Reports
ATELIER_SEARCHAD_REPORT_DIR=./work/searchad-reports
ATELIER_SEARCHAD_REPORT_QUARANTINE_DIR=./work/searchad-report-quarantine
ATELIER_SEARCHAD_REPORT_POLL_INTERVAL_MS=30000
ATELIER_SEARCHAD_REPORT_MAX_WAIT_MS=1800000
ATELIER_SEARCHAD_REPORT_RECOLLECT_DAYS=3

# Database / Worker
DATABASE_URL=
ATELIER_SEARCHAD_WORKER_CONCURRENCY=2
ATELIER_SEARCHAD_SCHEDULER_ENABLED=true

# API Keys
ATELIER_SEARCHAD_READER_API_KEYS=
ATELIER_SEARCHAD_OPERATOR_API_KEYS=
ATELIER_SEARCHAD_EXECUTOR_API_KEYS=
ATELIER_SEARCHAD_ADMIN_API_KEYS=
```

운영 배포 시 자격증명이 없으면 SearchAd 모듈만 `not_configured` 상태가 되고 Commerce·Drive는 계속 동작해야 한다.

---

## 25. 단계별 구현 계획

## Phase S0 — 스펙·문서 기준선

작업:

- 9개 공식 Swagger 원본 저장
- 공식 오류 코드 맵 저장
- release/notice watcher
- operation manifest generator
- coverage report
- v2 설계 문서 확정

완료 조건:

```text
공식 operation 전부 분류
중복 operationKey 0
미분류 0
스펙 체크섬 고정
```

## Phase S1 — 인증·공통 클라이언트

작업:

- HMAC client
- Principal/Customer 모델
- 오류 표준화
- 재시도·rate limit
- 응답 메타데이터
- Secret 마스킹
- clock diagnostics

완료 조건:

- 공식 샘플과 서명 결과 일치
- 실제 계정 인증 성공
- Access License·Secret 로그 노출 0

## Phase S2 — 전체 조회·Capability

작업:

- 계정·비즈머니
- 캠페인·그룹·키워드·소재
- 확장소재·채널·타게팅
- 공유예산·라벨·상품그룹
- keyword tool·estimate·inspect history
- Passive Probe
- Capability registry

완료 조건:

- 실제 계정 read smoke test
- 기능별 증거 저장
- 403/404/empty 구분

## Phase S3 — 보고서·마스터 데이터

작업:

- report job
- master report
- 원본 보존
- schema registry
- quarantine
- 날짜별 파서
- VAT 정규화
- D+1/D+2/D+3

완료 조건:

- 공식 보고서 fixture 파싱
- 열 불일치 자동 적재 금지
- 재수집·finalized 동작

## Phase S4 — Commerce·상품·수익성

작업:

- 상품·광고 N:M 매핑
- 재고·판매상태
- 주문·정산·반품 결합
- actual/partial/estimated/unknown
- 상품별 성과·수익성

완료 조건:

- 매핑 신뢰도 표시
- 수익성 근거·기준시각 표시
- 품절 불일치 경고

## Phase S5 — 키워드·추정·추천

작업:

- 연관 키워드
- 검색어 확장
- 제외 키워드
- 입찰 추정
- 추천 엔진
- 예상 영향

완료 조건:

- 추천에 데이터 근거·신뢰도 포함
- 최소 표본·finalized 조건 적용

## Phase S6 — 운영 쓰기

작업:

- 캠페인·그룹·키워드·소재·확장소재 수정
- ON/OFF
- 입찰가·예산
- 타게팅·공유예산
- change plan·approval
- Drift
- unknown outcome
- rollback

완료 조건:

- Canary 상태 변경 성공
- 타임아웃 reconcile 테스트
- stale plan 차단

## Phase S7 — 생성·배치·삭제

작업:

- 캠페인·그룹·키워드·지원 소재 생성
- 템플릿
- 배치 20개
- 유형별 validator
- 삭제 API
- Active Canary 전체

완료 조건:

- 지원 유형만 생성 UI에 노출
- 중복 생성 방지
- 삭제 2단계 확인

## Phase S8 — 자동화

작업:

- observe/recommend/approve/auto
- 품절 중지·재개
- 입찰·예산 최적화
- 키워드 생성·제외
- 자동 롤백
- shadow compare

완료 조건:

- 상한 위반 실행 0
- 매핑·재고·보고서 조건 강제
- Kill Switch 즉시 동작

## Phase S9 — 관리자 UI·ChatGPT

작업:

- 광고 대시보드
- 계층 탐색
- 상품별 수익성
- 정책 관리
- Reader/Operator/Executor/Admin OpenAPI
- 운영 Action 지침

완료 조건:

- 비밀정보 미노출
- 변경 전후·금액 영향 표시
- Operation 추적 가능

## Phase S10 — 운영 안정화

작업:

- 부하 테스트
- 장애 훈련
- 보고서 지연 대응
- 백업·복구
- Runbook
- 경보
- 장기 데이터 보관

완료 조건:

- 운영계정 Canary 통과
- 7일 관찰
- 7일 recommend
- 제한 auto 활성화
- 사고 복구 훈련 완료

---

## 26. 구현 커밋 순서

```text
1. docs: finalize SearchAd implementation plan v2
2. feat: add pinned SearchAd spec registry and coverage
3. feat: add SearchAd HMAC client and account model
4. feat: add SearchAd read gateway and capability probe
5. feat: add report and master-report ingestion
6. feat: add Commerce-to-SearchAd product mapping
7. feat: add profitability and recommendation engine
8. feat: add approved SearchAd write execution
9. feat: add creation, batch, delete and canary
10. feat: add automation engine and rollback
11. feat: add SearchAd OpenAPI Actions and admin API
12. docs: add deployment, test and incident runbook
```

각 커밋은 독립 테스트와 롤백 가능한 마이그레이션을 포함한다.

---

## 27. 완료 정의

- [ ] 공식 9개 Swagger 번들의 operation이 전부 manifest에 분류된다.
- [ ] 미분류 operation이 0개다.
- [ ] Principal 1 : Customer N 인증이 동작한다.
- [ ] Passive Probe와 Active Canary가 동작한다.
- [ ] 캠페인·그룹·키워드·소재·확장·채널·타게팅·예산·라벨·상품그룹 조회가 동작한다.
- [ ] 비즈머니·계정·검수·키워드 도구·estimate가 동작한다.
- [ ] 성과·전환·검색어·마스터 보고서가 버전별로 적재된다.
- [ ] 2026-11-16 확장소재 보고서 변경을 처리한다.
- [ ] VAT 기준과 원시 광고비를 보존한다.
- [ ] D+1/D+2/D+3 재수집이 동작한다.
- [ ] 상품·광고 N:M 매핑이 동작한다.
- [ ] 수익성이 상태·근거와 함께 표시된다.
- [ ] 운영계정 ON/OFF·입찰·예산 변경이 동작한다.
- [ ] 캠페인·그룹·키워드·지원 소재 생성이 동작한다.
- [ ] 배치와 삭제가 확인 절차를 지킨다.
- [ ] Drift·unknown outcome·reconcile·rollback이 동작한다.
- [ ] 자동화 모드와 상한이 동작한다.
- [ ] Reader/Operator/Executor/Admin OpenAPI가 분리된다.
- [ ] Kill Switch가 즉시 동작한다.
- [ ] 감사 로그에 비밀정보가 남지 않는다.
- [ ] SearchAd와 GFA 기능 경계가 명확하다.

---

## 28. 명시적 제외·조건부 범위

### 28.1 GFA/성과형 디스플레이광고

SearchAd SA API와 별도다. 공개된 공식 관리 API·파트너 권한이 확보되기 전에는 SearchAd 모듈에 억지로 포함하지 않는다.

```text
src/displayads/
```

어댑터 경계만 준비한다.

### 28.2 비즈머니 충전·결제

잔액·내역 조회는 포함한다. 실제 결제·충전이 별도 공식 API와 권한으로 명확히 지원되는 경우에만 Admin 기능으로 추가한다.

### 28.3 미확인·레거시 기능

Swagger에만 있고 실제 공개 지원 근거가 약한 기능은 Tier D로 격리한다. 사용자에게 “모든 기능 완료”라고 표시하려면 해당 기능이 구현·조건부·격리·폐기 중 하나로 명확히 분류돼야 한다.

---

## 29. 즉시 다음 작업

이 문서 승인 후 바로 Phase S0와 S1을 시작한다.

```text
S0
- 공식 9개 Swagger 다운로드·고정
- operation manifest 생성
- coverage 검사
- report schema seed

S1
- HMAC 인증 클라이언트
- 다중 Customer 모델
- 오류·rate limit·retry
- 실제 계정 인증 smoke test 준비
```

코드가 배포되기 전에는 실제 광고계정에 아무 변경도 발생하지 않는다.
