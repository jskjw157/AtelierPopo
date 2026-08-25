# HAAR / 아뜰리에포포 스마트스토어·Google Drive 브리지

퀸실버 상품 카탈로그를 Google Drive에서 필요할 때 내려받아 네이버 커머스API 상품 등록·운영에 사용하고, HAAR Drive 루트 안에서 파일·폴더 생성·업로드·교체·이동·복사·휴지통·복원·삭제·공유를 수행하는 Hostinger HTTP API입니다. CLI와 MCP는 기존 상품 등록 기능만 제공합니다.

현재 버전은 **`0.4.0`**입니다.

## 구현 범위

### 스마트스토어 / 네이버 커머스API

- 공식 `llms.txt`에 endpoint 링크로 열거된 116개 operation allowlist gateway
- 공식 가이드에는 있으나 endpoint 링크가 아직 없는 API데이터솔루션은 `specPendingDomains`로 추적
- 상품·그룹상품·카테고리·옵션·배송·공지·검수
- 주문·발주·발송·취소·반품·교환
- 고객 문의·상품 문의 조회와 답변
- 정산·수수료·부가세
- 판매자·채널·주소록·물류·오늘출발
- N배송 SKU와 커머스솔루션
- 기존 상품 전체 조회와 상세페이지 HTML 백업·교체·롤백
- API 그룹 Capability probe
- 공식 spec sync·coverage 검사
- 퀸실버 JSON·이미지 검증
- 공급가 기반 판매가 계산
- 옵션 추가금·품절 변환
- 이미지 JPEG 정규화·네이버 업로드
- 상품 등록 페이로드 생성
- 판매자관리코드 기반 중복 방지
- 상품 1개·소량 배치 등록
- 비동기 작업 원장과 멱등성 키

### Google Drive

- HAAR 루트 경계 검사
- 파일·폴더 검색·목록·메타데이터·권한 조회
- 작은 파일 Base64 다운로드 및 Google 문서 Export
- 폴더 생성
- 텍스트·Base64 파일 업로드
- 기존 파일 내용 교체
- 이름 변경·이동·복사
- 휴지통 이동·복원·영구 삭제
- 공유 권한 추가·삭제
- 전체 쓰기 Canary
- Drive 카탈로그 manifest 캐시
- 상품별 `product_info.json`·이미지 지연 다운로드
- 배치 실행 전 필요한 상품 자동 materialize

Drive 원본 규모는 상품 1,515개, 이미지 31,473개, 약 12.89GB이며 전체를 Hostinger에 상시 복사하지 않고 필요한 상품부터 캐시할 수 있습니다.

## 요구 환경

- Node.js `22.5.0` 이상
- 네이버 커머스API 내 스토어 애플리케이션 ID·Secret
- 네이버에 등록된 Hostinger 외부 송신 IPv4
- Hostinger API 보호용 32자 이상 Bearer Key
- Google Drive API가 활성화된 Google Cloud 프로젝트
- HAAR Drive 루트 접근 권한
- 일반 My Drive 신규 생성·업로드용 사용자 OAuth refresh token

## 설치

```bash
git clone https://github.com/jskjw157/AtelierPopo.git
cd AtelierPopo/smartstore-bridge
npm ci
cp .env.example .env
cp config/atelier-popo.example.json config/atelier-popo.json
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item .\config\atelier-popo.example.json .\config\atelier-popo.json
```

## Google Drive 인증

HAAR 루트:

```text
HAAR 상세페이지
1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
```

서비스 계정:

```text
haar-drive-catalog-reader@haar-store-gws-6f3c9a.iam.gserviceaccount.com
```

서비스 계정은 루트·퀸실버 카탈로그·최종상세페이지 폴더에서 `writer` 권한을 갖습니다. 다만 현재 루트는 일반 My Drive이므로 새 파일·폴더의 완전한 생성·업로드에는 사용자 OAuth를 사용합니다.

Google Cloud에서 데스크톱 앱 OAuth Client ID/Secret을 만든 뒤 로컬에서:

```bash
GOOGLE_OAUTH_CLIENT_ID="..." \
GOOGLE_OAUTH_CLIENT_SECRET="..." \
npm run drive:oauth
```

브라우저 승인 후 생성된 `work/google-drive-oauth.env`의 refresh token을 Hostinger Secret에 저장합니다. 기본 실행은 비밀값을 터미널에 출력하지 않습니다.

```dotenv
GOOGLE_DRIVE_AUTH_MODE=user-oauth
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_OAUTH_USER_EMAIL=JSKjw157@gmail.com
```

자세한 절차는 [`docs/GOOGLE_DRIVE_DEPLOY.md`](docs/GOOGLE_DRIVE_DEPLOY.md)를 따르세요.

## 핵심 환경변수

```dotenv
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
NAVER_TOKEN_TYPE=SELF
NAVER_ALLOW_WRITES=false

ATELIER_CATALOG_PROVIDER=google-drive
ATELIER_DRIVE_PROVIDER=google-drive
GOOGLE_DRIVE_AUTH_MODE=user-oauth
GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive

GOOGLE_DRIVE_ROOT_FOLDER_ID=1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
GOOGLE_DRIVE_CATALOG_FOLDER_ID=1OxlupopKo8BR-8_fDE72LEknRbWIoGoS
GOOGLE_DRIVE_FINAL_DETAIL_FOLDER_ID=1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y

ATELIER_DRIVE_ALLOW_WRITES=false
ATELIER_DRIVE_ALLOW_MOVES=false
ATELIER_DRIVE_ALLOW_TRASH=false
ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=false
ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=false

ATELIER_API_KEY=
ATELIER_HTTP_HOST=0.0.0.0
PORT=3000
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false

ATELIER_COMMERCE_GATEWAY_ENABLED=true
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
```

시크릿은 GitHub·채팅·캡처에 올리지 마세요.

## 실행

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
curl http://localhost:3000/openapi.json
```

인증 API:

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  http://localhost:3000/api/v1/status
```


## 네이버 커머스API 전체 operation

```text
GET  /api/v1/commerce/status
GET  /api/v1/commerce/operations
GET  /api/v1/commerce/operations/{operationId}
POST /api/v1/commerce/operations/{operationId}/preview
POST /api/v1/commerce/operations/{operationId}/execute
POST /api/v1/commerce/capabilities/probe

GET  /api/v1/commerce/products/channel/{channelProductNo}
GET  /api/v1/commerce/products/origin/{originProductNo}
POST /api/v1/commerce/products/channel/{channelProductNo}/detail/preview
POST /api/v1/commerce/products/channel/{channelProductNo}/detail/update
POST /api/v1/commerce/products/channel/{channelProductNo}/detail/rollback
```

전체 범위와 권한·확인 문구·Hostinger 설정은 [`docs/NAVER_COMMERCE_DEPLOY.md`](docs/NAVER_COMMERCE_DEPLOY.md)를 따르세요. 프로그램 구현과 네이버 커머스API센터의 API 그룹 승인은 별개이며, 실제 계정 권한은 Capability probe로 확인합니다.

## Drive 상태와 Canary

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "http://localhost:3000/api/v1/drive/status?verifyRemote=true"
```

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/drive/capabilities/probe \
  -d '{"confirmation":"RUN_DRIVE_WRITE_CANARY","idempotencyKey":"drive-canary-001"}'
```

## Drive 카탈로그

상태:

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  http://localhost:3000/api/v1/drive/catalog/status
```

상품 1895 이미지까지 동기화:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/drive/catalog/sync \
  -d '{
    "productIds":["1895"],
    "includeImages":true,
    "limit":1,
    "idempotencyKey":"drive-sync-1895-001"
  }'
```

상품 API의 `validate`, `preview`, `register`는 Drive 공급자가 설정된 경우 해당 상품 파일을 자동으로 materialize합니다.

## 주요 Drive API

```text
GET  /api/v1/drive/status
GET  /api/v1/drive/catalog/status
POST /api/v1/drive/catalog/sync
POST /api/v1/drive/cache/cleanup
POST /api/v1/drive/capabilities/probe

GET  /api/v1/drive/files
GET  /api/v1/drive/files/{fileId}
GET  /api/v1/drive/folders/{folderId}/children
GET  /api/v1/drive/files/{fileId}/permissions
POST /api/v1/drive/files/{fileId}/download

POST /api/v1/drive/folders
POST /api/v1/drive/files/upload
POST /api/v1/drive/files/{fileId}/replace
POST /api/v1/drive/files/{fileId}/rename
POST /api/v1/drive/files/{fileId}/move
POST /api/v1/drive/files/{fileId}/copy
POST /api/v1/drive/files/{fileId}/trash
POST /api/v1/drive/files/{fileId}/restore
POST /api/v1/drive/files/{fileId}/delete
POST /api/v1/drive/files/{fileId}/permissions
POST /api/v1/drive/files/{fileId}/permissions/{permissionId}/delete
POST /api/v1/drive/verify-tree
```

모든 대상과 카탈로그 폴더는 `HAAR 상세페이지` 허용 루트의 하위인지 확인합니다. 루트 밖 작업은 `DRIVE_PATH_OUTSIDE_ALLOWED_ROOT`로 차단합니다. 모든 Drive 쓰기는 `ATELIER_HTTP_ALLOW_WRITES=true`, operation별 확인 문구, 8~128자의 `idempotencyKey`가 필요하며 `202` 작업으로 접수됩니다.

## Drive 확인 문구

```text
WRITE_DRIVE_ITEM
MOVE_DRIVE_ITEM
TRASH_DRIVE_ITEM
RESTORE_DRIVE_ITEM
PERMANENTLY_DELETE_DRIVE_ITEM
CHANGE_DRIVE_PERMISSION
RUN_DRIVE_WRITE_CANARY
```

휴지통·복원·영구삭제·권한변경은 `secondConfirmation`으로 대상 ID를 다시 요구합니다.

## 스마트스토어 상품 API

```text
GET  /api/v1/products
GET  /api/v1/products/{productId}
POST /api/v1/products/{productId}/validate
POST /api/v1/products/{productId}/preview
GET  /api/v1/products/{productId}/remote
POST /api/v1/products/{productId}/register
GET  /api/v1/jobs
GET  /api/v1/operations
POST /api/v1/batches/preview
POST /api/v1/batches/register
```

상품 등록은 다음 잠금을 모두 요구합니다.

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
```

배치는 추가로:

```dotenv
ATELIER_HTTP_ALLOW_BATCH_WRITES=true
```

## 테스트

```bash
npm run check
npm run commerce:coverage
npm test
```

원격 읽기 Smoke Test:

```bash
ATELIER_BASE_URL="https://YOUR_DOMAIN" \
ATELIER_API_KEY="YOUR_API_KEY" \
ATELIER_TEST_PRODUCT_ID="1895" \
npm run test:remote
```

## Hostinger

```text
애플리케이션 루트: smartstore-bridge
설치 명령: npm ci
시작 명령: npm start
상태 확인: GET /health/ready
```

기존 커머스 배포 절차는 [`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md), Drive 절차는 [`docs/GOOGLE_DRIVE_DEPLOY.md`](docs/GOOGLE_DRIVE_DEPLOY.md), 전체 커머스API 절차는 [`docs/NAVER_COMMERCE_DEPLOY.md`](docs/NAVER_COMMERCE_DEPLOY.md)를 따르세요.

## 즉시 중지

네이버 쓰기:

```dotenv
NAVER_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
ATELIER_COMMERCE_ALLOW_WRITES=false
ATELIER_COMMERCE_ALLOW_DELETES=false
ATELIER_COMMERCE_ALLOW_ORDERS=false
ATELIER_COMMERCE_ALLOW_CLAIMS=false
ATELIER_COMMERCE_ALLOW_INQUIRIES=false
ATELIER_COMMERCE_ALLOW_SOLUTIONS=false
ATELIER_COMMERCE_ALLOW_SELLER_WRITES=false
ATELIER_COMMERCE_ALLOW_MULTIPART_UPLOADS=false
```

Drive 쓰기:

```dotenv
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_DRIVE_ALLOW_WRITES=false
ATELIER_DRIVE_ALLOW_MOVES=false
ATELIER_DRIVE_ALLOW_TRASH=false
ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=false
ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=false
```
