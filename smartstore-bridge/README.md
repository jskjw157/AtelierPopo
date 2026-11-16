# AtelierPopo 스마트스토어 브리지

**v0.6.0** — 네이버 커머스API, SearchAd, Google Drive, 다중 공급처 상품 카탈로그를 하나의 Node.js 브리지에서 다루는 운영 도구입니다. MCP stdio는 6개 도구만 노출하고, HTTP v05는 manifest에 정의된 operation을 게이트와 함께 노출합니다. ESM, Node.js 22.5.0 이상, 별도 웹 프레임워크 없이 동작합니다.

## 실행 표면

| 표면 | 진입점 | 설명 |
|---|---|---|
| CLI | `src/cli.js` | 로컬 상품 검증·미리보기·등록 등 기존 CLI |
| MCP stdio | `src/mcp.js` | 6개 도구. stdout은 MCP 프로토콜 전용이며 로그는 stderr로 나갑니다. |
| HTTP v05 | `src/http-v05.js` | 기본 포트 3000. `bootstrap-v05 → bootstrap-v04 → bootstrap-v03 → bootstrap` 위에 system·product·ledger·Drive·commerce·SearchAd·multi-source route를 조립합니다. |

v03/v04 entrypoint는 legacy compatibility layer입니다. 현재 작업과 문서의 기준은 v05입니다.

## MCP 도구

| 도구 | 구분 | 한 줄 설명 |
|---|---|---|
| `atelier_auth_test` | 읽기(네트워크 인증 확인) | 커머스API 토큰 발급 가능 여부만 확인하며 토큰 원문은 반환하지 않습니다. |
| `atelier_catalog_stats` | 읽기(로컬) | `catalog_manifest.json`에서 상품 수와 카테고리별 수량을 집계합니다. |
| `atelier_preview_product` | 읽기/검증 | `product_info.json`을 등록 페이로드로 변환·검증하며 네이버에는 쓰지 않습니다. |
| `atelier_find_product` | 읽기(원격) | 판매자관리코드로 스마트스토어 등록 여부를 검색합니다. |
| `atelier_create_product` | 쓰기(원격) | 상품 1개를 등록합니다. HTTP route/queue를 거치지 않고 `ProductService.create()`를 직접 호출하며 `NAVER_ALLOW_WRITES=true`와 정확한 `confirm`이 필요합니다. |
| `atelier_batch_status` | 읽기(로컬 SQLite) | `product_jobs` 원장의 상태별 건수와 작업 목록을 조회합니다. |

## 쓰기 경로

| 경로 | auth / gates | ledger / queue | notes |
|---|---|---|---|
| HTTP v05 async | Bearer API key + rate limit + operation gate + exact confirmation + idempotencyKey | SQLite `api_operations` + `OperationQueue` | `202` 접수 후 `/api/v1/operations/{id}` polling |
| MCP `atelier_create_product` | `NAVER_ALLOW_WRITES=true` + exact `writeConfirmation` | SQLite `product_jobs` | `ProductService.create()` direct; seller-management-code duplicate lookup; HTTP Bearer/rate limit/api_operations 미사용 |
| CLI `product create --execute` | `NAVER_ALLOW_WRITES=true` + exact `writeConfirmation` | SQLite `product_jobs` | `ProductService.create()` direct; HTTP Bearer/rate limit/api_operations 미사용 |

MCP와 CLI는 HTTP v05의 Bearer 인증, rate limit, `api_operations` 큐를 사용하지 않습니다.

## HTTP v05 엔드포인트 그룹

| 그룹 | 경로 | 설명 |
|---|---|---|
| 시스템·상태 | `/health`, `/health/ready`, `/openapi.json` | liveness, readiness, 기본 OpenAPI |
| 커머스 | `/api/v1/commerce/*` | 116개 operation, status/operations/preview/execute, 상품·상세페이지 조회·변경 |
| SearchAd | `/api/v1/searchad/*` | 126개 operation 중 117개 runtime allowlist. 9개 tier D는 `runtimeAllowlisted: false`라 `ATELIER_SEARCHAD_ALLOW_UNVERIFIED_OPERATIONS=true`로도 차단됩니다. status/accounts/operations/preview/execute, passive probe |
| Drive | `/api/v1/drive/*` | 상태·카탈로그 캐시·파일·폴더·업로드·이동·휴지통·권한 |
| 다중 공급처 카탈로그 | `/api/v1/catalog/multi-source/*`, `/api/v1/catalog/sources/*`, `/api/v1/sales-channels/*` | source registry, 상품 조회·hydrate, 판매 채널 |
| 작업 원장 | `/api/v1/operations/*` | 비동기 operation 상태 조회·polling |

전체 endpoint 목록은 `GET /openapi.json`, `GET /openapi-searchad.json`, `GET /openapi-catalog.json`의 OpenAPI 문서를 기준으로 봅니다.

## HTTP v05 쓰기 안전 게이트

- 쓰기 관련 환경변수는 기본값이 `false`입니다. 읽기만 기본 허용입니다.
- operation별 정확한 `confirmation` 문구가 필요합니다.
- 파괴적 작업은 대상 ID 또는 resource key를 요구하는 2차 확인을 추가로 수행합니다.
- HTTP v05의 비동기 쓰기 요청은 `idempotencyKey`를 받아 중복 operation 기록을 막습니다.
- HTTP v05에서 접수된 비동기 작업은 SQLite `api_operations` 원장과 큐에 기록됩니다.
- HTTP 인증을 통과한 요청에 읽기/쓰기 별도 rate limit을 적용합니다.
- Bearer API key 인증을 사용합니다.
- token/secret은 응답에 반환하지 않습니다. SearchAd status/accounts는 원본 `customerId`와 `customerIdMasked`를 함께 반환하며 secret key는 반환하지 않습니다. 원본 ID 비노출이 필요하면 response DTO 변경과 별도 테스트가 필요합니다. 작업 presenter는 로컬 경로를 redaction합니다.

MCP `atelier_create_product`와 CLI `product create --execute`는 위 HTTP v05 게이트를 사용하지 않고, `ProductService`의 `NAVER_ALLOW_WRITES` + 정확한 `writeConfirmation` 게이트와 `product_jobs` 원장을 사용합니다. HTTP Bearer key, HTTP rate limit, `api_operations` 큐는 사용하지 않습니다.

## 실행

```bash
npm ci
cp .env.example .env
```

```bash
# MCP stdio 서버 (stdio로 블록됨)
npm run mcp

# 선택: MCP Inspector
npm run inspect:mcp
```

```bash
# HTTP v05, 기본 포트 3000, 기본 읽기 전용
npm start
```

`.env`와 config 파일의 실제 secret은 저장소에 커밋하지 않습니다.

## 로컬 HTTP 데모

실제 네이버·SearchAd·Drive 자격증명 없이 fixture 카탈로그로 읽기 경로를 확인합니다. `examples/local-demo/catalog/catalog_manifest.json`에는 상품 1개(`1905`, `귀걸이`)만 들어 있습니다. `smartstore-bridge`에서 실행합니다.

```bash
npm ci
unset ATELIER_API_KEYS
export ATELIER_API_KEY=local-demo-key-0123456789abcdef0123456789abcdef
export ATELIER_HTTP_HOST=127.0.0.1
export PORT=3000
export ATELIER_CATALOG_PROVIDER=local
export ATELIER_CATALOG_ROOT="$PWD/examples/local-demo/catalog"
export ATELIER_WORK_DIR="$PWD/work/local-demo"
export ATELIER_DATABASE_PATH="$PWD/work/local-demo/atelier-popo.sqlite"
export ATELIER_SEARCHAD_GATEWAY_ENABLED=false
export ATELIER_MULTI_SOURCE_CATALOG_ENABLED=false
export NAVER_ALLOW_WRITES=false
export ATELIER_HTTP_ALLOW_WRITES=false
npm start
```

- 이 예제 키는 로컬 데모 전용입니다. 실제/공개 환경에서 재사용하지 마세요.
- `loadHttpConfig`는 `ATELIER_API_KEYS`가 있으면 `ATELIER_API_KEY`보다 우선합니다. 위 `unset`은 상속된 셸/config 값이 데모 인증을 바꾸지 않게 합니다. 의도적으로 `ATELIER_API_KEYS`를 쓰려면 그 키를 사용하고 `ATELIER_API_KEY`는 생략하세요.
- `ATELIER_HTTP_HOST=127.0.0.1`은 이 데모를 loopback 전용으로 만듭니다. 프로덕션/기본 `0.0.0.0` 동작은 변경하지 않았습니다.

다른 터미널에서 API key를 다시 export한 뒤 확인합니다.

```bash
unset ATELIER_API_KEYS
export ATELIER_API_KEY=local-demo-key-0123456789abcdef0123456789abcdef
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/health/ready
curl -s -H "Authorization: Bearer $ATELIER_API_KEY" \
  http://127.0.0.1:3000/api/v1/catalog/stats
curl -s -H "Authorization: Bearer $ATELIER_API_KEY" \
  http://127.0.0.1:3000/api/v1/status
```

예상 응답:

```json
{"ok":true,"status":"ok","service":"haar-smartstore-commerce-drive-bridge","version":"0.6.0","uptimeSeconds":2}
```

```json
{"ok":true,"status":"ready","service":"haar-smartstore-commerce-drive-bridge","version":"0.6.0"}
```

```json
{"ok":true,"catalog":{"source":"local-demo","totalProducts":1,"totalCompleted":1,"byCategory":{"귀걸이":1}}}
```

`uptimeSeconds`는 실행 시점에 따라 달라집니다. `/api/v1/status`의 `readiness`는 `readyForRead: true`, `readyForPreview: false`, `readyForWrite: false`입니다. `readyForPreview`가 `false`인 이유는 예제 config의 카테고리 ID가 플레이스홀더이기 때문이고, `readyForWrite`는 쓰기 gate 기본값이 `false`이기 때문입니다.

`.env.example`만 복사해 API key 없이 실행하면 `/health`는 `200` `status:"degraded"`, `/health/ready`는 `503` `status:"not_ready"`가 됩니다. 이는 안전한 기본값이며 실패가 아닙니다. 이 데모는 로컬 읽기만 확인하고 실제 상품 등록·광고 변경을 수행하지 않습니다.

상세 절차는 [`examples/local-demo/README.md`](examples/local-demo/README.md)를 참고하세요.

## 테스트

```bash
npm test
npm run check
```

테스트는 Node.js built-in test runner와 mock/fixture를 사용하며 실제 운영 API에 쓰기 요청을 보내지 않습니다. MCP stdio 계약 테스트는 임시 디렉터리의 fixture manifest로 서버를 띄워 6개 도구, 버전, catalog stats를 확인합니다. Postgres 통합 테스트는 `TEST_DATABASE_URL`이 없으면 skip되고, CI에서는 Postgres service와 함께 실행됩니다. 현재 테스트 스위트는 130개이며 129개 통과, 1개 skip입니다. MCP stdio 계약 테스트와 MCP handler 테스트, 로컬 데모 fixture 테스트, HTTP 보안 설정 테스트가 포함됩니다.

## 문서 지도

| 구분 | 문서 |
|---|---|
| 현재 구조 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| SearchAd 현재 기준 | [`docs/NAVER_SEARCHAD_CURRENT.md`](docs/NAVER_SEARCHAD_CURRENT.md) |
| 다중 공급처 카탈로그 | [`docs/MULTI_SOURCE_PRODUCT_ARCHITECTURE.md`](docs/MULTI_SOURCE_PRODUCT_ARCHITECTURE.md) |
| 환경변수 예시 | [`.env.example`](.env.example) |
| 로컬 HTTP 데모 | [`examples/local-demo/README.md`](examples/local-demo/README.md) |
| 테스트 | [`test/mcp-tools.test.js`](test/mcp-tools.test.js), [`test/local-demo-fixture.test.js`](test/local-demo-fixture.test.js), [`test/http-security-config.test.js`](test/http-security-config.test.js) |
| 운영·배포 절차 | [`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md), [`docs/GOOGLE_DRIVE_DEPLOY.md`](docs/GOOGLE_DRIVE_DEPLOY.md), [`docs/NAVER_COMMERCE_DEPLOY.md`](docs/NAVER_COMMERCE_DEPLOY.md). 과거 버전 기준이 포함될 수 있는 운영 문서입니다. |

`docs/*PLAN*`, `CHANGELOG*`, `TEST_REPORT*`, 버전이 붙은 runbook은 이력 보존용입니다. 현재 아키텍처 설명은 `docs/ARCHITECTURE.md`를 따릅니다.

## 알려진 한계

- 사용자별 authorization isolation은 구현되지 않았습니다. HTTP는 공유 Bearer API key를 사용하고, SearchAd grant는 고객 단위 자격증명입니다.
- 원격 쓰기의 exactly-once 실행은 보장하지 않습니다. crash 이후 `interrupted` 또는 결과 미확인 상태가 남을 수 있으며 reconciliation은 수동입니다.
- HTTP v05 멱등성 재사용 경로 일부는 `request`를 넘기지 않아 같은 key + 같은 operation/resource + 다른 body가 기존 operation을 반환할 수 있습니다. route 수준 body 동등성 강제는 아직 없습니다.
- 상품 등록·광고 변경의 실계정 운영 검증은 이번 브랜치에서 실행하지 않았습니다. 자동화 테스트는 mocked/local입니다.
- `smartstore-bridge`의 `npm audit`은 이번 스냅샷에서 high advisory 0개입니다. 검증된 버전은 `@modelcontextprotocol/server 2.4.0`, `sharp 0.35.5`, `zod 4.6.7`이며, 이는 모든 의존성이 안전하다는 의미가 아닙니다.

루트 개요와 코드 읽기 지도는 [`../README.md`](../README.md)를 참고하세요.
