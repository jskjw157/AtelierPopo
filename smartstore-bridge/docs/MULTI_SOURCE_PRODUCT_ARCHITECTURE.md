# HAAR 다중 공급처·다중 상품소스 아키텍처

> 작성일: 2026-08-26  
> 상태: **S4 구현 기준 — 퀸실버 전용 가정 폐기**  
> 적용 범위: 상품 수집, PIM, 스마트스토어 등록, 정산·수익성, SearchAd 상품 매핑

---

## 0. 핵심 결정

HAAR 플랫폼은 퀸실버 전용 상품 등록기가 아니다.

퀸실버 카탈로그는 현재 확보된 첫 번째 공급처 데이터셋일 뿐이며, 플랫폼의 기준 상품 ID나 전체 상품 범위를 의미하지 않는다.

플랫폼이 지원해야 하는 상품 원천:

```text
퀸실버
다른 실버 도매처·공급처
14K 공급처
써지컬 공급처
헤어액세서리 공급처
HAAR 자체 제작·자체 촬영 제품
사용자 수동 등록 제품
CSV·Excel 사입 목록
Google Drive 개별 상품 폴더
공급처 API·URL Import
기존 스마트스토어·Cafe24에서 역수집한 상품
```

따라서 SearchAd S4의 기준 엔티티는 `퀸실버 상품번호`가 아니라 `haar_product_id`다.

---

## 1. 세 개의 서로 다른 식별자 계층

### 1.1 공급처 원본 상품

```text
(source_id, source_product_id)
```

예:

```text
(queensilver_20260811, 1905)
(other_silver_supplier, 1905)
```

두 상품번호가 같더라도 공급처가 다르면 완전히 다른 상품이다.

### 1.2 HAAR 내부 기준 상품

```text
haar_product_id
internal_sku
```

HAAR가 실제로 판매·광고·수익성을 관리하는 기준 엔티티다.

한 HAAR 상품은:

- 한 공급처 상품에서 만들어질 수 있고
- 여러 공급처에서 동일 제품을 조달할 수 있고
- 공급처를 교체할 수 있고
- 자체 제작이어서 공급처 상품이 없을 수도 있다.

### 1.3 판매 채널 상품

```text
channel_id
channel_product_no
origin_product_no
seller_management_code
```

예:

```text
NAVER_SMARTSTORE
CAFE24
SHOPIFY
OWN_SITE
```

하나의 HAAR 상품이 여러 채널에 각각 등록될 수 있다.

---

## 2. 관계 구조

```text
Catalog Source
  └─ Source Product
      └─ Source Variant

HAAR Product
  └─ HAAR Variant

HAAR Product
  ├─ 0..N Source Products
  └─ 0..N Channel Products

Channel Product
  └─ 0..N SearchAd objects
       ├─ Product Group
       ├─ Adgroup
       ├─ Ad / Creative
       └─ Keyword
```

즉:

```text
공급처 상품 ≠ HAAR 상품 ≠ 스마트스토어 상품 ≠ 광고 객체
```

이 네 계층을 이름으로 억지 매칭하지 않고 명시적 ID 연결로 관리한다.

---

## 3. 데이터 모델

구현 Migration:

```text
migrations/postgres/0003_multi_source_product_catalog.sql
```

### 3.1 상품 소스

```text
catalog_sources
- source_id
- source_name
- source_type
- provider_type
- root_reference
- credential_ref
- status
```

지원 Provider 유형:

```text
google_drive_manifest
google_drive_folder
manual_upload
csv_excel
supplier_api
url_import
commerce_channel
other
```

### 3.2 공급처 상품

```text
source_products
source_product_variants
supplier_cost_history
catalog_ingestion_runs
```

공급가와 옵션 원가는 공급처별·시점별로 보존한다.

### 3.3 HAAR 기준 상품

```text
haar_products
haar_product_variants
haar_product_source_links
source_variant_links
```

HAAR 고객 노출 상품명·콘텐츠·브랜드·분류는 공급처 원본과 분리한다.

### 3.4 판매 채널

```text
sales_channels
channel_products
```

스마트스토어 번호는 공급처 상품번호가 아니라 HAAR 상품과 연결한다.

### 3.5 광고 매핑

기존 `product_ad_mappings`에 다음을 추가한다.

```text
catalog_source_id
haar_product_id
channel_product_key
```

광고 자동화는 가능한 경우 `haar_product_id + channel_product_key`를 사용한다.

---

## 4. CatalogProvider 계약

```ts
interface CatalogProvider {
  getSourceStatus(sourceId: string): Promise<SourceStatus>;
  listChanges(sourceId: string, cursor?: string): Promise<SourceChangePage>;
  getSourceProduct(sourceId: string, sourceProductId: string): Promise<SourceProduct>;
  hydrateAssets(sourceId: string, sourceProductId: string): Promise<HydratedAssets>;
  normalize(sourceProduct: SourceProduct): Promise<NormalizedSourceProduct>;
}
```

구현 후보:

```text
GoogleDriveManifestProvider
GoogleDriveFolderProvider
ManualUploadProvider
CsvExcelProvider
SupplierApiProvider
UrlImportProvider
CommerceChannelImportProvider
```

퀸실버는 `GoogleDriveManifestProvider`를 사용하는 한 개 Source다.

---

## 5. 상품 등록 흐름

```text
상품 Source 선택
→ 원본 상품 수집
→ Source Product 저장
→ 기존 HAAR 상품과 동일상품 여부 확인
→ 새 HAAR 상품 생성 또는 기존 상품 연결
→ HAAR 기준 상품명·옵션·가격·상세페이지 확정
→ 판매 채널 Payload 생성
→ 스마트스토어 등록·수정
→ Channel Product ID 저장
→ SearchAd 상품·광고 객체 연결
```

사용자는 특정 공급처를 선택하지 않고도 수동으로 HAAR 상품을 만들 수 있다.

```text
Manual Source
→ HAAR Product
→ SmartStore
→ SearchAd
```

---

## 6. 다중 공급처와 동일 상품

동일한 HAAR 상품을 여러 공급처에서 조달할 수 있다.

```text
HAAR Product A
├─ Supplier A / Product 123 / 우선순위 1
├─ Supplier B / Product X55 / 우선순위 2
└─ 자체 재고 / Manual Lot 2026-08 / 우선순위 3
```

선택 기준:

- 공급가
- 재고
- 배송 리드타임
- 불량률
- 소재·도금·사양 일치 여부
- 최소 주문수량
- 현재 계약상태

공급가가 싸다는 이유만으로 다른 형태의 제품을 동일 상품으로 자동 연결하지 않는다.

---

## 7. 옵션·재고

공급처 옵션과 HAAR 옵션을 분리한다.

```text
Source Variant
- 공급처 색상명
- 공급처 옵션 ID
- 공급처 재고
- 공급처 옵션 원가

HAAR Variant
- 고객 노출 옵션명
- HAAR SKU
- 채널 옵션 구조
- 판매 재고 정책
```

예:

```text
공급처 옵션: 백금 / 14K도금 / Yellow
HAAR 옵션: 실버 / 골드
```

자동 매핑은 명시적 규칙 또는 사용자 검증을 거친다.

---

## 8. 가격·수익성

상품 수익성 계산 기준:

```text
HAAR 판매상품
+ 실제 선택된 공급처·옵션·원가 시점
+ 채널 수수료·할인·배송
+ 광고비
= 상품별 수익성
```

여러 공급처가 연결된 경우:

```text
실제 발주·출고 공급처 확인 가능
→ actual cost

주 공급처만 지정
→ partial cost

공급가 정책만 존재
→ estimated cost

공급가 없음
→ unknown
```

퀸실버 공급가를 모든 HAAR 상품의 원가 기준으로 사용하지 않는다.

---

## 9. SearchAd S4 수정

기존의 다음 표현은 폐기한다.

```text
퀸실버 상품번호를 중심으로 광고를 연결한다.
```

수정된 기준:

```text
haar_product_id
→ channel_product_key
→ seller_management_code / origin_product_no / channel_product_no
→ SearchAd shopping reference / product group / adgroup / ad / keyword
```

필요한 경우 원본 추적을 위해:

```text
haar_product_id
→ catalog_source_id + source_product_id
```

를 역참조한다.

---

## 10. 초기 Source 등록

현재 확보된 퀸실버 데이터는 다음 Source로 등록한다.

```text
source_id: queensilver_20260811
source_name: 퀸실버_전체상품_20260811
source_type: supplier
provider_type: google_drive_manifest
canonical: false
expected_product_count: 1515
```

`canonical: false`는 퀸실버 데이터가 플랫폼 전체 상품 정의가 아니라는 뜻이다.

다음 공급처를 추가할 때 코드 변경 없이 Source 설정과 Provider만 등록할 수 있어야 한다.

---

## 11. 금지되는 설계

- 전역적으로 `productId=1905`만 사용
- 퀸실버 카테고리를 HAAR 전체 카테고리로 사용
- 퀸실버 공급가를 모든 제품 원가로 사용
- 공급처 상품명을 고객 노출 상품명으로 강제
- Drive 루트 폴더 하나를 전체 카탈로그로 하드코딩
- 다른 공급처 상품번호 충돌을 무시
- 공급처를 바꾸면 새 스마트스토어 상품을 무조건 만드는 방식
- 상품명 유사도만으로 광고를 자동 연결

---

## 12. S4 구현 순서

```text
S4.0
Multi-source schema 및 Source Registry

S4.1
QueenSilver Source를 첫 Adapter로 이전

S4.2
Manual Upload + Google Drive Folder Provider

S4.3
CSV/Excel Import Provider

S4.4
HAAR Product 생성·병합·공급처 연결 UI/API

S4.5
Channel Product 연결 및 기존 스마트스토어 상품 역매핑

S4.6
SearchAd N:M 매핑

S4.7
공급처별 원가 이력·수익성
```

---

## 13. 완료 기준

- [ ] 모든 공급처 상품은 `(source_id, source_product_id)`로 식별된다.
- [ ] HAAR 상품은 `haar_product_id`로 식별된다.
- [ ] 같은 상품번호를 가진 두 공급처가 충돌하지 않는다.
- [ ] 공급처가 없는 자체·수동 상품을 등록할 수 있다.
- [ ] 한 HAAR 상품에 여러 공급처를 연결할 수 있다.
- [ ] 한 HAAR 상품을 여러 판매 채널에 연결할 수 있다.
- [ ] SearchAd 매핑이 공급처 상품번호에 종속되지 않는다.
- [ ] 공급가·옵션 원가 이력이 공급처별로 보존된다.
- [ ] 퀸실버는 첫 Source일 뿐 전체 시스템의 고정 전제가 아니다.
