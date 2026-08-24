# HAAR / AtelierPopo 네이버 커머스API 전체 통합 계획

> 문서 버전: 1.0  
> 작성 기준일: 2026-08-24  
> 공식 문서 기준: 네이버 커머스API 2.86.0 (2026-08-19)  
> 대상 저장소: `jskjw157/AtelierPopo`  
> 대상 애플리케이션: `smartstore-bridge`  
> 상태: IMPLEMENTATION PLAN

---

## 0. 목표

현재 `smartstore-bridge`는 퀸실버 상품 JSON과 이미지를 읽어 스마트스토어 상품을 검증·미리보기·신규 등록하는 기능에 집중되어 있다.

이번 확장의 목표는 다음과 같다.

1. 네이버 커머스API 공식 문서에 노출된 모든 endpoint를 프로그램에서 호출할 수 있게 한다.
2. 상품 신규 등록뿐 아니라 기존 상품 조회·수정·상태·가격·재고·상세페이지·공지·배송정책·그룹상품까지 전부 지원한다.
3. 주문 수집, 발주, 발송, 취소, 반품, 교환을 운영 도구와 ChatGPT Action에서 처리할 수 있게 한다.
4. 문의, 정산, 부가세, 판매자정보, 물류, N배송 SKU, 커머스솔루션을 통합한다.
5. API데이터솔루션은 구독·권한이 확보된 endpoint를 Capability 방식으로 추가한다.
6. 현재 공식 endpoint가 추가·변경되더라도 자동으로 차이를 감지하고 누락 없이 따라갈 수 있게 한다.
7. 임의 URL을 호출하는 위험한 raw proxy가 아니라, 공식 operation manifest에 등록된 endpoint만 검증 후 호출한다.

---

## 1. 공식 API 범위 기준선

공식 `llms.txt` endpoint 인덱스 기준으로 현재 확인되는 endpoint는 총 115개다.

| 도메인 | endpoint 수 | 주요 범위 |
|---|---:|---|
| 인증 | 1 | OAuth2 토큰 발급 |
| N배송 | 3 | SKU 목록·단건·연결 상품 |
| 문의 | 6 | 고객 문의·상품 문의 조회·답변 |
| 상품 | 64 | 상품·그룹상품·카테고리·옵션·배송·공지·이미지·검수 등 |
| 정산 | 5 | 건별/일별 정산·수수료·부가세 |
| 주문 | 20 | 주문 조회·발주·발송·취소·반품·교환 |
| 커머스솔루션 | 8 | 구독·결제·JWE·외부 결제 |
| 판매자정보 | 8 | 계정·채널·주소록·물류·오늘출발 |
| **합계** | **115** | 공식 인덱스 기준 |

네이버 공식 AI 활용 가이드는 API데이터솔루션도 커머스API 문서 범위로 설명하지만, 현재 공식 `llms.txt` 인덱스에는 해당 endpoint 링크가 완전하게 열거되지 않는다. 따라서 API데이터솔루션은 별도 Spec Discovery와 실제 구독 Capability 확인 후 endpoint manifest에 추가한다.

### 전체 지원의 정의

`싹 다 쓸 수 있게 한다`의 완료 기준은 다음과 같다.

```text
공식 endpoint manifest 총수
= 구현 완료
+ 계정/앱 권한상 호출 불가지만 어댑터·스키마 구현 완료
+ 구독형 기능으로 Capability 대기 중
```

모든 endpoint는 아래 상태 중 하나를 가져야 한다.

```text
implemented_and_verified
implemented_unverified
permission_required
subscription_required
unsupported_for_application_type
deprecated
spec_pending
```

누락되거나 분류되지 않은 endpoint가 하나라도 있으면 전체 통합 완료로 보지 않는다.

---

## 2. 현재 코드 상태와 차이

현재 `src/naver/products.js`가 제공하는 핵심 기능은 다음 정도다.

- 상품 신규 등록
- 채널상품 단건 조회
- 판매자관리코드 검색
- 카테고리 단건 조회

현재 HTTP 상품 API는 다음 흐름에 집중돼 있다.

- 로컬 카탈로그 상품 검색
- 검증
- 미리보기
- 원격 등록 여부 확인
- 신규 상품 등록

따라서 다음 기능은 아직 없다.

- 기존 채널상품·원상품 수정
- 상세페이지 `detailContent` 교체와 롤백
- 가격·할인·재고·판매상태 단건/다건 변경
- 기존 상품 삭제
- 상품 목록 전체 동기화
- 상품 부가 메타데이터 전체 조회
- 그룹상품
- 상품 공지·배송 그룹·패션모델·검수
- N배송 SKU
- 주문·클레임
- 문의
- 정산·부가세
- 판매자·주소·물류·오늘출발
- 커머스솔루션
- API데이터솔루션

공통 HTTP 클라이언트도 다음을 보완해야 한다.

- `PATCH`, `DELETE`, `HEAD` 편의 메서드
- 바이너리 다운로드·스트림 응답
- multipart 업로드 크기 검사
- 응답 헤더와 Rate/Quota 정보 반환
- 호출별 timeout·retry 정책
- 쓰기 결과 불명확 상태 처리
- 308 리다이렉트와 최종 URL 기록
- endpoint별 부분 실패 표준화
- 개인정보 응답 마스킹

---

## 3. 구현 전략: Spec Manifest 기반 전체 커버리지

115개 endpoint를 손으로 각각 흩어져 구현하면 새 버전에서 다시 누락된다. 따라서 공식 문서로부터 관리되는 `operation manifest`를 중앙에 둔다.

### 3.1 Spec 동기화 산출물

```text
specs/naver-commerce/
├─ source/
│  ├─ llms.txt
│  └─ endpoints/*.md
├─ versions/
│  └─ 2.86.0/
│     ├─ operation-manifest.json
│     ├─ schemas/
│     └─ source-checksums.json
├─ current.json
└─ coverage.json
```

### 3.2 operation manifest 필드

```json
{
  "operationId": "updateOriginProductV2",
  "domain": "products",
  "method": "PUT",
  "path": "/v2/products/origin-products/{originProductNo}",
  "apiGroup": "PRODUCT",
  "risk": "high",
  "sideEffect": true,
  "async": false,
  "requestSchema": "UpdateOriginProductRequest",
  "responseSchema": "UpdateOriginProductResponse",
  "permissionMode": "self-store",
  "retryPolicy": "reconcile-before-retry",
  "redactionPolicy": "none",
  "docVersion": "2.86.0"
}
```

### 3.3 자동 검사 명령

```bash
npm run commerce:spec:sync
npm run commerce:spec:diff
npm run commerce:coverage
npm run commerce:contract-test
```

`commerce:coverage` 합격 조건:

```text
officialOperations == classifiedOperations
classifiedOperations == implemented + gated + deprecated
unclassifiedOperations == 0
```

### 3.4 외부 raw proxy 금지

다음과 같은 API는 만들지 않는다.

```http
POST /api/v1/naver/raw
{
  "method": "DELETE",
  "path": "/아무경로"
}
```

대신 공식 manifest의 `operationId`만 호출할 수 있는 내부 Gateway를 둔다.

```text
CommerceOperationGateway.invoke(operationId, pathParams, query, body)
```

- operationId 화이트리스트
- JSON Schema 검증
- 권한·위험도 검사
- 감사 로그
- Rate Limit
- 결과 재조회

를 통과해야 호출된다.

---

## 4. 목표 모듈 구조

```text
src/naver/commerce/
├─ core/
│  ├─ auth.js
│  ├─ client.js
│  ├─ response.js
│  ├─ errors.js
│  ├─ rate-limit.js
│  ├─ retry-policy.js
│  ├─ operation-manifest.js
│  └─ capability.js
├─ auth/
├─ products/
├─ group-products/
├─ product-reference/
├─ logistics-skus/
├─ orders/
├─ claims/
├─ inquiries/
├─ settlements/
├─ sellers/
├─ commerce-solutions/
└─ data-solutions/

src/application/commerce/
├─ product-service.js
├─ detail-content-service.js
├─ product-sync-service.js
├─ order-sync-service.js
├─ fulfillment-service.js
├─ claim-service.js
├─ inquiry-service.js
├─ settlement-service.js
├─ seller-bootstrap-service.js
├─ capability-service.js
└─ reconciliation-service.js

src/http/commerce/
├─ routes-reader.js
├─ routes-operator.js
├─ routes-executor.js
├─ routes-admin.js
└─ openapi.js
```

기존 `src/naver/*`는 호환 facade로 유지한 뒤 새 모듈로 순차 위임하고, 마이그레이션 완료 후 정리한다.

---

## 5. 공통 클라이언트 개편

### 5.1 메서드

```text
GET
POST
PUT
PATCH
DELETE
HEAD
multipart upload
binary download
stream download
```

### 5.2 응답 표준

```json
{
  "status": 200,
  "data": {},
  "traceId": "...",
  "headers": {
    "rateLimitRemaining": 10,
    "quotaRemaining": 100,
    "responseTimeMs": 123
  },
  "requestId": "...",
  "attempts": 1
}
```

### 5.3 재시도 정책

```text
GET/HEAD
- 401 GW.AUTHN: 토큰 재발급 후 1회 재시도
- 429: Retry-After 또는 Rate Limit 헤더 기반 대기
- 502/503/504: 지수 백오프

PUT/PATCH
- timeout 시 즉시 재호출 금지
- 대상 재조회 후 목표 상태와 비교
- 이미 반영됐으면 성공 처리

POST 생성
- timeout 시 unknown_outcome
- 자연키·판매자관리코드·부모 ID로 원격 탐색
- 중복 여부 확인 후에만 재실행

DELETE
- 자동 재시도 금지
- 조회로 삭제 여부 확인
```

### 5.4 관측성

모든 호출에서 저장한다.

- `GNCP-GW-Trace-ID`
- HTTP 상태
- 네이버 오류 코드
- invalidInputs
- Rate/Quota 헤더
- 호출 시간
- endpoint operationId
- 입력 fingerprint
- 민감정보 제거 응답

---

## 6. API 그룹별 구현 범위

## 6.1 인증

- OAuth2 토큰 발급
- SELF/SELLER 타입
- bcrypt + Base64 전자서명
- 토큰 캐시
- 30분 미만 잔여 시 갱신
- 다중 seller/account token namespace
- 키 회전
- 인증 상태 진단

외부 API:

```http
GET  /api/v1/commerce/auth/status
POST /api/v1/commerce/auth/test
POST /api/v1/commerce/auth/refresh
```

---

## 6.2 상품 전체 라이프사이클

### 조회

- 상품 목록 검색
- 채널상품 조회
- 원상품 조회
- 판매자관리코드·채널상품번호·원상품번호 상호 매핑

### 신규 등록

- v2 상품 등록
- 원상품 + 스마트스토어 채널상품
- 쇼핑윈도 채널상품 지원
- 이미지 선업로드
- 카테고리·고시·옵션 사전 검증

### 수정

- 채널상품 전체 수정
- 원상품 전체 수정
- 상세페이지 `detailContent` 수정
- 상품명
- 판매가·즉시할인·할인기간
- 재고·옵션·옵션 추가금
- 대표·추가 이미지
- 카테고리·속성·태그
- 배송·반품·교환
- 상품정보제공고시
- 원산지·브랜드·제조사·카탈로그
- A/S·판매자 특이사항
- 포인트·예약구매 등 지원 필드

### 빠른 부분 수정

- 멀티 상품 변경
- 상품 벌크 업데이트
- 판매 상태 변경
- 옵션 재고/가격 변경

### 삭제

- 채널상품 삭제
- 원상품 삭제

### 우선 구현: 기존 상세페이지 교체

```text
channelProductNo 입력
→ 채널상품 조회
→ originProductNo 추출
→ 원상품 전체 스냅샷 백업
→ 새 detailContent 미리보기
→ 기존 가격·옵션·배송·고시 유지 검증
→ 원상품 또는 채널상품 수정
→ 재조회 검증
→ 이전 detailContent 롤백 지원
```

외부 API 예시:

```http
GET  /api/v1/commerce/products/channel/{channelProductNo}
GET  /api/v1/commerce/products/origin/{originProductNo}
POST /api/v1/commerce/products/search
POST /api/v1/commerce/products
POST /api/v1/commerce/products/channel/{channelProductNo}/update-plan
POST /api/v1/commerce/products/origin/{originProductNo}/update-plan
POST /api/v1/commerce/products/channel/{channelProductNo}/detail/preview
POST /api/v1/commerce/products/channel/{channelProductNo}/detail/update
POST /api/v1/commerce/products/channel/{channelProductNo}/detail/rollback
POST /api/v1/commerce/products/multi-update
POST /api/v1/commerce/products/bulk-update
POST /api/v1/commerce/products/origin/{originProductNo}/status
POST /api/v1/commerce/products/origin/{originProductNo}/option-stock
DELETE /api/v1/commerce/products/channel/{channelProductNo}
DELETE /api/v1/commerce/products/origin/{originProductNo}
```

---

## 6.3 그룹상품

- 그룹상품 등록
- 일반 상품 → 그룹상품 전환
- 그룹 해제
- 비동기 요청 결과 조회
- 상세 콘텐츠 임시 저장
- 전환 유효성 검사
- 그룹상품 조회
- 그룹상품 수정
- 그룹상품 삭제

비동기 operation은 기존 `api_operations`와 별도로 네이버 원격 작업 ID·상태를 저장한다.

---

## 6.4 상품 참조·보조 API

### 카테고리·속성·옵션

- 전체/단건/하위 카테고리
- 카테고리별 속성
- 속성값
- 속성값 단위
- 표준 옵션
- 판매 옵션 가이드
- 사이즈 타입

### 등록 보조

- 브랜드
- 제조사
- 카탈로그 목록·단건
- 원산지 전체·검색·하위
- 상품정보제공고시 목록·단건
- 추천 태그
- 제한 태그

### 배송 정책

- 묶음배송 그룹 목록·등록·조회·수정
- 희망일배송 그룹 목록·등록·조회·수정
- 반품 택배사

### 콘텐츠·검수

- 상품 이미지 다건 업로드
- 판매자 공지 목록·등록·조회·수정·삭제
- 채널상품 공지 적용
- 수정 요청 상품 목록
- 복원 요청
- 패션모델 목록·저장·수정·삭제

참조 데이터는 TTL 캐시와 스펙 버전을 기록한다.

---

## 6.5 N배송 SKU

- SKU 목록 조회
- SKU 단건 조회
- SKU 연결상품 조회
- nsId ↔ 채널상품·원상품 매핑
- N배송 사용 계정 Capability
- 정기 동기화와 변경 감지

N배송 권한이 없는 계정에서는 `permission_required` 또는 `not_enabled`로 명시한다.

---

## 6.6 주문 조회·동기화

- 주문 ID의 상품주문 ID 목록
- 조건형 상품주문 상세
- 변경 상품주문 피드
- 상품주문번호 다건 상세 조회
- 초기 Backfill
- 이후 변경분 Cursor 수집
- 누락 탐지·재수집

주문 변경 피드는 별도 sync cursor를 저장한다.

```text
commerce_sync_cursors
- seller_id
- feed_type
- last_success_from
- last_success_to
- last_event_time
- last_event_id
- updated_at
```

주문 데이터는 ChatGPT 응답에 구매자 이름·전화번호·주소·통관번호를 기본 노출하지 않는다. 전체 개인정보는 권한이 있는 관리자 UI에서만 확인한다.

---

## 6.7 발주·발송

- 발주 확인
- 발송 처리
- 발송 지연
- 배송 희망일 변경
- 다건 30개 제한 단위 Chunking
- 송장번호·택배사 검증
- 변경 피드로 결과 검증

대량 작업은 상품주문번호별 성공·실패를 분리 저장한다.

---

## 6.8 취소·반품·교환

### 취소

- 판매자 취소 요청
- 고객 취소 요청 승인

### 반품

- 반품 요청
- 반품 승인
- 보류
- 보류 해제
- 거부/철회

### 교환

- 수거 완료
- 재배송
- 보류
- 보류 해제
- 거부/철회

각 클레임 API는 현재 주문/클레임 상태를 먼저 확인하는 상태 머신을 둔다.

```text
현재 상태에서 허용되는 Action 계산
→ 요청 Preview
→ 확인
→ 실행
→ 변경 피드 재조회
```

환불·거부·철회처럼 고객에게 직접 영향을 주는 기능은 Executor 권한과 명시 확인이 필요하다.

---

## 6.9 문의

- 고객 문의 조회
- 고객 문의 답변 등록
- 고객 문의 답변 수정
- 상품 문의 목록
- 상품 문의 답변 템플릿
- 상품 문의 답변 등록/수정
- 미답변 SLA
- 답변 초안과 최종 발송 분리
- 금칙어·개인정보 검사

ChatGPT는 답변 초안을 만들 수 있고, 실제 등록은 사용자 승인 후 실행한다.

---

## 6.10 정산·부가세

- 건별 정산 내역
- 수수료 상세
- 일별 정산 내역
- 건별 부가세
- 일별 부가세
- 기간별 Backfill
- 중복 제거
- 주문·상품주문·상품 매핑
- 수익성 계산 입력
- CSV/Excel 내보내기

정산 데이터는 원본 응답과 정규화 레코드를 모두 보존한다.

---

## 6.11 판매자정보·물류

- 계정 정보
- 채널 목록
- 주소록 목록·단건
- 물류사 연동 정보
- 판매자 창고
- 오늘출발 설정 조회
- 오늘출발 설정 변경
- 출고지·반품지·교환지 템플릿 생성

상품 등록 전에 seller bootstrap을 실행해 실제 계정의 주소·채널·물류 코드를 자동으로 불러온다.

---

## 6.12 커머스솔루션

현재 HAAR가 자기 스토어만 운영하는 단계에서는 우선순위가 낮지만, 전체 지원을 위해 구현한다.

- 판매자 인증 JWE 해석
- 솔루션 사용 상태
- 비즈월렛 결제 내역
- 외부 결제 내역 전송
- 사용 시작 승인
- 사용 시작 거절
- 사용 중지
- 사용 해지 승인

이 기능은 애플리케이션 유형과 솔루션 개발사 권한에 따라 `unsupported_for_application_type`가 될 수 있다.

---

## 6.13 API데이터솔루션

공식 AI 활용 가이드는 스토어 매출·방문자 통계, 쇼핑 검색 트렌드를 API데이터솔루션 범위로 설명한다.

구현 방식:

1. 현재 계정의 API데이터솔루션 구독 여부 조회/확인
2. 구독 가능한 endpoint의 최신 상세 문서 확보
3. 별도 `data-solutions` manifest 작성
4. Quota Round 헤더 저장
5. 통계 데이터 원본 보존
6. 광고 SearchAd 성과와 결합

예상 도메인:

- 고객 현황
- 재구매
- 채널·검색 채널
- 페이지
- 상품·상품 성과
- 배송 통계
- 판매 성과
- 마케팅·검색 키워드
- 오늘 보고서

문서에 없는 endpoint나 파라미터는 추정해서 구현하지 않는다.

---

## 7. Google Drive와 상세페이지 연계

ChatGPT Drive Connector와 Hostinger 서비스 계정은 서로 다른 자격증명이다.

### 원본 카탈로그

```text
퀸실버_전체상품_20260811
→ Hostinger 서비스 계정 reader
```

### 최종 상세페이지

```text
최종상세페이지
→ Hostinger 서비스 계정 writer 필요
```

서버가 직접 상세페이지를 수정하는 흐름:

```text
Drive 완성본 폴더 조회
→ HTML/CSS 또는 최종 이미지 패키지 다운로드
→ 상세 이미지 네이버 호스팅 업로드
→ detailContent HTML 생성
→ 기존 상품 스냅샷 백업
→ Preview diff
→ 원상품/채널상품 수정
→ 재조회 검증
→ 이전 상세페이지 롤백 지원
```

백업 대상:

- 전체 원상품 응답 JSON
- 전체 채널상품 응답 JSON
- 기존 `detailContent`
- 새 `detailContent`
- 사용한 Drive 파일 ID와 체크섬
- 네이버 업로드 이미지 URL

---

## 8. 데이터 모델

### 공통 작업 원장

```text
commerce_operations
- operation_id
- operation_type
- operation_key
- endpoint_operation_id
- risk_level
- status
- request_fingerprint
- idempotency_key
- remote_resource_type
- remote_resource_id
- before_snapshot_id
- after_snapshot_id
- trace_id
- error_code
- result_json
- reconciliation_status
- created_at
- executed_at
- verified_at
```

### 스냅샷

```text
commerce_resource_snapshots
- snapshot_id
- resource_type
- resource_id
- source
- payload_json
- payload_hash
- captured_at
```

### 동기화

```text
commerce_products
commerce_channel_products
commerce_group_products
commerce_orders
commerce_product_orders
commerce_claims
commerce_inquiries
commerce_settlements
commerce_vat_records
commerce_seller_channels
commerce_addressbooks
commerce_logistics_companies
commerce_skus
commerce_capabilities
commerce_sync_cursors
```

개인정보 필드는 암호화 또는 별도 보호 테이블로 분리한다.

---

## 9. 외부 HTTP API와 ChatGPT Action

API를 네 등급으로 분리한다.

### Reader

- 조회
- 검색
- 통계
- 미리보기
- Capability

### Operator

- 변경 계획 생성
- 답변 초안
- 일괄 작업 Preview
- 승인

### Executor

- 상품 등록·수정
- 주문·클레임 처리
- 문의 답변 발송
- 배송·재고·가격 변경
- 그룹상품 작업

### Admin

- 삭제
- Spec 동기화
- Capability Active Canary
- 키 회전
- Kill Switch

OpenAPI 문서:

```text
/openapi-commerce-reader.json
/openapi-commerce-operator.json
/openapi-commerce-executor.json
/openapi-commerce-admin.json
```

### Manifest 전용 호출

자주 쓰지 않는 endpoint까지 전부 노출하기 위한 관리자용 API:

```http
POST /api/v1/commerce/operations/{operationId}:preview
POST /api/v1/commerce/operations/{operationId}:execute
```

단, `operationId`가 공식 manifest에 있고 요청 스키마 검증과 권한 검사를 통과해야 한다.

---

## 10. 확인·승인 정책

| 위험도 | 예시 | 정책 |
|---|---|---|
| Low | 카테고리·상품·정산 조회 | 즉시 실행 |
| Medium | 공지·오늘출발·문의 초안 | Preview 또는 1회 확인 |
| High | 상품 수정·가격·재고·발송·답변 등록 | 변경 전후 표시 + 확인 |
| Critical | 취소·반품 승인·거부·삭제 | 2단계 확인 + 대상 ID 재입력 |

공통 쓰기 요청:

```json
{
  "confirmation": "UPDATE_PRODUCT",
  "idempotencyKey": "...",
  "expectedBeforeHash": "...",
  "reason": "..."
}
```

삭제:

```json
{
  "confirmation": "DELETE_COMMERCE_RESOURCE",
  "secondConfirmation": "실제 대상 번호",
  "idempotencyKey": "..."
}
```

---

## 11. 권한·Capability

커머스API는 API 그룹별 권한을 요구한다. 따라서 코드가 모든 endpoint를 구현해도 현재 애플리케이션에 해당 그룹이 허용되지 않으면 호출할 수 없다.

Capability Probe는 다음을 반환한다.

```json
{
  "apiGroup": "ORDER",
  "state": "permission_required",
  "evidence": "live_call",
  "httpStatus": 403,
  "errorCode": "...",
  "checkedAt": "..."
}
```

초기 설정 체크리스트:

- 커머스API센터 애플리케이션의 가능한 API 그룹을 모두 선택
- Hostinger 외부 송신 IPv4 등록
- 판매자 SELF 인증 확인
- N배송 사용 여부
- 정산/주문 권한
- 커머스솔루션 개발사 여부
- API데이터솔루션 구독 여부

---

## 12. 개인정보·보안

### ChatGPT에 기본 비노출

- 구매자 이름
- 전화번호
- 상세 주소
- 개인통관고유부호
- 결제 식별 정보
- 네이버 토큰·Client Secret

### 로그 마스킹

- Authorization
- client_secret_sign
- access token
- 계좌·연락처·주소

### 보존

- 주문·클레임 데이터 TTL 정책
- 삭제 요청 대응
- 스냅샷 개인정보 최소화
- 감사 로그와 업무 데이터 분리

---

## 13. 스케줄러

```text
1~3분
- 변경 주문 피드

5분
- 실행 중 비동기 작업
- 품절·재고 동기화 선택 기능

15분
- 미답변 문의
- 발송 지연 위험

매일
- 상품 전체 증분 동기화
- 정산·부가세
- N배송 SKU
- 참조 코드 갱신

매주
- 공식 llms/spec 차이 검사
- Capability 재점검
```

---

## 14. 테스트 계획

### 단위

- 인증 서명
- 토큰 갱신
- 경로·쿼리 인코딩
- 각 HTTP method
- JSON/multipart/binary
- 응답 헤더
- Rate/Quota
- 개인정보 마스킹
- 요청 fingerprint
- Drift hash

### 계약

- 공식 endpoint별 request/response fixture
- 필수/선택 필드
- enum 확장
- 308/401/403/404/409/429/5xx
- partial failure

### 통합

- Mock server 115개 operation coverage
- manifest operationId별 route
- OpenAPI validation
- DB operation ledger

### 운영 Canary

- 판매자·채널 조회
- 카테고리·주소·배송 코드 조회
- 테스트 상품 신규 등록
- 상세페이지 수정·롤백
- 가격·재고·상태 변경·복원
- 공지 등록·수정·적용·삭제
- 테스트 문의 답변은 실제 테스트 문의가 있을 때만
- 주문/클레임은 실제 처리 대상이 아닌 테스트 주문 또는 사용자 지정 건에서만

---

## 15. 구현 단계

## Phase 0 — 공식 Spec와 권한 기준선

산출물:

- `operation-manifest.json`
- 115 endpoint coverage matrix
- API 그룹 권한 matrix
- 현재 계정 Capability Probe
- 버전 Diff 스크립트

완료 기준:

```text
unclassified endpoint = 0
```

## Phase 1 — 공통 클라이언트 개편

- GET/POST/PUT/PATCH/DELETE
- multipart/binary
- response headers
- endpoint별 retry
- trace/rate/quota
- operation ledger
- Reader/Operator/Executor/Admin 키

## Phase 2 — 상품 전체 기능

가장 먼저 구현한다.

- 채널/원상품 조회·수정·삭제
- 상세페이지 Preview·Update·Rollback
- 판매가·할인·재고·상태
- 상품 목록·동기화
- 이미지
- 카테고리·속성·옵션·태그·고시
- 배송 그룹·공지·검수·패션모델
- 그룹상품

Phase 2가 끝나면 이전 GPT의 “기존 상품 상세페이지 수정 API가 없다”는 제한이 해소된다.

## Phase 3 — 주문·발주·발송·클레임

- 변경 피드
- 상세 수집
- 발주/발송
- 취소/반품/교환 상태 머신
- 개인정보 보호

## Phase 4 — 문의·정산

- 고객/상품 문의
- 답변
- 정산·수수료·부가세
- 상품별 수익성 연결

## Phase 5 — 판매자·물류·N배송

- 계정·채널·주소록
- 물류사·창고
- 오늘출발
- SKU

## Phase 6 — 커머스솔루션·API데이터솔루션

- 애플리케이션 유형 Capability
- 구독 기능
- 비즈월렛·구독
- 통계 데이터

## Phase 7 — GPT Action·관리자 UI

- 전체 Reader/Operator/Executor/Admin OpenAPI
- 상품·주문·문의·정산 화면
- 변경 Preview와 승인
- 전체 작업 이력·롤백

## Phase 8 — 운영 검증

```text
Read-only full smoke
→ 상품 수정 Canary
→ 상품 등록 Canary
→ 문의/주문 권한 확인
→ 정산 Backfill
→ 스케줄러 활성화
→ GPT Executor 연결
```

---

## 16. 첫 개발 Sprint

첫 Sprint는 현재 당장 막힌 기능을 해결하면서 공통 기반을 만든다.

### Sprint 1A

- Client `patch/delete/head/download` 추가
- Response envelope와 Rate/Trace 저장
- `getOriginProduct`
- `updateOriginProduct`
- `updateChannelProduct`
- 상품번호 검색으로 channel ↔ origin 매핑

### Sprint 1B

- 기존 상세페이지 백업
- Drive 상세페이지 파일 조회
- `detailContent` Preview diff
- 상세페이지 Update
- 재조회 검증
- Rollback

### Sprint 1C

- 가격·재고·판매상태 부분 수정
- 멀티 업데이트
- 상품 목록 전체 동기화
- GPT Action 추가

추가될 Action:

```text
getChannelProduct
getOriginProduct
searchRemoteProducts
previewExistingProductUpdate
updateExistingProduct
previewExistingProductDetail
updateExistingProductDetail
rollbackExistingProductDetail
changeProductStatus
changeProductOptionStock
multiUpdateProducts
getCommerceOperation
```

---

## 17. 완료 정의

- [ ] 공식 endpoint 115개가 manifest에 존재한다.
- [ ] 각 endpoint가 구현·권한대기·구독대기·deprecated 중 하나로 분류된다.
- [ ] 미분류 endpoint가 0개다.
- [ ] API 버전 변경 자동 Diff가 동작한다.
- [ ] 전체 HTTP method·multipart·binary를 지원한다.
- [ ] Rate/Quota/Trace ID가 기록된다.
- [ ] 상품 신규 등록·조회·수정·삭제가 동작한다.
- [ ] 기존 상품 상세페이지 수정·검증·롤백이 동작한다.
- [ ] 그룹상품·참조 데이터·배송·공지·검수가 동작한다.
- [ ] 주문·발주·발송·취소·반품·교환이 동작한다.
- [ ] 고객 문의·상품 문의 조회와 답변이 동작한다.
- [ ] 정산·수수료·부가세가 수집된다.
- [ ] 판매자·채널·주소·물류·오늘출발이 동작한다.
- [ ] N배송 SKU가 Capability에 따라 동작한다.
- [ ] 커머스솔루션 endpoint가 구현되고 앱 유형을 판정한다.
- [ ] API데이터솔루션을 구독 상태에 따라 연결한다.
- [ ] Reader/Operator/Executor/Admin OpenAPI가 분리된다.
- [ ] 구매자 개인정보가 ChatGPT에 기본 노출되지 않는다.
- [ ] 모든 쓰기 작업에 스냅샷·감사 로그·결과 검증이 있다.
- [ ] Critical 작업은 2단계 확인을 요구한다.
- [ ] Hostinger 배포 및 원격 smoke/runbook이 갱신된다.

---

## 18. 다음 산출물

1. `NAVER_COMMERCE_API_COVERAGE_2_86_0.md`
2. `naver-commerce-operation-manifest.json`
3. `NAVER_COMMERCE_PERMISSION_MATRIX.md`
4. `NAVER_COMMERCE_DATA_MODEL.md`
5. `NAVER_COMMERCE_HTTP_API.md`
6. `NAVER_COMMERCE_PRIVACY_POLICY.md`
7. `NAVER_COMMERCE_RUNBOOK.md`
8. Phase 1 공통 클라이언트 코드
9. Phase 2 기존 상품 상세페이지 수정 코드

이 문서를 기준으로 Phase 0부터 구현한다.
