# Hostinger Google Drive 전체 쓰기 배포 절차

> 대상 버전: `smartstore-bridge 0.3.0`

## 1. 현재 Drive 경계

```text
HAAR 상세페이지
1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
├─ 퀸실버_전체상품_20260811
│  1OxlupopKo8BR-8_fDE72LEknRbWIoGoS
└─ 최종상세페이지
   1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y
```

서비스 계정은 위 루트와 하위 폴더에서 `writer` 권한을 가진다.

## 2. 일반 My Drive의 새 파일 생성 인증

현재 HAAR 루트는 Shared Drive가 아니라 일반 My Drive다. 서비스 계정은 읽기와 기존 공유 파일 편집에는 사용할 수 있지만, 새 파일·폴더 업로드를 완전하게 운영하려면 사용자 OAuth refresh token을 사용한다.

Google Cloud에서 OAuth 클라이언트 유형을 **데스크톱 앱**으로 만들고 Client ID와 Client Secret을 준비한다.

로컬에서:

```bash
cd smartstore-bridge

GOOGLE_OAUTH_CLIENT_ID="..." \
GOOGLE_OAUTH_CLIENT_SECRET="..." \
npm run drive:oauth
```

브라우저에서 HAAR Drive 소유 계정으로 승인한다. 스크립트가 `work/google-drive-oauth.env`에 비밀값을 권한 `0600`으로 저장한다. 파일의 다음 값을 Hostinger Secret에 복사한다.

```dotenv
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_OAUTH_USER_EMAIL=JSKjw157@gmail.com
```

기본 실행은 비밀값을 터미널에 출력하지 않는다. 필요할 때만 로컬에서 `npm run drive:oauth -- --print-secrets`를 사용하며, Refresh token과 Client Secret은 GitHub나 채팅에 올리지 않는다.

## 3. Hostinger 환경변수

```dotenv
ATELIER_CATALOG_PROVIDER=google-drive
ATELIER_DRIVE_PROVIDER=google-drive
GOOGLE_DRIVE_AUTH_MODE=user-oauth
GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive

GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_OAUTH_USER_EMAIL=JSKjw157@gmail.com

# 서비스 계정은 보조 읽기 자격증명으로 보관 가능
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=

GOOGLE_DRIVE_ROOT_FOLDER_ID=1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
GOOGLE_DRIVE_CATALOG_FOLDER_ID=1OxlupopKo8BR-8_fDE72LEknRbWIoGoS
GOOGLE_DRIVE_FINAL_DETAIL_FOLDER_ID=1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y

ATELIER_DRIVE_ALLOW_WRITES=true
ATELIER_DRIVE_ALLOW_MOVES=true
ATELIER_DRIVE_ALLOW_TRASH=true
ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=true
ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=true
ATELIER_DRIVE_REQUIRE_USER_OAUTH_FOR_MY_DRIVE_CREATES=true

ATELIER_DRIVE_MAX_UPLOAD_BYTES=1073741824
ATELIER_DRIVE_MAX_JSON_BODY_BYTES=16777216
ATELIER_DRIVE_MAX_INLINE_DOWNLOAD_BYTES=10485760
ATELIER_DRIVE_CACHE_DIR=/tmp/atelier-drive-cache
ATELIER_DRIVE_CACHE_TTL_SECONDS=3600
ATELIER_DRIVE_REQUEST_TIMEOUT_MS=60000
ATELIER_DRIVE_MAX_RETRIES=4
```

서비스 계정만으로 우선 읽기 테스트할 때는:

```dotenv
GOOGLE_DRIVE_AUTH_MODE=service-account
```

으로 둘 수 있다. 이 모드에서 일반 My Drive의 신규 생성·업로드·복사는 `DRIVE_MY_DRIVE_CREATE_REQUIRES_USER_OAUTH`로 차단된다.

## 4. 배포

```text
애플리케이션 루트: smartstore-bridge
설치 명령: npm install
시작 명령: npm start
Health Check: GET /health
```

`package.json`의 `npm start`는 v0.3.0 Drive 통합 서버를 실행한다.

## 5. 배포 후 읽기 확인

```bash
curl https://YOUR_DOMAIN/health

curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  "https://YOUR_DOMAIN/api/v1/drive/status?verifyRemote=true"

curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/drive/catalog/status
```

확인 항목:

```text
authMode=user-oauth
rootFolderId 일치
catalogFolderId 일치
finalDetailFolderId 일치
createCredentialCompatible=true
remote.ok=true
```

## 6. 쓰기 Canary

Canary는 루트 아래 임시 폴더를 만들고 업로드·교체·이름변경·이동·복사·휴지통·복원·삭제를 검증한 뒤 정리한다.

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/drive/capabilities/probe \
  -d '{"confirmation":"RUN_DRIVE_WRITE_CANARY"}'
```

합격 기준:

```text
read=true
create=true
upload=true
replace=true
rename=true
move=true
copy=true
trash=true
restore=true
permanentDelete=true
cleanup=true
```

## 7. 카탈로그 동기화

Manifest 상태:

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/drive/catalog/status
```

상품 1895 JSON과 이미지를 캐시:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/drive/catalog/sync \
  -d '{
    "productIds":["1895"],
    "includeImages":true,
    "limit":1,
    "concurrency":1,
    "idempotencyKey":"drive-sync-1895-001"
  }'
```

반환된 `operationId` 조회:

```bash
curl \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/operations/OPERATION_ID
```

전체 JSON을 캐시하고 원장에 등록:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/catalog/enqueue \
  -d '{
    "limit":1515,
    "concurrency":4,
    "force":false,
    "idempotencyKey":"drive-enqueue-all-20260824-001"
  }'
```

이미지는 상품 preview/register 또는 배치 실행 직전에 필요한 상품만 내려받는다.

## 8. 파일 작업 확인

폴더 생성:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/drive/folders \
  -d '{
    "name":"API_테스트",
    "parentId":"1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y",
    "confirmation":"WRITE_DRIVE_ITEM"
  }'
```

텍스트 업로드:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/drive/files/upload \
  -d '{
    "name":"hello.txt",
    "parentId":"FOLDER_ID",
    "mimeType":"text/plain",
    "text":"HAAR Drive API test",
    "confirmation":"WRITE_DRIVE_ITEM"
  }'
```

휴지통:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/drive/files/FILE_ID/trash \
  -d '{
    "confirmation":"TRASH_DRIVE_ITEM",
    "secondConfirmation":"FILE_ID"
  }'
```

## 9. 캐시 정리

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/drive/cache/cleanup \
  -d '{"maxAgeSeconds":86400}'
```

## 10. 즉시 중지

```dotenv
ATELIER_DRIVE_ALLOW_WRITES=false
ATELIER_DRIVE_ALLOW_MOVES=false
ATELIER_DRIVE_ALLOW_TRASH=false
ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=false
ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=false
```

재배포 후 읽기 기능만 유지된다.

## 11. 자동 원격 Smoke Test

읽기 전용:

```bash
ATELIER_BASE_URL="https://YOUR_DOMAIN" \
ATELIER_API_KEY="YOUR_API_KEY" \
npm run test:drive:remote
```

쓰기 Canary까지 포함:

```bash
ATELIER_BASE_URL="https://YOUR_DOMAIN" \
ATELIER_API_KEY="YOUR_API_KEY" \
ATELIER_DRIVE_RUN_WRITE_CANARY=true \
npm run test:drive:remote
```
