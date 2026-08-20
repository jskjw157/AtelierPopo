# 아뜰리에포포 스마트스토어 브리지

퀸실버 수집 상품 데이터(`catalog_manifest.json`, 각 상품의 `product_info.json`, `images/`)를 읽어 네이버 커머스API 상품 등록 요청으로 변환하는 **CLI + 로컬 MCP + Hostinger 배포용 HTTP API**입니다.

현재 버전은 `0.2.0`입니다.

## 구현 범위

- 퀸실버 JSON 및 이미지 구조 검증
- 공급가 기반 판매가 계산
- 옵션 추가금·품절 변환
- WebP/JPG 원본을 네이버용 JPEG로 정규화
- 네이버 이미지 업로드 및 상품 페이로드 생성
- 판매자관리코드(`QUEEN-<상품번호>`) 기반 중복 방지
- SQLite 상품 작업 원장
- CLI 배치 dry-run·등록·실패 재시도
- 로컬 stdio MCP 도구
- Bearer API Key로 보호된 HTTP API
- 비동기 상품 등록 작업과 멱등성 키
- OpenAPI 3.1 문서
- Docker/Hostinger 배포 파일

## 1. 요구 환경

- Node.js `22.5.0` 이상
- 네이버 커머스API센터의 **내 스토어 애플리케이션**
- 실제 네이버 API 호출 서버의 등록된 공인 IPv4
- 퀸실버 전체 데이터가 내려받아졌거나 서버에 마운트된 폴더
- 쓰기 작업을 사용할 경우 완성된 네이버 상품 템플릿과 카테고리 매핑

## 2. 설치

```bash
git clone https://github.com/jskjw157/AtelierPopo.git
cd AtelierPopo/smartstore-bridge
npm install
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item .\config\atelier-popo.example.json .\config\atelier-popo.json
```

macOS/Linux:

```bash
cp .env.example .env
cp config/atelier-popo.example.json config/atelier-popo.json
```

## 3. 핵심 환경변수

```dotenv
NAVER_CLIENT_ID=발급받은_애플리케이션_ID
NAVER_CLIENT_SECRET=발급받은_애플리케이션_시크릿
NAVER_TOKEN_TYPE=SELF
NAVER_ALLOW_WRITES=false

ATELIER_POPO_CONFIG=./config/atelier-popo.json
ATELIER_CATALOG_ROOT=/absolute/path/to/queensilver_all_products_20260809
ATELIER_TEMPLATE_FILE=./config/naver-product-template.json
ATELIER_WORK_DIR=./work
ATELIER_DATABASE_PATH=./work/atelier-popo.sqlite

ATELIER_API_KEY=최소_32자_이상의_랜덤_API키
ATELIER_HTTP_HOST=0.0.0.0
PORT=3000
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
```

네이버 시크릿과 HTTP API 키는 GitHub, 채팅, 캡처에 올리지 마세요.

### 경로 우선순위

다음 환경변수는 JSON 설정 파일의 경로 값을 덮어씁니다.

- `ATELIER_CATALOG_ROOT`
- `ATELIER_TEMPLATE_FILE`
- `ATELIER_WORK_DIR`
- `ATELIER_DATABASE_PATH`

따라서 Hostinger에서는 저장소 파일을 수정하지 않고 환경변수로 데이터와 영속 볼륨 경로를 지정할 수 있습니다.

## 4. 카테고리와 상품 템플릿

`config/atelier-popo.json`의 `categories` 값을 네이버 **리프 카테고리 ID**로 교체합니다. 플레이스홀더가 남아 있으면 실제 등록은 차단됩니다.

기존 스마트스토어 액세서리 상품 1개의 채널상품번호를 이용해 배송·반품·A/S·상품고시 템플릿을 추출할 수 있습니다.

```bash
npm run cli -- template pull 12345678901 --out ./config/naver-product-template.json
```

## 5. HTTP API 실행

```bash
npm start
```

기본 주소:

```text
http://localhost:3000
```

확인:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

OpenAPI:

```text
GET /openapi.json
```

`/health`, `/health/ready`, `/openapi.*` 외의 API는 Bearer 키가 필요합니다.

```bash
curl -H "Authorization: Bearer $ATELIER_API_KEY" \
  http://localhost:3000/api/v1/status
```

### 주요 API

```text
GET  /api/v1/status
POST /api/v1/auth/test
GET  /api/v1/catalog/stats
POST /api/v1/catalog/enqueue
GET  /api/v1/products
GET  /api/v1/products/{productId}
POST /api/v1/products/{productId}/validate
POST /api/v1/products/{productId}/preview
GET  /api/v1/products/{productId}/remote
POST /api/v1/products/{productId}/register
GET  /api/v1/jobs
GET  /api/v1/jobs/{productId}
GET  /api/v1/operations
GET  /api/v1/operations/{operationId}
POST /api/v1/batches/preview
POST /api/v1/batches/register
```

외부 API는 임의 서버 파일 경로를 받지 않고 **퀸실버 상품번호만** 받습니다. 서버는 `catalog_manifest.json`에서 상품 경로를 안전하게 찾아 처리합니다.

## 6. 상품 1개 미리보기

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/v1/products/1905/preview?includePayload=true" \
  -d '{}'
```

미리보기 응답에서는 서버의 절대 파일 경로를 제거합니다. 실제 네이버 등록 전 다음을 확인하세요.

- `validationErrors`가 빈 배열인지
- `executable`이 `true`인지
- 카테고리 ID와 판매가
- 옵션 추가금과 품절 상태
- 대표·상세 이미지 순서
- 배송·반품·A/S·상품정보제공고시

## 7. 상품 등록은 비동기 작업

원격 쓰기는 다음 세 조건이 모두 필요합니다.

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
```

그리고 요청 본문의 확인 문구:

```json
{
  "confirmation": "REGISTER",
  "idempotencyKey": "register-1905-20260820-001"
}
```

요청:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/products/1905/register \
  -d '{"confirmation":"REGISTER","idempotencyKey":"register-1905-20260820-001"}'
```

이미지 변환·업로드에 시간이 걸릴 수 있으므로 등록 API는 `202 Accepted`와 `operationId`를 즉시 반환합니다.

```bash
curl -H "Authorization: Bearer $ATELIER_API_KEY" \
  http://localhost:3000/api/v1/operations/반환된_operationId
```

같은 `idempotencyKey`를 재전송하면 새 등록을 만들지 않고 기존 작업을 반환합니다. 동시에 판매자관리코드로 스마트스토어 중복 여부도 다시 검사합니다.

배치 등록은 추가로 다음 값이 필요합니다.

```dotenv
ATELIER_HTTP_ALLOW_BATCH_WRITES=true
```

기본 큐 동시 실행 수는 `1`이며 최대 `4`까지 설정할 수 있습니다.

## 8. HTTP 보안 기본값

- API Key 최소 길이 기본값 `32`
- API 키 상수 시간 비교
- 읽기/쓰기 분당 호출 제한 분리
- 요청 본문 기본 최대 `64KB`
- CORS 기본 비활성
- 원격 쓰기와 배치 쓰기 별도 잠금
- 상품번호 기반 접근만 허용하며 임의 파일 경로·쉘 명령 미노출
- 서버 절대경로와 네이버 액세스 토큰 응답 차단
- 비동기 작업 SQLite 기록 및 프로세스 재시작 중단 상태 표시
- 이미지 업로드 성공 후 정규화 캐시 기본 삭제

## 9. Hostinger 배포

자세한 절차는 [`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md)를 참고하세요.

핵심 설정:

```text
애플리케이션 루트: smartstore-bridge
설치 명령: npm install
시작 명령: npm start
포트: Hostinger가 제공하는 PORT 환경변수 사용
상태 확인: GET /health
```

Hostinger 서버에서 확인한 외부 송신 IPv4를 네이버 커머스API센터의 `API 호출 IP`에 등록해야 합니다.

Docker 배포 파일도 포함되어 있습니다.

```bash
docker build -t atelier-popo-smartstore .
docker run --env-file .env -p 3000:3000 atelier-popo-smartstore
```

## 10. CLI

```bash
npm run cli -- auth test
npm run cli -- catalog stats "/data/queensilver_all_products_20260809"
npm run cli -- product validate "/data/.../product_info.json"
npm run cli -- product preview "/data/.../product_info.json"
npm run cli -- product create "/data/.../product_info.json" --execute --confirm REGISTER
npm run cli -- batch enqueue "/data/queensilver_all_products_20260809"
npm run cli -- batch run --limit 10 --status queued
npm run cli -- batch status --status failed
```

CLI 실제 쓰기도 `NAVER_ALLOW_WRITES=true`와 `--execute --confirm REGISTER`가 모두 필요합니다.

## 11. 로컬 MCP

```bash
npm run mcp
npm run inspect:mcp
```

제공 도구:

- `atelier_auth_test`
- `atelier_catalog_stats`
- `atelier_preview_product`
- `atelier_find_product`
- `atelier_create_product`
- `atelier_batch_status`

현재 MCP는 로컬 `stdio` 방식입니다. Hostinger 외부 호출은 HTTP API를 사용합니다.

## 12. 테스트

```bash
npm run check
npm test
```

테스트 범위에는 가격·옵션·페이로드·카탈로그 경로·SQLite 멱등성 작업·HTTP 인증·절대경로 차단·비동기 등록·원격 쓰기 잠금이 포함됩니다.

## 실제 계정에서 남은 최종 확인

코드는 배포 가능한 상태지만 아래 실제 값은 저장소에 들어 있지 않습니다.

- 아뜰리에포포 네이버 애플리케이션 ID와 시크릿
- Hostinger 서버의 네이버 API 호출 IP 등록
- 실제 리프 카테고리 ID
- 배송·반품·A/S·상품고시 템플릿
- Hostinger에 배치된 퀸실버 JSON·이미지 폴더

따라서 운영 순서는 `인증 테스트 → 상품 1개 preview → 상품 1개 등록 → 스마트스토어센터 검수 → 소량 배치`로 진행해야 합니다.
