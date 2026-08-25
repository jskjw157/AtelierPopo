# 네이버 검색광고 SearchAd 기반 구현 v0.5.0

## 구현 단계

이 버전은 v2.1 계약의 다음 단계를 구현한다.

```text
S0   공식 스펙 고정·operation manifest·coverage
S0.5 PostgreSQL 공통 원장·SearchAd 기초 스키마
S1   HMAC 인증·다중 Customer·공통 클라이언트
S2a  공식 읽기 operation gateway·Passive Capability Probe
```

아직 광고 생성·입찰가·예산 변경을 운영 활성화하는 버전은 아니다.

## 공식 스펙

고정 기준:

```text
naver/searchad-apidoc
ref: 8e250490ab748367a627213f7d7a2917e005cb10
```

공식 9개 Swagger를 내려받기 전 Git blob SHA와 파일 크기를 검증한다. 생성 산출물:

```text
specs/naver-searchad/current.json
specs/naver-searchad/coverage.json
specs/naver-searchad/source-checksums.json
specs/naver-searchad/source/swagger/*.json
specs/naver-searchad/versions/<ref>/operation-manifest.json
specs/naver-searchad/versions/<ref>/definitions-index.json
```

```bash
npm run searchad:spec:sync
npm run searchad:coverage
```

Raw Swagger에 존재하더라도 내부·비공개 태그 또는 Deprecated operation은 runtime allowlist에 들어가지 않는다.

## 인증

```text
signature input = {timestamp}.{HTTP_METHOD}.{URI_PATH}
```

헤더:

```text
X-Timestamp
X-API-KEY
X-Customer
X-Signature
```

Query string은 서명 URI에 포함하지 않는다.

단일 Principal:

```dotenv
NAVER_SEARCHAD_ACCESS_LICENSE=
NAVER_SEARCHAD_SECRET_KEY=
NAVER_SEARCHAD_CUSTOMER_ID=
```

다중 Principal/Customer:

```dotenv
NAVER_SEARCHAD_PRINCIPALS_JSON=[...]
NAVER_SEARCHAD_CUSTOMERS_JSON=[...]
NAVER_SEARCHAD_GRANTS_JSON=[...]
```

Customer 하나에 여러 Principal이 동시에 연결되는 모호한 topology는 차단한다.

## HTTP API

```text
GET  /openapi-searchad.json
GET  /api/v1/searchad/status
GET  /api/v1/searchad/accounts
GET  /api/v1/searchad/operations
GET  /api/v1/searchad/operations/{operationKey}
POST /api/v1/searchad/operations/{operationKey}/preview
POST /api/v1/searchad/operations/{operationKey}/execute
POST /api/v1/searchad/capabilities/passive-probe
```

읽기 operation은 동기 실행한다. 쓰기 operation 코드는 gate를 구현하지만 최초 배포 환경변수에서 전부 차단된다.

## Passive Probe

명시한 읽기 operation만 호출한다.

```json
{
  "customerId": "123456",
  "operations": ["ncc.get.example__p_ncc_campaigns"],
  "inputs": {}
}
```

미지정 시 path parameter가 없는 runtime allowlisted GET/HEAD 중 안전 후보를 선택한다.

결과 상태:

```text
supported
supported_no_data
authentication_failed
permission_required
not_found_or_ad_product_unavailable
invalid_probe_input
rate_limited
unknown
```

`403`, `404`, 빈 배열을 모두 미지원으로 뭉뚱그리지 않는다.

## PostgreSQL

```text
migrations/postgres/0001_platform_foundation.sql
migrations/postgres/0002_searchad_foundation.sql
```

모든 광고 엔티티·작업은 `customer_id` 범위로 격리한다.

## 최초 배포값

```dotenv
ATELIER_SEARCHAD_ALLOW_READS=true
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_CREATES=false
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=false
ATELIER_SEARCHAD_ALLOW_ROLLBACK=false
ATELIER_SEARCHAD_ALLOW_DELETES=false
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=false
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
```

## 배포 후 확인

```bash
npm run searchad:coverage
npm run searchad:status
```

```bash
curl -H "Authorization: Bearer $ATELIER_API_KEY" \
  https://YOUR_DOMAIN/api/v1/searchad/status
```

```bash
ATELIER_BASE_URL=https://YOUR_DOMAIN \
ATELIER_API_KEY=YOUR_KEY \
  npm run test:searchad:remote
```

실제 계정 Passive Probe 전에는 광고계정의 Access License, Secret Key, Customer ID를 Hostinger Secret에 넣어야 한다.
