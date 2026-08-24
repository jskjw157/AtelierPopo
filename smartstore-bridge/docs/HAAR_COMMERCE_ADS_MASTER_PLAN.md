# HAAR 스마트스토어·광고 통합 운영 플랫폼 마스터 계획/설계

- 문서 버전: `1.0-draft`
- 작성 기준일: `2026-08-24`
- 대상 저장소: `jskjw157/AtelierPopo`
- 기준 애플리케이션: `smartstore-bridge v0.2.0`
- 대상 브랜드/스토어: `HAAR / 아뜰리에포포`

> 현재의 “퀸실버 상품 → 네이버 스마트스토어 등록 브리지”를 상품·주문·문의·정산·검색광고·시장 인텔리전스·분석·자동화까지 포함하는 통합 운영 플랫폼으로 확장하기 위한 마스터 설계다. 공식 API에서 확인된 기능, 계정·광고상품에 따라 조건부인 기능, 현재 공식 지원을 확인하지 못한 기능을 구분한다.

---

## 0. 핵심 결론

최종 목표는 다음 흐름을 하나의 운영 플랫폼에서 처리하는 것이다.

```text
Google Drive 상품 원본
        ↓
상품 PIM·가격·카테고리·이미지·옵션
        ↓
네이버 스마트스토어 상품/주문/문의/정산
        ↓
네이버 검색광고·성과 보고서
        ↓
NAVER API HUB 검색어/쇼핑 클릭 트렌드
        ↓
상품별 매출·광고비·기여이익·재고·ROAS 분석
        ↓
추천 → 사용자 승인 → 제한된 자동 실행
        ↓
관리자 웹 + GPT Action + CLI
```

설계 원칙:

1. Drive 원본은 서버에 전체 복제하지 않고 필요한 상품만 온디맨드로 가져온다.
2. 읽기·추천·승인·실행을 분리한다.
3. 공식 API가 확인된 기능만 기본 활성화한다.
4. 공급처 상품번호, 판매자관리코드, 네이버 원상품/채널상품번호, 광고 ID를 하나의 상품 식별자 맵으로 연결한다.
5. 초기에는 모듈형 모놀리스로 구축하고 API·Worker·Scheduler 프로세스를 분리한다.
6. SQLite는 개발·단일 테스트용으로 유지하되 주문·정산·광고 운영 전에 PostgreSQL로 전환한다.
7. 공식 지원이 끝난 API나 확인되지 않은 기능을 설계상 “가능”으로 표시하지 않는다.

---

## 1. 현재 기준선

### 원본 데이터

- 상품 `1,515개`
- 상품 정보 JSON `1,515개`
- 이미지 `31,473개`
- 총 용량 약 `12.89GB`
- 이미지 없는 상품 `0개`

상세 기준은 [`QUEENSILVER_SOURCE_REPORT.md`](./QUEENSILVER_SOURCE_REPORT.md)를 따른다.

### 현재 구현됨

- 퀸실버 JSON 검증
- 공급가 기반 판매가 계산
- 옵션 추가금·품절 변환
- 이미지 정규화와 네이버 이미지 업로드
- 상품 등록 페이로드 생성
- 판매자관리코드 중복 검사
- 단일/소량 배치 등록
- SQLite 작업 원장과 비동기 Operation
- HTTP API, OpenAPI, CLI, 로컬 MCP
- Bearer API Key, 이중 쓰기 잠금, 확인 문구, 멱등성 키

### 아직 빠짐

- Google Drive 직접 읽기 Provider
- 자동 카테고리/속성/상품고시 매핑
- 상품 수정·재고·상태·삭제·그룹상품·공지·배송그룹
- 주문·발주·발송·취소·반품·교환
- 고객문의·상품문의
- 정산·부가세·수수료·순이익
- 네이버 검색광고 API
- NAVER API HUB 검색어/쇼핑 인사이트
- 통합 분석·자동화·승인 워크플로
- PostgreSQL, Worker/Scheduler, 관리자 웹

---

## 2. 공식 API 지원 등급

| 영역 | 목표 기능 | 등급 | 구현 방향 |
|---|---|---:|---|
| Google Drive | 파일 탐색·다운로드·변경 감지·캐시 | 확정 | 서비스 계정 + Drive API v3 |
| 상품 기반정보 | 카테고리·속성·원산지·태그·고시·옵션 가이드 | 확정 | 일일 메타데이터 동기화 |
| 상품 수명주기 | 등록·조회·수정·삭제·판매상태·재고·벌크 | 확정 | Commerce Product Adapter |
| 그룹상품/공지/배송 | 그룹상품, 공지, 묶음배송, 희망일배송 | 확정 | 승인형 비동기 Operation |
| 주문 | 변경 주문, 상세, 발주, 발송, 지연, 희망일 | 확정 | Polling + 상태 머신 |
| 클레임 | 취소·반품·교환 처리 | 확정 | 승인형 Workflow |
| 문의 | 고객문의·상품문의 조회/답변 | 확정 | 초안 → 승인 → 전송 |
| 정산 | 건별/일별 정산·수수료·부가세 | 확정 | 원장 수집 + 손익 계산 |
| 판매자정보 | 계정·채널·주소록·물류·오늘출발 | 확정 | 설정 Wizard |
| N배송 | 물류/창고 연동 | 조건부 | 실제 사용 계정만 활성화 |
| 검색광고 | 캠페인·광고그룹·키워드·통계·예상 성과 | 조건부 | Capability Probe 후 활성화 |
| 쇼핑 관련 광고 보고서 | 검색어/전환/상품 성과 | 조건부 | 계정·광고상품에서 실조회 검증 |
| GFA/성과형 디스플레이 | 캠페인·소재 관리 | 미확인/제외 | 별도 공식 API 확인 전 제외 |
| 리뷰 조회/답변 | 리뷰 운영 | 미확인/제외 | 우회 스크래핑 금지 |
| NAVER API HUB | 검색어 트렌드·쇼핑 인사이트·콘텐츠 검색 | 확정 | 별도 NCP 자격증명 |
| GPT 연결 | OpenAPI + API Key Action | 확정 | 읽기/운영/관리자 스키마 분리 |

중요한 제한:

- 검색광고 공식 도움말은 일부 검색광고 상품 중심으로 API를 제공한다고 안내한다. 공식 샘플의 캠페인·광고그룹·키워드 CRUD, 입찰가, 예상 성과, 통계는 구현 후보지만 계정에서 실제 지원되는 범위를 먼저 탐색해야 한다.
- 쇼핑 관련 보고서는 공식 도움말에 존재해도 광고 생성·수정 API가 같은 범위로 제공된다고 가정하지 않는다.
- 기존 네이버 개발자센터의 구형 쇼핑 검색 API는 `2026-07-31` 종료되었으므로 신규 설계에서 사용하지 않는다. 검색어·쇼핑 수요 분석은 NAVER API HUB를 사용한다.

---

## 3. Google Drive 카탈로그 설계

```ts
interface CatalogProvider {
  getStatus(): Promise<CatalogProviderStatus>;
  refreshIndex(): Promise<SyncRun>;
  searchProducts(query: ProductSearchQuery): Promise<ProductSummary[]>;
  getProduct(productId: string): Promise<NormalizedSourceProduct>;
  hydrateProduct(productId: string): Promise<HydratedWorkspace>;
  releaseProduct(productId: string): Promise<void>;
}
```

구현체:

```text
LocalCatalogProvider        현재 로컬 파일 방식
GoogleDriveCatalogProvider  Hostinger 운영 방식
```

처리 흐름:

```text
1. catalog_manifest.json 메타데이터/해시 확인
2. 변경 시 상품 인덱스 갱신
3. 상품번호 요청 시 해당 폴더만 탐색
4. product_info.json 다운로드
5. 필요한 대표/추가/상세 이미지만 임시 캐시
6. 검증·미리보기·등록
7. 캐시 TTL 또는 작업 완료 시 삭제
```

저장할 메타데이터:

- Drive `fileId`, `modifiedTime`, `md5Checksum`, `size`
- 상품번호, 카테고리, 폴더 ID
- JSON/이미지 해시
- 누락·0바이트·다운로드 오류
- 상품 처리 시점의 소스 스냅샷 해시

1차는 스케줄 기반 변경 확인으로 구현하고, 이후 Drive Changes/Push Notification을 추가한다.

---

## 4. 상품 PIM 설계

### 3계층 모델

```text
Source Product      퀸실버 원본 보존
Normalized Product  채널 독립 표준 모델
Channel Payload     네이버 커머스API 전용 구조
```

### 상품 식별자 맵

```text
sourceProductId
sellerManagementCode
originProductNo
channelProductNo
naverShoppingProductId 또는 광고 referenceData
supplierUrl
```

이름만으로 매칭하지 않는다.

### 카테고리/속성/고시

- 공식 전체 카테고리 목록을 주기적으로 동기화
- `last=true` 리프 카테고리만 사용
- 기본 상품군은 승인된 고정 매핑 우선
- `단종/주문제작 가능`, `연예인스타일`은 상품 종류가 아니므로 상품별 재분류
- 카테고리별 필수 속성·상품정보제공고시·원산지·추천 태그 검증
- 소스에 없는 소재·도금·중량·크기·알레르기 정보는 임의 생성하지 않음

### 가격 엔진

```text
공급가
+ 부가세 여부
+ 판매/결제 수수료 예상
+ 목표 광고비율
+ 배송/포장 원가
+ 목표 기여이익
= 권장 판매가
```

지원 정책:

- 배수·고정마진·목표마진율
- 카테고리·공급가 구간별 정책
- 정상가/즉시할인/실판매가 분리
- 끝자리 규칙
- 최저 기여이익 방어선
- 변경 전 영향도와 Diff

### 이미지

- 대표·추가·상세 역할 분류
- 중복/유사 이미지 해시
- WebP → JPEG, 크기·용량 정규화
- EXIF 제거, 색상공간 표준화
- 소스 해시가 동일하면 네이버 재업로드 생략
- 상세페이지 완성본은 별도 상세 콘텐츠 정책으로 반영

### 상품 수명주기

- 등록·조회·수정·삭제
- 판매중/중지/품절
- 옵션 재고
- 벌크 업데이트
- 공지·배송그룹
- 검수 요청 조회/복원
- 그룹상품 등록·전환·해제·수정·삭제
- 변경 전후 스냅샷과 롤백 근거

---

## 5. 주문·문의·정산

### 주문 상태 머신

```text
NEW → ORDER_CONFIRMED → SHIPPING_READY → SHIPPED → DELIVERED
NEW/CONFIRMED → CANCEL_REQUESTED → CANCELLED
DELIVERED → RETURN_REQUESTED → RETURNED
DELIVERED → EXCHANGE_REQUESTED → EXCHANGED
```

지원 작업:

- 변경 주문/상세 조회
- 발주 확인
- 송장·택배사 입력, 발송
- 발송 지연, 희망일 변경
- 취소 요청/승인
- 반품 승인·보류·해제·거부
- 교환 수거·재배송·보류·해제·거부

조회는 자동화할 수 있으나 발송·클레임은 기본적으로 사용자 승인 후 실행한다.

### 문의

- 고객문의/상품문의 동기화
- 답변 템플릿
- AI 답변 초안
- 개인정보·금칙어·미확인 사실 검사
- 사용자 승인 후 등록/수정
- 미답변 SLA 알림

### 정산/손익

```text
매출
- 취소/반품
- 네이버 수수료와 공제
- 공급가
- 배송비/포장비
- 광고비
= 기여이익
```

지표:

- 매출·주문수·객단가
- 환불/반품률
- 광고비·ROAS·MER
- 기여이익·기여이익률
- 상품/옵션별 순이익
- 손익분기 ROAS
- 재고 소진 예상일

---

## 6. 네이버 검색광고 설계

별도 자격증명:

```dotenv
NAVER_SEARCHAD_ACCESS_LICENSE=
NAVER_SEARCHAD_SECRET_KEY=
NAVER_SEARCHAD_CUSTOMER_ID=
```

요청마다 Timestamp, HTTP method, URI로 HMAC-SHA256 서명을 만들고 공식 헤더를 사용한다.

### Capability Probe

연결 직후 아래를 실제 호출해 지원 기능을 저장한다.

```text
customer links
business channels
campaigns
adgroups
ads
keywords
stats
estimate endpoints
master/stat reports
```

비지원 기능은 `FEATURE_NOT_SUPPORTED`로 차단한다.

### 읽기 기능

- 광고계정/권한
- 캠페인·광고그룹·광고·키워드
- ON/OFF, 예산, 입찰가
- 기간별 `/stats`
- 대용량 StatReport/MasterReport
- 키워드 검색량
- 평균 노출순위/최소 노출/중앙 입찰가
- 예상 성과

### 쓰기 기능

실계정에서 지원 확인된 범위만 활성화:

- 캠페인/광고그룹 생성·수정·삭제
- ON/OFF와 예산
- 키워드 CRUD
- 개별/그룹 입찰가
- 광고 상태

안전장치:

```text
NAVER_SEARCHAD_ALLOW_WRITES=true
ATELIER_ADS_HTTP_ALLOW_WRITES=true
confirmation=UPDATE_AD
idempotencyKey
변경 전/후 Diff
일일 변경 한도
최대 증감률
최소 데이터량
사용자 승인
```

초기 최적화 규칙은 실행이 아니라 추천만 만든다.

- 광고비가 임계값 이상인데 주문 0 → 중지 후보
- 목표 ROAS 이상, 재고 충분, 기여이익 양수 → 입찰가 소폭 상향 후보
- 품절/판매중지 → 광고 중지 후보
- 클릭은 많고 전환율이 낮음 → 검색어/랜딩/상품명 점검
- 손익분기 ROAS 미달 → 입찰 하향/중지 후보

자동 실행은 추천 결과를 최소 2주 검증한 뒤 일부 규칙만 허용한다.

---

## 7. 시장 인텔리전스와 분석

### NAVER API HUB

- 검색어 트렌드: 브랜드/상품군/디자인 키워드 추이
- 쇼핑 인사이트: 분야·키워드별 클릭 트렌드
- 콘텐츠 검색: 블로그 등 고객 표현과 콘텐츠 소재 수집

구형 쇼핑 검색 API 종료로 경쟁상품 가격 수집은 별도 지원 API 또는 승인된 Provider로 분리하고, 종료 API에 의존하지 않는다.

### 통합 Fact

```text
fact_product_daily
fact_order_daily
fact_settlement_daily
fact_ad_daily
fact_search_demand_daily
```

대시보드:

1. 오늘 주문/매출/발송 지연/클레임
2. 상품별 매출·순이익·광고비·ROAS
3. 광고 캠페인/그룹/키워드 성과
4. 품절·판매중지·광고중 불일치
5. 문의 미답변/SLA
6. 정산 예상/확정 차이
7. Drive 원본 변경/검증 오류
8. 자동화 추천/승인/실행 결과

---

## 8. 승인·자동화 엔진

```text
DETECT → RECOMMEND → APPROVE → EXECUTE → VERIFY → ROLLBACK → AUDIT
```

| 위험등급 | 예시 | 기본 정책 |
|---|---|---|
| R0 | 조회·통계·미리보기 | 자동 |
| R1 | 캐시 갱신·로컬 분류 | 자동 + 감사로그 |
| R2 | 재고·판매상태·문의 답변 | 사용자 승인 |
| R3 | 가격·광고 입찰/예산·발송·클레임 | 강화 승인 + 변경 한도 |
| R4 | 대량 삭제·전체 가격변경·전체 광고중지 | API 비노출 또는 2단계 승인 |

승인 실행 방식:

```text
preview/diff 생성
→ approvalId
→ 사용자 승인
→ 단기 executeToken
→ 동일 payload hash에만 실행
```

---

## 9. 목표 아키텍처

```text
관리자 Web / GPT Action / CLI
              │ HTTPS
              ▼
API Gateway: Auth·RBAC·Rate Limit·Approval·Audit
              │
 ┌────────────┼──────────────┐
 ▼            ▼              ▼
Catalog/PIM   Commerce Ops   Ads/Analytics
Drive/Image   Order/Claim    SearchAd/API HUB
Price/Category Inquiry/Settle Rules/Reports
 └────────────┼──────────────┘
              ▼
PostgreSQL + Outbox + Audit + Cache
              │
       ┌──────┴──────┐
       ▼             ▼
     Worker        Scheduler
       │             │
Google Drive API   Naver APIs
```

프로세스:

```text
api        외부 HTTP/OpenAPI, 짧은 요청
worker     Drive 다운로드, 이미지 변환, 상품등록, 보고서
scheduler  주문·문의·정산·광고·Drive 증분 동기화
```

---

## 10. 모듈과 데이터 모델

### 모듈

```text
core: config/auth/approvals/operations/audit/errors
catalog: local-drive/google-drive/index/cache
pim: normalized product/category/price/image/template
commerce: products/orders/claims/inquiries/settlements/seller
search-ads: auth/entities/stats/reports/estimate
market-intelligence: search-trend/shopping-insight/content
analytics: profit/roas/dashboard/recommendations
automation: rules/approvals/execution/rollback
interfaces: http/cli/mcp/web
```

### 핵심 테이블

```text
source_products, source_assets, catalog_sync_runs
normalized_products, product_variants, category_mappings
product_templates, product_identity_map
commerce_products, commerce_product_snapshots
orders, order_items, claims
inquiries, inquiry_messages
settlements, settlement_lines
ad_accounts, ad_campaigns, ad_groups, ads, ad_keywords
ad_stats_daily, ad_report_jobs
search_demand_daily, product_metrics_daily
recommendations, operations, approvals, outbox_events, audit_logs
```

개인정보는 최소 보관하고 GPT 응답에는 업무상 필요한 최소 필드만 노출한다.

---

## 11. HTTP API 방향

OpenAPI를 역할별로 분리한다.

```text
/openapi-read.json      조회·검증·분석
/openapi-operator.json  단일 운영 작업
/openapi-admin.json     설정·배치·위험 작업
```

주요 신규 API:

```http
GET  /api/v1/capabilities
GET  /api/v1/storage/drive/status
POST /api/v1/catalog/sync
POST /api/v1/catalog/products/{productId}/hydrate
POST /api/v1/products/{productId}/update-preview
POST /api/v1/products/{productId}/update
POST /api/v1/products/{productId}/status
POST /api/v1/products/{productId}/stock
POST /api/v1/orders/sync
POST /api/v1/orders/{id}/confirm|ship|delay
POST /api/v1/claims/{id}/preview|execute
POST /api/v1/inquiries/sync
POST /api/v1/inquiries/{id}/draft|answer
POST /api/v1/settlements/sync
GET  /api/v1/profit/products/{productId}
POST /api/v1/ads/capabilities/probe
GET  /api/v1/ads/campaigns|adgroups|ads|keywords|stats
POST /api/v1/ads/reports
POST /api/v1/ads/changes/preview|execute
GET  /api/v1/dashboard
GET  /api/v1/approvals
POST /api/v1/approvals/{approvalId}/approve
```

임의 파일 경로나 임의 쉘 명령은 받지 않는다.

---

## 12. 보안·운영·테스트

### Secret 분리

- Commerce ID/Secret
- Search Ads Access License/Secret/Customer ID
- NAVER API HUB NCP Client ID/Secret
- Google Service Account credential
- 역할별 `ATELIER_API_KEY`

모든 Secret은 Hostinger 환경변수/Secret으로만 관리한다. Google 서비스 계정은 원본 폴더 reader만 부여한다.

### Kill Switch

```dotenv
NAVER_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_WRITES=false
NAVER_SEARCHAD_ALLOW_WRITES=false
ATELIER_ADS_HTTP_ALLOW_WRITES=false
AUTOMATION_EXECUTION_ENABLED=false
```

### 관측성

- requestId/operationId 기반 JSON 로그
- API 오류율, 429, Queue 실패, Drive 캐시 적중률
- 주문/문의 동기화 지연
- 상품 등록 성공률
- 광고비 급증, 품절인데 광고 활성
- DB 백업 실패

### 테스트 순서

1. Unit/Fixture/Contract Test
2. Mock API로 400/401/403/429/5xx
3. 읽기 전용 실계정 Smoke Test
4. 상품 1개 Preview
5. 상품 1개 등록 후 원격 재조회
6. 3개 → 10개 소량 배치
7. 주문/문의/정산은 최소 1주 읽기 검증
8. 광고는 읽기/보고서 후 한 건만 Canary 변경
9. 자동화는 최소 2주 추천 결과 검증 후 일부 활성화

---

## 13. 단계별 로드맵

### Phase 0 — 기준선 고정

- 릴리스 태그, 배포 재현성, Secret Scan
- 역할별 API Key
- `/capabilities` 기본 구조

### Phase 1 — Drive Provider

- 서비스 계정 인증
- manifest 인덱스
- 상품 JSON/이미지 온디맨드 hydration
- 캐시·TTL·해시·정리
- Drive 상태/동기화 API

완료 기준: 서버에 12.89GB 전체를 복제하지 않고 상품번호로 Preview 성공.

### Phase 2 — 상품 PIM 전체 기능

- 카테고리/속성/고시/원산지/태그
- 가격 정책 v2
- 상품 등록/수정/상태/재고/삭제
- 벌크·공지·배송·검수·그룹상품

### Phase 3 — 주문·문의·정산 읽기

- 증분 동기화
- PostgreSQL 전환
- 운영 대시보드

### Phase 4 — 주문·문의 쓰기

- 발주/발송/지연
- 취소/반품/교환
- 문의 초안/승인/전송

### Phase 5 — 검색광고 읽기·보고서

- HMAC Client
- Capability Probe
- 캠페인/그룹/광고/키워드
- Stats/Reports/Estimate
- 상품/광고 ID 매핑

### Phase 6 — 광고 운영·최적화

- 상태/예산/입찰 변경 Preview
- 추천 엔진
- 일일 한도/최대 증감률/Kill Switch
- 승인형 실행

### Phase 7 — API HUB와 통합 손익

- 검색어 트렌드·쇼핑 인사이트
- 상품별 기여이익·손익분기 ROAS
- 재고·광고·수익성 통합 추천

### Phase 8 — Web·GPT·운영 강화

- 관리자 대시보드
- read/operator/admin Action 분리
- 승인센터·감사로그
- 알림·백업복구·보안/부하 테스트

---

## 14. 권장 다음 버전: v0.3.0

1. `GoogleDriveCatalogProvider`
2. `/api/v1/storage/drive/status`
3. `/api/v1/catalog/sync`와 인덱스
4. 온디맨드 `hydrate/release`
5. `/api/v1/capabilities`
6. 카테고리 목록 동기화와 수동 매핑
7. PostgreSQL Repository 추상화/Migration
8. Search Ads 인증/HMAC Client
9. Search Ads 읽기 전용 `status/capabilities/campaigns/adgroups/keywords/stats`
10. NAVER API HUB 인증과 검색어 트렌드/쇼핑 인사이트 읽기
11. `/openapi-read.json`
12. Drive/Search Ads/API HUB Fixture와 live read-only smoke test

`v0.3.0`에서는 광고 쓰기, 주문 쓰기, 무승인 대량등록을 추가하지 않는다. 데이터 연결과 식별자 매핑을 먼저 안정화한다.

완료 기준:

```text
- Drive 접근 및 상품 1905 온디맨드 Preview 성공
- 캐시 삭제 후 재다운로드 성공
- 리프 카테고리 매핑 저장/검증
- Commerce 인증/원격상품 조회
- Search Ads Capability Probe와 지원 엔티티 조회
- API HUB 검색어/쇼핑 인사이트 조회
- 읽기 OpenAPI를 GPT Action에서 호출
- Secret/PII 비노출
```

---

## 15. Epic 백로그

```text
CAT: Drive 인증/인덱스/다운로드/캐시/변경동기화
PIM: 표준상품/카테고리/속성/가격/이미지/수정/벌크
OPS: 주문상태/발주/발송/클레임/문의/SLA
FIN: 정산/부가세/수수료/기여이익/대사
ADS: HMAC/Capability/엔티티/통계/보고서/입찰추천
INTEL: API HUB 검색트렌드/쇼핑인사이트/콘텐츠
PLATFORM: PostgreSQL/Queue/Scheduler/RBAC/Approval/Audit/Web
```

---

## 16. 필요한 자격증명

### 필수

```text
[ ] 네이버 커머스 애플리케이션 ID/Secret
[ ] Hostinger 외부 송신 IPv4 등록
[ ] Google Drive 서비스 계정 credential
[ ] Google Drive root folder ID
[ ] Hostinger 역할별 API Key
```

### 광고

```text
[ ] Search Ads Access License
[ ] Search Ads Secret Key
[ ] Search Ads Customer ID
[ ] 스마트스토어 전환 추적 설정 확인
```

### API HUB

```text
[ ] NCP Client ID
[ ] NCP Client Secret
[ ] 검색어 트렌드/쇼핑 인사이트 사용 설정
```

---

## 17. 위험과 제외 기능

주요 위험:

- Drive API 지연/할당량
- 네이버 스키마·카테고리 개편
- 광고상품별 API 지원 차이
- Sandbox 부족
- 광고 자동화 손실
- PII 노출
- SQLite 동시성
- 공개 GitHub Secret 유출
- 외부 성공·내부 실패
- 대량 오등록

명시적으로 만들지 않음:

- 임의 쉘/파일 경로 API
- 확인 없는 대량 등록·삭제·가격변경
- 최소 데이터 없는 광고 자동 입찰
- 공식 API 미확인 GFA/리뷰 우회 스크래핑
- 종료된 구형 쇼핑 검색 API 의존
- 고객 보상/환불/법적 답변 무승인 자동 전송
- 소스에 없는 제품 사실 AI 생성

---

## 18. 참고 자료

### 네이버 커머스API

- [최신 커머스API 문서](https://apicenter.commerce.naver.com/docs/commerce-api/current)
- [상품 API 목록](https://apicenter.commerce.naver.com/docs/commerce-api/current/%EC%83%81%ED%92%88-%EB%AA%A9%EB%A1%9D)
- [상품 문의](https://apicenter.commerce.naver.com/docs/commerce-api/current/%EC%83%81%ED%92%88-%EB%AC%B8%EC%9D%98)
- [수수료 상세](https://apicenter.commerce.naver.com/docs/commerce-api/current/find-commission-details-pay-settle)

### 네이버 검색광고

- [검색광고 API 공식 안내](https://ads.naver.com/help/faq/991)
- [공식 샘플 저장소](https://github.com/naver/searchad-apidoc)
- [보고서 도움말](https://ads.naver.com/help/faq/1239)
- [전환 추적](https://ads.naver.com/help/faq/848)

### NAVER API HUB

- [API HUB 개요](https://api.ncloud-docs.com/docs/naver-api-hub-overview)
- [이관 가이드](https://guide.ncloud-docs.com/docs/apihub-migration)
- [검색어 트렌드](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend)
- [쇼핑 인사이트 분야별](https://api.ncloud-docs.com/docs/naver-api-hub-shopping-insight-categories)
- [쇼핑 인사이트 키워드별](https://api.ncloud-docs.com/docs/naver-api-hub-shopping-insight-keywords)
- [구형 쇼핑 검색 API 종료 공지](https://developers.naver.com/notice/article/32564)

### Google Drive / OpenAI

- [Google Drive API 개요](https://developers.google.com/workspace/drive/api/guides/about-sdk)
- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [파일 다운로드](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [변경 목록](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [GPT Actions 구성](https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts)

---

## 19. 최종 권고

전체 기능을 한 번에 구현하지 않는다. 다음 개발은 **`v0.3.0: Drive Provider + Capability Registry + Search Ads/API HUB 읽기 전용 + PostgreSQL 기반`**으로 시작한다.

이 기반이 안정화된 뒤 상품 전체 관리, 주문/문의/정산, 광고 쓰기, 자동화 순으로 확대한다. 특히 검색광고는 공식적으로 일부 상품 중심이므로 계정에서 실제 지원되는 기능을 먼저 탐색한 뒤 그 결과를 기준으로 UI와 GPT Action을 노출한다.
