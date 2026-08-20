# Hostinger 배포 가이드

## 1. 배포 전 확인

- Node.js 22.5 이상
- 저장소의 애플리케이션 루트가 `smartstore-bridge`
- 퀸실버 카탈로그 폴더를 서버가 읽을 수 있음
- `work` 디렉터리가 쓰기 가능하고 재배포 후에도 유지됨
- 네이버 커머스API 애플리케이션 ID·시크릿 발급 완료
- Hostinger 서버의 외부 송신 IPv4를 네이버 `API 호출 IP`에 등록

SQLite 작업 원장과 정규화 이미지 임시파일을 사용하므로, 파일시스템이 매 배포마다 초기화되는 환경보다는 **영속 디스크가 있는 VPS 또는 영속 경로를 제공하는 Node.js 호스팅**이 적합합니다.

## 2. GitHub 배포 설정

저장소:

```text
jskjw157/AtelierPopo
```

애플리케이션 루트:

```text
smartstore-bridge
```

설치 명령:

```bash
npm install
```

시작 명령:

```bash
npm start
```

상태 확인 경로:

```text
/health
```

애플리케이션은 `0.0.0.0`에 바인딩하고 Hostinger가 주입하는 `PORT` 값을 사용합니다.

## 3. Hostinger 환경변수

필수:

```dotenv
NODE_ENV=production
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
NAVER_TOKEN_TYPE=SELF
NAVER_ALLOW_WRITES=false

ATELIER_POPO_CONFIG=./config/atelier-popo.json
ATELIER_CATALOG_ROOT=/absolute/server/path/queensilver_all_products_20260809
ATELIER_TEMPLATE_FILE=./config/naver-product-template.json
ATELIER_WORK_DIR=/absolute/persistent/path/work
ATELIER_DATABASE_PATH=/absolute/persistent/path/work/atelier-popo.sqlite

ATELIER_API_KEY=최소32자랜덤문자열
ATELIER_HTTP_HOST=0.0.0.0
ATELIER_HTTP_ALLOW_WRITES=false
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
ATELIER_TRUST_PROXY=true
```

Hostinger가 `PORT`를 자동 설정하면 직접 고정하지 않아도 됩니다.

API 키 생성 예시:

```bash
openssl rand -hex 32
```

## 4. 데이터 배치

서버에서 다음 구조가 유지되어야 합니다.

```text
queensilver_all_products_20260809/
├─ catalog_manifest.json
└─ 카테고리/
   └─ 상품번호_상품명/
      ├─ product_info.json
      └─ images/
```

`ATELIER_CATALOG_ROOT`는 위 루트 폴더를 가리켜야 합니다.

전체 원본이 크므로 Git 저장소에 커밋하지 말고 SFTP, rsync, 영속 볼륨 또는 별도 스토리지 동기화 방식으로 배치하세요.

## 5. 외부 송신 IP 확인

Hostinger 서버 터미널에서:

```bash
curl -4 https://api.ipify.org
```

출력된 IPv4를 네이버 커머스API센터의 애플리케이션 `API 호출 IP`에 등록합니다. 도메인 주소나 서버 내부 IP가 아니라 실제 외부 송신 IPv4가 필요합니다.

## 6. 배포 확인

```bash
curl https://YOUR_DOMAIN/health
curl https://YOUR_DOMAIN/health/ready
```

인증 상태:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/auth/test \
  -d '{}'
```

카탈로그:

```bash
curl -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/catalog/stats
```

상품 미리보기:

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  "https://YOUR_DOMAIN/api/v1/products/1905/preview?includePayload=true" \
  -d '{}'
```

## 7. 최초 실제 등록

먼저 미리보기를 검수합니다. 그다음 환경변수를 다음처럼 바꿉니다.

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_BATCH_WRITES=false
```

단일 상품만 접수합니다.

```bash
curl -X POST \
  -H "Authorization: Bearer $ATELIER_API_KEY" \
  -H "Content-Type: application/json" \
  https://YOUR_DOMAIN/api/v1/products/1905/register \
  -d '{"confirmation":"REGISTER","idempotencyKey":"register-1905-first-test"}'
```

반환된 작업을 조회합니다.

```bash
curl -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/operations/OPERATION_ID
```

스마트스토어센터에서 상품명, 가격, 옵션, 이미지, 배송·반품 정보를 직접 확인한 뒤에만 소량 배치를 진행합니다.

## 8. Docker/VPS

```bash
cp .env.example .env
cp config/atelier-popo.example.json config/atelier-popo.json
# 실제 설정값 입력

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

`docker-compose.example.yml`도 제공됩니다.

## 9. 장애 확인

```text
401 UNAUTHORIZED
→ ATELIER_API_KEY 또는 Authorization 헤더 확인

503 API_AUTH_NOT_CONFIGURED
→ API 키가 없거나 기본 최소 길이보다 짧음

GW.IP_NOT_ALLOWED
→ Hostinger 외부 송신 IPv4와 네이버 등록 IP가 다름

NAVER_WRITES_DISABLED / HTTP_WRITES_DISABLED
→ 두 쓰기 잠금 중 하나가 false

PRODUCT_NOT_EXECUTABLE
→ 카테고리, 템플릿, 품절, 필수 필드 검증 결과 확인

interrupted operation
→ 처리 중 서버가 재시작됨. 스마트스토어 중복 여부 확인 후 새 idempotencyKey로 재실행
```
