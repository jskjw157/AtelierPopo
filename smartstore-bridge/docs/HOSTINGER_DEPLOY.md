# Hostinger 배포 및 테스트 런북

이 문서는 `smartstore-bridge` v0.2.0을 Hostinger에 배포하고, 네이버 커머스API 인증부터 상품 1개 실제 등록까지 단계적으로 검증하는 운영 절차입니다.

> 기본 원칙
>
> - 처음 배포할 때는 모든 쓰기 잠금을 `false`로 유지합니다.
> - `health → readiness → API Key → 네이버 인증 → 카탈로그 → validate → preview → 상품 1개 register` 순서를 건너뛰지 않습니다.
> - 네이버 시크릿과 `ATELIER_API_KEY`는 GitHub, 채팅, 캡처에 남기지 않습니다.
> - 첫 실등록이 끝난 뒤에는 쓰기 잠금을 다시 `false`로 내려두는 것을 권장합니다.

---

## 1. 배포 결과물과 현재 범위

Hostinger에서 다음 명령으로 HTTP API 서버를 실행할 수 있습니다.

```bash
npm start
```

서버가 제공하는 핵심 기능은 다음과 같습니다.

- 공개 상태 확인: `GET /health`, `GET /health/ready`
- OpenAPI 문서: `GET /openapi.json`
- Bearer API Key 인증
- 네이버 커머스API 인증 확인
- 퀸실버 상품 조회·검증·미리보기
- 상품 등록 작업 큐와 SQLite 작업 이력
- 멱등성 키 기반 중복 요청 방지
- 상품 1개 및 배치 등록용 HTTP API
- Docker 및 일반 Node.js 배포

다만 저장소에는 아래 운영 값이 들어 있지 않습니다.

- 아뜰리에포포 네이버 애플리케이션 ID·시크릿
- Hostinger 외부 송신 IPv4의 네이버 등록
- 실제 네이버 리프 카테고리 ID
- 배송·반품·A/S·상품정보제공고시 템플릿
- 퀸실버 JSON 및 이미지 원본 데이터

따라서 코드 배포 완료와 실상품 등록 준비 완료는 서로 다른 단계입니다.

---

## 2. 전체 연결 구조

```text
GPT Action / 관리자 / curl
            │
            │ HTTPS + Bearer ATELIER_API_KEY
            ▼
Hostinger smartstore-bridge HTTP API
            │
            ├─ 퀸실버 catalog_manifest.json / product_info.json / images
            ├─ SQLite 작업 원장
            └─ NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
                        │
                        ▼
              네이버 커머스API
                        │
                        ▼
             아뜰리에포포 스마트스토어
```

ChatGPT나 외부 도구에는 네이버 시크릿을 전달하지 않습니다. 외부 호출자는 `ATELIER_API_KEY`만 사용하고, 네이버 인증 정보는 Hostinger 환경변수에만 둡니다.

---

## 3. 배포 전 준비 체크

### 3.1 Hostinger 환경

- Node.js `22.5.0` 이상
- 애플리케이션이 외부에서 접근 가능한 HTTPS 도메인 보유
- `work` 폴더 또는 별도 영속 경로에 쓰기 가능
- 재배포 후에도 SQLite 파일이 유지되는 영속 저장소
- 퀸실버 카탈로그 폴더를 서버에서 읽을 수 있음

SQLite 작업 원장과 이미지 정규화 파일을 사용하므로, 파일시스템이 매 배포마다 초기화되는 환경보다는 VPS 또는 영속 볼륨을 제공하는 Node.js 호스팅이 적합합니다.

### 3.2 네이버 커머스API

- `내 스토어 애플리케이션` 등록 완료
- 애플리케이션 상태 `활성`
- 상품 관련 API 권한 선택
- 애플리케이션 ID·시크릿 발급
- Hostinger 외부 송신 IPv4를 `API 호출 IP`에 등록

### 3.3 로컬 코드 검증

배포 전에 저장소 루트가 아니라 `smartstore-bridge`에서 실행합니다.

```bash
git clone https://github.com/jskjw157/AtelierPopo.git
cd AtelierPopo/smartstore-bridge
npm install
npm run check
npm test
```

통과 기준:

```text
npm run check: 종료 코드 0
npm test: 실패 0개
```

---

## 4. Hostinger GitHub 배포 설정

```text
저장소             jskjw157/AtelierPopo
브랜치             main
애플리케이션 루트  smartstore-bridge
설치 명령          npm install
시작 명령          npm start
Health Check       GET /health
```

애플리케이션은 `ATELIER_HTTP_HOST=0.0.0.0`에 바인딩하고 Hostinger가 주입하는 `PORT` 값을 사용합니다. Hostinger가 `PORT`를 제공한다면 임의로 고정하지 않아도 됩니다.

배포 후 도메인 예시:

```text
https://api.atelierpopo.com
```

아래 문서에서는 이 값을 셸 변수로 사용합니다.

```bash
export BASE_URL="https://api.atelierpopo.com"
```

---

## 5. Hostinger 환경변수

처음 배포할 때는 쓰기를 모두 잠급니다.

```dotenv
NODE_ENV=production

# 네이버 커머스API
NAVER_CLIENT_ID=발급받은_애플리케이션_ID
NAVER_CLIENT_SECRET=발급받은_애플리케이션_시크릿
NAVER_TOKEN_TYPE=SELF
NAVER_ACCOUNT_ID=
NAVER_BASE_URL=https://api.commerce.naver.com/external
NAVER_ALLOW_WRITES=false

# 데이터와 설정
ATELIER_POPO_CONFIG=./config/atelier-popo.json
ATELIER_CATALOG_ROOT=/absolute/server/path/queensilver_all_products_20260809
ATELIER_TEMPLATE_FILE=./config/naver-product-template.json
ATELIER_WORK_DIR=/absolute/persistent/path/work
ATELIER_DATABASE_PATH=/absolute/persistent/path/work/atelier-popo.sqlite

# HTTP API 인증
ATELIER_API_KEY=최소32자이상의랜덤문자열
ATELIER_API_KEY_MIN_LENGTH=32
ATELIER_HTTP_HOST=0.0.0.0

# 원격 쓰기 잠금
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false

# 운영 기본값
ATELIER_TRUST_PROXY=true
ATELIER_CORS_ORIGINS=
ATELIER_MAX_BODY_BYTES=65536
ATELIER_RATE_LIMIT_PER_MINUTE=120
ATELIER_WRITE_RATE_LIMIT_PER_MINUTE=20
ATELIER_REQUEST_TIMEOUT_MS=30000
ATELIER_SHUTDOWN_TIMEOUT_MS=30000
ATELIER_OPERATION_CONCURRENCY=1
ATELIER_EXPOSE_INTERNAL_ERRORS=false
```

API Key 생성:

```bash
openssl rand -hex 32
```

키를 쉘 변수로 저장해 테스트할 수 있습니다.

```bash
export ATELIER_API_KEY="Hostinger에 등록한 API Key"
```

키 교체 기간에는 다음처럼 복수 키를 사용할 수 있습니다.

```dotenv
ATELIER_API_KEYS=old-key,new-key
```

교체가 끝나면 이전 키를 반드시 제거합니다.

---

## 6. 설정 파일과 데이터 준비

### 6.1 카테고리 매핑

`config/atelier-popo.json`의 `categories`에 네이버 리프 카테고리 ID를 넣습니다. `REPLACE_WITH_...` 플레이스홀더가 남아 있으면 실등록이 차단됩니다.

### 6.2 상품 템플릿

배송비, 출고지·반품지, 원산지, A/S, 상품정보제공고시는 실제 스마트스토어 설정을 사용해야 합니다.

기존 정상 판매 상품의 채널상품번호로 템플릿을 추출하는 방식이 가장 안전합니다.

```bash
npm run cli -- template pull 12345678901 \
  --out ./config/naver-product-template.json
```

생성 후 다음 환경변수가 파일을 가리키는지 확인합니다.

```dotenv
ATELIER_TEMPLATE_FILE=./config/naver-product-template.json
```

### 6.3 퀸실버 데이터

서버에서 다음 구조를 유지해야 합니다.

```text
queensilver_all_products_20260809/
├─ catalog_manifest.json
├─ collection_report.md
└─ 카테고리/
   └─ 상품번호_상품명/
      ├─ product_info.json
      ├─ product_info.txt
      └─ images/
```

`ATELIER_CATALOG_ROOT`는 `catalog_manifest.json`이 존재하는 최상위 폴더를 가리켜야 합니다.

전체 원본은 크므로 Git 저장소에 커밋하지 말고 SFTP, `rsync`, 영속 볼륨 또는 별도 스토리지 동기화 방식으로 배치합니다.

예시 확인:

```bash
ls -lh "$ATELIER_CATALOG_ROOT/catalog_manifest.json"
find "$ATELIER_CATALOG_ROOT" -name product_info.json | wc -l
```

---

## 7. Hostinger 외부 송신 IPv4 등록

Hostinger 서버 터미널에서 확인합니다.

```bash
curl -4 https://api.ipify.org
```

예시 출력:

```text
123.45.67.89
```

이 값을 네이버 커머스API센터의 애플리케이션 `API 호출 IP`에 등록합니다.

등록 대상은 다음이 아닙니다.

```text
127.0.0.1
localhost
192.168.x.x
10.x.x.x
도메인 주소
```

네이버 인증에서 `GW.IP_NOT_ALLOWED`가 발생하면 가장 먼저 실제 송신 IP와 등록 IP를 비교합니다.

---

## 8. 1단계: 공개 Health 테스트

### 8.1 프로세스 생존 확인

```bash
curl -i "$BASE_URL/health"
```

통과 기준:

```text
HTTP 200
응답 JSON의 ok=true
```

### 8.2 운영 준비 상태 확인

```bash
curl -i "$BASE_URL/health/ready"
```

`/health`는 프로세스가 살아 있는지 확인하고, `/health/ready`는 API Key·설정·카탈로그 등 운영 준비 상태를 확인합니다.

통과 기준:

```text
HTTP 200
ok=true
status=ready
readiness.readyForRead=true
readiness.readyForPreview=true
```

`/health`는 성공하지만 `/health/ready`가 실패하면 애플리케이션을 재배포하기 전에 환경변수와 경로부터 수정합니다.

### 8.3 OpenAPI 문서 확인

```bash
curl -i "$BASE_URL/openapi.json"
```

통과 기준:

```text
HTTP 200
openapi=3.1.x
/api/v1/products/{productId}/preview 경로 존재
/api/v1/products/{productId}/register 경로 존재
```

---

## 9. 2단계: HTTP API 인증 테스트

### 9.1 정상 API Key

```bash
curl -i \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "$BASE_URL/api/v1/status"
```

통과 기준:

```text
HTTP 200
ok=true
네이버 시크릿이나 액세스 토큰이 응답에 노출되지 않음
```

### 9.2 API Key 누락

```bash
curl -i "$BASE_URL/api/v1/status"
```

통과 기준:

```text
HTTP 401
```

### 9.3 잘못된 API Key

```bash
curl -i \
  -H "Authorization: Bearer definitely-wrong-key" \
  "$BASE_URL/api/v1/status"
```

통과 기준:

```text
HTTP 401
```

이 두 음성 테스트가 통과해야 외부 공개 상태에서 기본 인증이 정상이라고 볼 수 있습니다.

---

## 10. 3단계: 네이버 인증 테스트

```bash
curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/auth/test" \
  -d '{}'
```

통과 기준:

```text
HTTP 200
네이버 액세스 토큰 발급 성공
응답에 Client Secret 또는 액세스 토큰 원문이 노출되지 않음
```

주요 실패 원인:

```text
인증 정보 오류
→ NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 재확인

GW.IP_NOT_ALLOWED
→ Hostinger 외부 송신 IPv4를 네이버 호출 IP에 등록

권한 오류
→ 내 스토어 애플리케이션의 상품 API 권한과 활성 상태 확인
```

---

## 11. 4단계: 카탈로그 테스트

### 11.1 통계 확인

```bash
curl -i \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "$BASE_URL/api/v1/catalog/stats"
```

통과 기준:

- HTTP `200`
- 카탈로그 루트가 정상 인식됨
- 상품 수가 예상 범위와 일치함
- 서버의 절대 파일 경로가 외부 응답에 노출되지 않음

### 11.2 상품 목록 확인

```bash
curl -i \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "$BASE_URL/api/v1/products?limit=10"
```

### 11.3 특정 상품 확인

```bash
export TEST_PRODUCT_ID="1905"

curl -i \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "$BASE_URL/api/v1/products/$TEST_PRODUCT_ID"
```

통과 기준:

```text
HTTP 200
product.productId가 요청한 상품번호와 일치
상품명·카테고리·원본 상태가 정상
```

---

## 12. 5단계: 상품 검증과 미리보기

### 12.1 Validate

```bash
curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PRODUCT_ID/validate" \
  -d '{}'
```

통과 기준:

```text
HTTP 200
ok=true
errors=[]
product.imageCount > 0
```

검증 오류가 있으면 등록 단계로 이동하지 않습니다.

### 12.2 Preview

```bash
curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PRODUCT_ID/preview?includePayload=true" \
  -d '{}'
```

반드시 확인할 항목:

- `validationErrors`가 빈 배열
- `executable=true`
- 네이버 리프 카테고리 ID
- 상품명과 판매가
- 옵션명, 옵션 추가금, 옵션 품절 상태
- 대표 이미지와 추가 이미지 순서
- 배송비와 배송 방식
- 출고지·반품지
- 원산지와 A/S
- 상품정보제공고시
- 판매자관리코드가 `QUEEN-<상품번호>` 형태
- 서버 절대경로, Client Secret, 네이버 토큰 미노출

위 항목 중 하나라도 이상하면 실등록을 열지 않습니다.

### 12.3 자동 원격 Smoke Test

저장소의 읽기 전용 smoke test 스크립트로 위 단계를 자동 확인할 수 있습니다. 이 스크립트는 상품 등록·수정·배치 API를 호출하지 않습니다.

전체 테스트:

```bash
ATELIER_BASE_URL="$BASE_URL" \
ATELIER_API_KEY="$ATELIER_API_KEY" \
ATELIER_TEST_PRODUCT_ID="$TEST_PRODUCT_ID" \
npm run test:remote
```

인프라와 API Key 연결만 먼저 확인할 때:

```bash
ATELIER_BASE_URL="$BASE_URL" \
ATELIER_API_KEY="$ATELIER_API_KEY" \
ATELIER_SMOKE_MODE="infra" \
npm run test:remote
```

`full` 모드는 기본적으로 다음 항목을 모두 통과해야 종료 코드 `0`을 반환합니다.

```text
/health
/openapi.json
/api/v1/status
/health/ready
/api/v1/auth/test
/api/v1/catalog/stats
/api/v1/products/{productId}
/api/v1/products/{productId}/validate
/api/v1/products/{productId}/preview
```

Preview가 아직 실행 가능 상태인지 강제 확인하지 않으려면 다음 값을 일시적으로 사용할 수 있습니다.

```bash
ATELIER_SMOKE_REQUIRE_EXECUTABLE=false npm run test:remote
```

운영 전 최종 smoke test에서는 이 예외를 사용하지 않고 `executable=true`를 확인합니다.

---

## 13. 6단계: 쓰기 잠금 음성 테스트

처음에는 환경변수가 다음 상태여야 합니다.

```dotenv
NAVER_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
```

등록 요청을 보내도 차단되는지 확인합니다.

```bash
curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PRODUCT_ID/register" \
  -d '{
    "confirmation":"REGISTER",
    "idempotencyKey":"locked-write-test-1905"
  }'
```

통과 기준:

```text
HTTP 403
NAVER_WRITES_DISABLED 또는 HTTP_WRITES_DISABLED
스마트스토어에 상품이 생성되지 않음
```

이 테스트가 실패하면 운영 공개 전에 배포를 중단합니다.

---

## 14. 7단계: 상품 1개 실제 등록

### 14.1 쓰기 잠금 열기

Preview 검수 후 Hostinger 환경변수를 다음처럼 변경합니다.

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
```

환경변수 변경 후 프로세스를 재시작하고 `/health`, `/health/ready`, `/api/v1/status`를 다시 확인합니다.

### 14.2 단일 상품 등록 요청

새롭고 의미 있는 멱등성 키를 사용합니다.

```bash
export IDEMPOTENCY_KEY="register-${TEST_PRODUCT_ID}-first-production-test"

curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PRODUCT_ID/register" \
  -d "{\"confirmation\":\"REGISTER\",\"idempotencyKey\":\"$IDEMPOTENCY_KEY\"}"
```

정상 접수 기준:

```text
HTTP 202
ok=true
operation.operationId 존재
operation.status=queued 또는 running
poll 경로 존재
```

### 14.3 작업 상태 폴링

등록 응답의 `operationId`를 사용합니다.

```bash
export OPERATION_ID="반환된 operationId"

curl -i \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "$BASE_URL/api/v1/operations/$OPERATION_ID"
```

완료 기준:

```text
status=succeeded 또는 이미 존재하는 상품이면 중복 방지 결과
네이버 상품번호 또는 등록 결과 확인 가능
```

실패 기준:

```text
status=failed
```

실패한 경우 오류를 확인하고, 스마트스토어센터에서 실제 상품 생성 여부를 먼저 확인한 뒤 재시도합니다. 결과를 확인하지 않은 상태에서 새 멱등성 키로 즉시 재실행하면 중복 등록 위험이 있습니다.

### 14.4 멱등성 재요청 테스트

동일한 요청을 같은 멱등성 키로 한 번 더 전송합니다.

```bash
curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/products/$TEST_PRODUCT_ID/register" \
  -d "{\"confirmation\":\"REGISTER\",\"idempotencyKey\":\"$IDEMPOTENCY_KEY\"}"
```

통과 기준:

```text
새 상품을 만들지 않음
기존 operation을 재사용
reused=true 또는 동일 operationId 반환
```

### 14.5 스마트스토어센터 수동 검수

아래 항목을 직접 확인합니다.

- 상품이 정확히 1개만 생성됨
- 상품명
- 판매가
- 카테고리
- 대표 이미지
- 추가 이미지 순서와 품질
- 옵션명과 추가금
- 품절 옵션
- 재고
- 배송비와 배송 방식
- 출고지·반품지
- 원산지
- A/S
- 상품정보제공고시
- 판매 상태

검수 결과가 정상일 때만 다음 단계로 이동합니다.

### 14.6 쓰기 잠금 다시 닫기

첫 실등록 검수 후 권장 상태:

```dotenv
NAVER_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
```

---

## 15. 소량 배치 전개 절차

배치 쓰기는 별도 잠금을 사용합니다.

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_BATCH_WRITES=true
```

권장 전개 순서:

```text
1개 실등록 검수
→ 3개 배치
→ 10개 배치
→ 실패율·상품 품질 확인
→ 20개 이하 단위 운영
```

배치 등록 전에는 먼저 Preview 배치를 실행하고, 실패 또는 검증 오류가 없는 상품만 등록합니다.

```bash
curl -i -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/v1/batches/preview" \
  -d '{"productIds":["1905","1897","1895"]}'
```

실제 배치 요청은 각 상품에 대한 Preview 검수와 쓰기 잠금 확인 후 진행합니다. 배치가 끝나면 `ATELIER_HTTP_ALLOW_BATCH_WRITES=false`로 즉시 되돌립니다.

---

## 16. 재시작 및 영속성 테스트

### 16.1 작업 원장 유지 확인

```bash
curl -H "Authorization: Bearer $ATELIER_API_KEY" \
  "$BASE_URL/api/v1/operations?limit=20"
```

Hostinger 프로세스를 재시작한 뒤 같은 요청을 다시 실행합니다.

통과 기준:

```text
기존 operation 이력이 유지됨
SQLite 파일이 재배포 후에도 유지됨
```

### 16.2 처리 중 재시작

실행 중이던 작업이 서버 재시작으로 중단되면 `interrupted`로 표시될 수 있습니다. 프로그램은 이를 자동 재등록하지 않습니다.

처리 순서:

```text
1. 스마트스토어센터에서 실제 상품 생성 여부 확인
2. 판매자관리코드 QUEEN-<상품번호> 검색
3. 기존 operation 오류 확인
4. 중복이 없다고 확인된 경우에만 새 멱등성 키로 재실행
```

---

## 17. 보안 테스트

배포 후 최소한 아래 항목을 확인합니다.

| 테스트 | 기대 결과 |
|---|---|
| `/health` 무인증 호출 | `200` |
| `/api/v1/status` 무인증 호출 | `401` |
| 잘못된 Bearer 키 | `401` |
| 쓰기 잠금이 닫힌 등록 요청 | `403` |
| 잘못된 `confirmation` | `400` |
| 존재하지 않는 상품번호 | `404` |
| 동일 멱등성 키 재요청 | 새 등록 없음 |
| 응답 본문 검색 | Secret·토큰·절대경로 미노출 |
| HTTPS가 아닌 HTTP 접근 | HTTPS 리다이렉트 또는 차단 |

범용 쉘 실행 API나 임의 파일 경로 입력 API는 추가하지 않습니다.

```text
금지 예시
POST /shell
POST /run-command
POST /files?path=/etc/...
```

---

## 18. 장애 코드와 조치

```text
401 UNAUTHORIZED
→ Authorization: Bearer 헤더와 ATELIER_API_KEY 확인

503 API_AUTH_NOT_CONFIGURED
→ API 키 누락 또는 ATELIER_API_KEY_MIN_LENGTH보다 짧음

GW.IP_NOT_ALLOWED
→ Hostinger 외부 송신 IPv4와 네이버 등록 IP 비교

네이버 인증 실패
→ NAVER_CLIENT_ID / NAVER_CLIENT_SECRET / 애플리케이션 활성 상태 확인

NAVER_WRITES_DISABLED
→ NAVER_ALLOW_WRITES가 false

HTTP_WRITES_DISABLED
→ ATELIER_HTTP_ALLOW_WRITES가 false

HTTP_BATCH_WRITES_DISABLED
→ ATELIER_HTTP_ALLOW_BATCH_WRITES가 false

PRODUCT_NOT_EXECUTABLE
→ 카테고리, 템플릿, 품절, 필수 필드와 validationErrors 확인

404 CATALOG_PRODUCT_NOT_FOUND
→ catalog_manifest.json과 상품번호 확인

409 IDEMPOTENCY_KEY_REUSED 또는 IDEMPOTENCY_CONFLICT
→ 같은 멱등성 키를 다른 상품 또는 다른 작업에 재사용했는지 확인

429 RATE_LIMITED
→ 호출 속도를 낮추고 재시도 간격 적용

502 NAVER_API_ERROR
→ 네이버 응답 코드, 권한, 요청 페이로드 확인

interrupted operation
→ 스마트스토어 중복 여부를 먼저 확인하고 수동 판단 후 재실행
```

---

## 19. 롤백 절차

배포 또는 실등록에 문제가 생기면 다음 순서로 중단합니다.

1. Hostinger 환경변수에서 쓰기 잠금을 모두 닫습니다.

```dotenv
NAVER_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
```

2. 애플리케이션을 재시작합니다.
3. `/health`와 `/api/v1/status`를 확인합니다.
4. 잘못 등록된 상품은 스마트스토어센터에서 상태를 확인한 뒤 수동 조치합니다.
5. 코드 문제라면 이전 정상 커밋으로 재배포합니다.
6. SQLite 작업 원장은 삭제하지 않고 장애 분석 자료로 보관합니다.
7. API Key가 노출됐다면 즉시 새 키를 발급하고 이전 키를 제거합니다.
8. 네이버 시크릿이 노출됐다면 네이버 커머스API센터에서 시크릿을 재발급합니다.

롤백 대상은 Hostinger 배포 이력 또는 `git log`에서 확인한 **직전 정상 커밋**을 사용합니다. 기능이 정상이라고 검증된 커밋 SHA를 운영 기록에 별도로 남겨두세요.

---

## 20. 배포 완료 체크리스트

### 배포

- [ ] Hostinger 애플리케이션 루트가 `smartstore-bridge`다.
- [ ] Node.js 버전이 `22.5.0` 이상이다.
- [ ] `npm install`이 성공했다.
- [ ] `npm start`가 성공했다.
- [ ] 도메인에 HTTPS가 적용됐다.
- [ ] `work`와 SQLite 경로가 영속 저장소다.

### 네이버 및 설정

- [ ] `NAVER_CLIENT_ID`와 `NAVER_CLIENT_SECRET`을 Hostinger 환경변수에만 저장했다.
- [ ] Hostinger 외부 송신 IPv4를 네이버 `API 호출 IP`에 등록했다.
- [ ] 실제 리프 카테고리 ID를 입력했다.
- [ ] 배송·반품·A/S·상품고시 템플릿을 준비했다.
- [ ] 퀸실버 카탈로그와 이미지 폴더가 서버에서 읽힌다.

### 읽기 테스트

- [ ] `GET /health`가 `200`이다.
- [ ] `GET /health/ready`가 준비 완료 상태다.
- [ ] `GET /openapi.json`이 정상이다.
- [ ] API Key 누락·오류 요청이 `401`이다.
- [ ] 네이버 인증 테스트가 성공했다.
- [ ] 카탈로그 통계와 상품 조회가 정상이다.
- [ ] 상품 Validate와 Preview가 정상이다.
- [ ] `npm run test:remote` full 모드가 종료 코드 `0`으로 통과한다.

### 쓰기 테스트

- [ ] 쓰기 잠금 상태에서 등록 요청이 `403`으로 차단된다.
- [ ] 첫 실등록 전에 상품 Preview를 사람이 검수했다.
- [ ] 상품 1개 등록만 실행했다.
- [ ] operation이 `succeeded`인지 확인했다.
- [ ] 같은 멱등성 키 재요청으로 중복이 생기지 않았다.
- [ ] 스마트스토어센터에서 상품 전체 정보를 검수했다.
- [ ] 테스트 후 쓰기 잠금을 다시 닫았다.

### 운영 준비

- [ ] 재시작 후 SQLite 작업 이력이 유지된다.
- [ ] Secret·토큰·절대경로가 API 응답과 로그에 노출되지 않는다.
- [ ] API Key 교체 및 롤백 절차를 확인했다.
- [ ] 배치는 `3개 → 10개 → 20개 이하` 단계로 확대한다.

---

## 21. Docker/VPS 배포 예시

```bash
cp .env.example .env
cp config/atelier-popo.example.json config/atelier-popo.json
# .env와 실제 설정 파일 입력

docker build -t atelier-popo-smartstore .

docker run -d \
  --name atelier-popo-smartstore \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v /host/work:/app/work \
  -v /host/queensilver:/data/catalog:ro \
  -e ATELIER_CATALOG_ROOT=/data/catalog \
  atelier-popo-smartstore
```

확인:

```bash
docker ps
docker logs --tail 200 atelier-popo-smartstore
curl http://127.0.0.1:3000/health
```

`docker-compose.example.yml`도 저장소에 포함되어 있습니다.

---

## 22. GPT Action 연결 전 최종 확인

배포와 테스트가 모두 끝난 뒤 OpenAPI 주소를 사용합니다.

```text
https://YOUR_DOMAIN/openapi.json
```

GPT Action 인증 값은 `ATELIER_API_KEY`이며 네이버 Client Secret이 아닙니다.

연결 전 최소 조건:

```text
HTTPS 정상
API Key 인증 정상
네이버 인증 정상
Preview 정상
쓰기 잠금 기본 false
상품 1개 실등록 검증 완료
```
