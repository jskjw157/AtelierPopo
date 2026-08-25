# 네이버 커머스API 전체 operation 배포·운영 런북 v0.4.0

## 1. 구현 범위

`smartstore-bridge v0.4.0`은 네이버 공식 `llms.txt` 인덱스 기준 116개 operation을 allowlist manifest로 번들합니다.

| 도메인 | 수 |
|---|---:|
| N배송 | 4 |
| 문의 | 6 |
| 상품 | 64 |
| 인증 | 1 |
| 정산 | 5 |
| 주문 | 20 |
| 커머스솔루션 | 8 |
| 판매자정보 | 8 |
| 합계 | 116 |

인증 토큰 발급은 내부 모듈에서 처리하며 generic gateway로 직접 노출하지 않습니다. 상품 이미지 업로드는 multipart/base64 파일 입력을 지원합니다. 나머지 공식 operation은 manifest의 `operationId`를 통해 호출할 수 있습니다. 공식 AI 활용 가이드에는 API데이터솔루션이 포함 범위로 안내되지만 현재 `llms.txt`에는 endpoint 링크가 열거되지 않아, 프로그램은 이를 `specPendingDomains`로 표시하고 공식 endpoint가 추가되면 spec sync로 편입합니다.

## 2. 중요한 권한 구분

프로그램에 endpoint가 구현되어 있어도 네이버 커머스API센터 애플리케이션에 해당 API 그룹 권한이 없으면 네이버가 `403`을 반환합니다.

```text
프로그램 기능 구현
+ Hostinger 쓰기 gate
+ NAVER_ALLOW_WRITES
+ 네이버 커머스API센터 API 그룹 승인
= 실제 실행 가능
```

프로그램은 네이버 관리자센터의 권한을 자동으로 확대하지 않습니다. `/api/v1/commerce/capabilities/probe`로 실제 계정에서 읽기 operation을 호출해 권한 상태를 확인할 수 있습니다.

## 3. Hostinger 환경변수

### 기본 인증

```dotenv
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
NAVER_TOKEN_TYPE=SELF
NAVER_ACCOUNT_ID=
NAVER_BASE_URL=https://api.commerce.naver.com/external

ATELIER_API_KEY=
ATELIER_HTTP_ALLOW_WRITES=false
NAVER_ALLOW_WRITES=false
```

### 전체 operation gateway

```dotenv
ATELIER_COMMERCE_GATEWAY_ENABLED=true
NAVER_COMMERCE_MANIFEST_PATH=./specs/naver-commerce/current.json
NAVER_COMMERCE_LLMS_URL=https://apicenter.commerce.naver.com/llms/llms.txt
NAVER_COMMERCE_SPEC_AUTO_SYNC=false

ATELIER_COMMERCE_ALLOW_READS=true
ATELIER_COMMERCE_ALLOW_WRITES=false
ATELIER_COMMERCE_ALLOW_DELETES=false
ATELIER_COMMERCE_ALLOW_ORDERS=false
ATELIER_COMMERCE_ALLOW_CLAIMS=false
ATELIER_COMMERCE_ALLOW_INQUIRIES=false
ATELIER_COMMERCE_ALLOW_SOLUTIONS=false
ATELIER_COMMERCE_ALLOW_SELLER_WRITES=false
ATELIER_COMMERCE_ALLOW_MULTIPART_UPLOADS=false
ATELIER_COMMERCE_ALLOW_UNVERIFIED_OPERATIONS=false
ATELIER_COMMERCE_EXPOSE_PERSONAL_DATA=false

ATELIER_COMMERCE_MAX_JSON_BODY_BYTES=16777216
ATELIER_COMMERCE_MAX_INLINE_UPLOAD_BYTES=10485760
ATELIER_COMMERCE_MAX_UPLOAD_FILES=10
ATELIER_COMMERCE_BACKUP_DIR=./work/commerce-backups
```

### 모든 쓰기 기능 활성화

조회와 검증이 끝난 뒤에만 다음 값을 켭니다.

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true

ATELIER_COMMERCE_ALLOW_WRITES=true
ATELIER_COMMERCE_ALLOW_DELETES=true
ATELIER_COMMERCE_ALLOW_ORDERS=true
ATELIER_COMMERCE_ALLOW_CLAIMS=true
ATELIER_COMMERCE_ALLOW_INQUIRIES=true
ATELIER_COMMERCE_ALLOW_SOLUTIONS=true
ATELIER_COMMERCE_ALLOW_SELLER_WRITES=true
ATELIER_COMMERCE_ALLOW_MULTIPART_UPLOADS=true
```

주문 데이터의 구매자·수령인 개인정보 원문이 꼭 필요한 운영자 화면에서만 다음을 켭니다.

```dotenv
ATELIER_COMMERCE_EXPOSE_PERSONAL_DATA=true
```

ChatGPT Action에는 개인정보 원문 노출을 기본적으로 권장하지 않습니다.

## 4. 배포 후 기본 검사

```bash
curl https://YOUR_DOMAIN/health
curl https://YOUR_DOMAIN/openapi.json
```

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/commerce/status
```

정상 기준:

```json
{
  "commerce": {
    "operationCount": 116
  }
}
```

Operation 목록:

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "https://YOUR_DOMAIN/api/v1/commerce/operations?limit=500"
```

자동 Smoke Test:

```bash
ATELIER_BASE_URL="https://YOUR_DOMAIN" \
ATELIER_API_KEY="YOUR_API_KEY" \
npm run test:commerce:remote
```

## 5. 공식 스펙 동기화

네이버 공식 인덱스를 다시 내려받아 manifest를 갱신합니다.

```bash
npm run commerce:spec:sync
npm run commerce:coverage
```

현재 기준 Coverage:

```text
공식 operation: 116
분류 operation: 116
중복 operationId: 0
미분류 operation: 0
```

스펙 동기화 결과는 코드 리뷰와 테스트 후 배포합니다. 서버 시작 때 공식 문서 변경이 곧바로 운영 호출 범위를 바꾸지 않도록 자동 동기화는 기본 비활성입니다.

## 6. Generic operation 호출 방식

### 6.1 검색

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "https://YOUR_DOMAIN/api/v1/commerce/operations?query=반품&limit=100"
```

### 6.2 미리보기

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/operations/put_v1_products_origin_products_by_origin_product_no_change_status/preview \
  -d '{
    "pathParams":{"originProductNo":"123456789"},
    "body":{"statusType":"SUSPENSION"}
  }'
```

미리보기 응답은 다음을 제공합니다.

- 실제 호출 경로
- 요청 fingerprint
- operation 위험도
- 필요한 gate
- 정확한 `confirmation`
- 고위험 작업의 `secondConfirmation`

### 6.3 읽기 실행

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/operations/get_v1_categories/execute \
  -d '{"query":{"last":true}}'
```

### 6.4 쓰기 실행

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/operations/put_v1_products_origin_products_by_origin_product_no_change_status/execute \
  -d '{
    "pathParams":{"originProductNo":"123456789"},
    "body":{"statusType":"SUSPENSION"},
    "confirmation":"EXECUTE_COMMERCE_WRITE",
    "idempotencyKey":"status-123456789-suspension-001"
  }'
```

쓰기 응답은 `202`와 `operationId`를 반환합니다.

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/operations/OPERATION_ID
```

## 7. 위험도별 확인 문구

| 위험도 | 확인 문구 |
|---|---|
| 일반 상품/설정 쓰기 | `EXECUTE_COMMERCE_WRITE` |
| 주문 이행 | `PROCESS_COMMERCE_ORDER` |
| 취소·반품·교환 | `PROCESS_COMMERCE_CLAIM` |
| 문의 답변 | `SEND_COMMERCE_RESPONSE` |
| 커머스솔루션·결제 | `EXECUTE_COMMERCE_SOLUTION` |
| 판매자 설정 | `UPDATE_COMMERCE_SELLER` |
| 삭제 | `DELETE_COMMERCE_RESOURCE` |

삭제·주문·클레임·금융 operation은 미리보기에서 반환된 `resourceKey`를 `secondConfirmation`으로 다시 보내야 합니다.

## 8. 기존 상품 상세페이지 교체

### 미리보기

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/products/channel/13732645378/detail/preview \
  -d '{"detailContent":"<div>새 상세페이지 HTML</div>"}'
```

현재 HTML과 새 HTML의 길이·SHA-256을 비교합니다.

### 수정

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/products/channel/13732645378/detail/update \
  -d '{
    "detailContent":"<div>새 상세페이지 HTML</div>",
    "confirmation":"UPDATE_PRODUCT_DETAIL",
    "secondConfirmation":"13732645378",
    "idempotencyKey":"detail-13732645378-v2"
  }'
```

프로그램은 수정 전 전체 채널상품 응답을 `ATELIER_COMMERCE_BACKUP_DIR`에 백업하고, 수정 후 상품을 다시 조회해 `detailContent` 해시를 검증합니다.

### 롤백

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/products/channel/13732645378/detail/rollback \
  -d '{
    "backupId":"BACKUP_ID",
    "confirmation":"ROLLBACK_PRODUCT_DETAIL",
    "secondConfirmation":"13732645378",
    "idempotencyKey":"rollback-detail-13732645378-001"
  }'
```

## 9. 실제 계정 Capability Probe

각 API 그룹의 대표 읽기 operation과 필요한 query를 지정합니다.

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/commerce/capabilities/probe \
  -d '{
    "operations":[
      {"operationId":"get_v1_categories"},
      {"operationId":"get_v1_seller_account"},
      {"operationId":"get_v1_seller_channels"},
      {"operationId":"get_v1_logistics_logistics_companies"}
    ]
  }'
```

`403`은 프로그램 미구현이 아니라 네이버 앱의 API 그룹 권한 부족일 수 있습니다. 커머스API센터의 애플리케이션 권한 설정을 확인합니다.

## 10. 개인정보·감사 로그

- API Key·Client Secret·Access Token은 응답과 로그에서 제거합니다.
- 주문 개인정보는 기본 마스킹합니다.
- 쓰기 작업은 SQLite `api_operations`에 멱등성 키, operation 유형, 요청 fingerprint, 결과·오류를 기록합니다.
- POST/PUT/PATCH/DELETE 네트워크 단절로 결과를 확정할 수 없으면 `NAVER_WRITE_OUTCOME_UNKNOWN`으로 처리하고 원격 상태를 확인한 뒤 재실행합니다.

## 11. 즉시 중지

```dotenv
NAVER_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_COMMERCE_ALLOW_WRITES=false
ATELIER_COMMERCE_ALLOW_DELETES=false
ATELIER_COMMERCE_ALLOW_ORDERS=false
ATELIER_COMMERCE_ALLOW_CLAIMS=false
ATELIER_COMMERCE_ALLOW_INQUIRIES=false
ATELIER_COMMERCE_ALLOW_SOLUTIONS=false
ATELIER_COMMERCE_ALLOW_SELLER_WRITES=false
ATELIER_COMMERCE_ALLOW_MULTIPART_UPLOADS=false
```

조회까지 중지하려면:

```dotenv
ATELIER_COMMERCE_GATEWAY_ENABLED=false
```
