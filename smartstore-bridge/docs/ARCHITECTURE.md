# 아키텍처

이 문서는 **v0.6.0** 기준의 현재 구조를 설명합니다. 과거 SQLite 단일 등록 구조를 설명하던 내용은 폐기하고, v05 composition과 현재 도메인 구성을 기준으로 다시 작성했습니다.

## 1. 구성 체인

서버는 다음 순서로 조립됩니다.

```text
bootstrap-v05
  └─ bootstrap-v04
       └─ bootstrap-v03
            └─ bootstrap
```

- `bootstrap`: `loadConfig()`로 설정을 읽고 NaverCommerceClient, NaverProductsApi, ProductService, CatalogRepository, SQLite Ledger를 만듭니다.
- `bootstrap-v03`: Drive 설정·서비스와 DriveCatalogMaterializer를 추가하고, Google Drive 카탈로그 provider이면 catalog root를 로컬 캐시 디렉터리로 바꿉니다. Drive 초기 동기화 실패는 `driveStartupError`로 기록됩니다.
- `bootstrap-v04`: 커머스 manifest·gateway와 상세페이지 서비스를 추가합니다. 커머스 gateway 초기화 실패는 `commerceStartupError`로 기록됩니다.
- `bootstrap-v05`: SearchAd 설정·spec registry·credential registry·client·gateway·capability service와 다중 공급처 카탈로그 bootstrap을 추가합니다. SearchAd와 다중 공급처 초기화 실패는 각각 `searchAdStartupError`, `multiSourceCatalogStartupError(s)`로 기록됩니다.

HTTP v05는 `commerceGateway`가 없으면 시작하지 않습니다. SearchAd·다중 공급처처럼 선택적으로 붙는 도메인의 초기화 실패는 readiness 응답에 드러나며, 프로세스 전체를 항상 중단시키지는 않습니다.

## 2. 실행 표면

| 표면 | 진입점 | 특징 |
|---|---|---|
| CLI | `src/cli.js` | `bootstrap()`을 사용하는 로컬 상품 워크플로 |
| MCP stdio | `src/mcp.js`, `src/mcp/tools.js` | 정확히 6개 도구. stdout은 JSON-RPC 전용, 로그는 stderr |
| HTTP v05 | `src/http-v05.js`, `src/http/server-v05.js` | 기본 포트 3000. manifest의 operation을 게이트와 함께 노출 |

MCP 표면을 6개 도구로 좁게 유지하는 이유는 에이전트가 실수로 넓은 원격 쓰기 표면을 갖지 않게 하기 위해서입니다. 반대로 HTTP v05는 커머스 116개 operation과 SearchAd 126개 operation을 manifest 기반으로 노출하는 넓은 표면을 담당합니다. 두 표면은 같은 기반 모듈과 SQLite 원장을 사용합니다. MCP `atelier_create_product`와 CLI `product create --execute`는 HTTP route를 거치지 않고 `ProductService.create()`를 직접 호출합니다. 따라서 HTTP Bearer API key, rate limit, `api_operations` 큐를 사용하지 않습니다.

## 3. 도메인 책임

### 커머스 gateway

- `specs/naver-commerce/current.json`의 116개 operation, 8개 도메인을 읽습니다.
- 각 operation은 `readOnly`, `sideEffect`, `destructive`, `risk`, `confirmation`, `gate` 메타데이터를 가집니다.
- runtime gate는 read/write/delete/orders/claims/inquiries/solutions/seller/multipart/unverified로 나뉩니다.
- endpoint를 코드에 직접 나열하지 않고 manifest를 allowlist로 사용합니다. operation 조회, preview, execute, capability probe가 gateway를 통해 동작합니다.

### SearchAd gateway

- `specs/naver-searchad/current.json`의 126개 operation 중 117개가 runtime allowlist에 포함됩니다.
- 9개 tier D operation은 `runtimeAllowlisted: false`라 `ATELIER_SEARCHAD_ALLOW_UNVERIFIED_OPERATIONS=true`로도 활성화되지 않습니다. allowlist/classification 변경과 별도 리뷰가 필요합니다. 현재 manifest에 존재하는 tier는 B와 D입니다.
- HMAC-SHA256 서명 대상은 `<timestamp>.<METHOD>.<pathname>`이며 query string은 제외됩니다.
- 요청 헤더는 `X-Timestamp`, `X-API-KEY`, `X-Customer`, `X-Signature`입니다.
- credential registry는 principal(access license + secret) → grant → customer 구조를 검증합니다. 한 고객에 principal 하나만 허용해 서명 주체가 모호해지지 않게 합니다.
- status/accounts는 원본 `customerId`와 `customerIdMasked`를 함께 반환하며 secret key는 반환하지 않습니다. 원본 ID 비노출이 필요하면 response DTO 변경과 별도 테스트가 필요합니다. 이는 고객 단위 자격증명 스코프이며, 사용자별 권한 격리가 아닙니다.

### Drive

- 모든 대상은 허용된 HAAR 루트의 하위인지 경계 검사를 통과해야 합니다.
- operation allowlist와 쓰기 gate를 적용합니다.
- 전체 카탈로그를 상시 복사하지 않고, 필요한 `catalog_manifest.json`·`product_info.json`·이미지만 캐시·materialize합니다.
- Drive 캐시는 로컬 work 영역과 분리된 캐시 디렉터리에 저장됩니다.

### 다중 공급처 카탈로그와 채널 가져오기

- 다중 공급처 카탈로그는 source registry와 판매 채널 registry를 분리해 관리합니다.
- 채널 importer는 Naver와 Cafe24에 대해 read-only로 동작합니다.
- 상품 identity는 `(source_id, source_product_id)`를 정확한 식별자로 사용합니다.
- 가져오기는 page 단위 checkpoint를 저장해 재개할 수 있고, 실패한 page는 재시도 대상으로 남깁니다.
- `channel_import_*` SQLite repository와 PostgreSQL schema/migrations가 있습니다.
- PostgreSQL 통합 테스트는 schema 수준이며 `TEST_DATABASE_URL`이 없으면 skip됩니다. CI에서는 Postgres service와 함께 실행됩니다.

## 4. 영속성

```text
SQLite
- api_operations : 비동기 operation 원장 (idempotency_key UNIQUE)
- product_jobs   : 상품 등록 작업 원장

PostgreSQL
- channel_import_runs, channel_product_snapshots, channel_product_identifiers 등
- channel match/merge 관련 테이블
- multi-source catalog, SearchAd foundation schema

Drive cache
- catalog_manifest.json
- product_info.json
- 상품 이미지
```

SQLite는 단일 프로세스의 operation/queue 상태를 빠르게 기록하는 데 사용하고, PostgreSQL은 채널 가져오기와 다중 공급처 카탈로그의 스키마·마이그레이션을 담당합니다. Drive 캐시는 원본을 대체하지 않으며, 필요한 파일만 지연 materialize합니다.

현재 HTTP 런타임의 채널 가져오기 저장소는 SQLite입니다. PostgreSQL은 스키마·마이그레이션 기반과 CI 통합 테스트 대상이며, 런타임 저장소로 연결되어 있지 않습니다.

## 5. HTTP v05 쓰기 요청 흐름

```text
요청
  → auth (Bearer API key)
  → gate (도메인·operation별 allow 여부)
  → confirmation (정확한 문구, 파괴적 작업은 2차 확인)
  → idempotency (operation_type/source_product_id 충돌 검사; 요청 본문은 request 전달 시에만 비교)
  → preview (payload 검증·fingerprint)
  → queue (api_operations에 queued로 기록)
  → gateway (실제 원격 호출)
  → ledger (running/succeeded/failed/interrupted 기록)
```

- `auth`: HTTP는 설정된 Bearer API key를 검증합니다.
- `gate`: 환경변수 기본값은 false이며, operation의 gate가 허용되지 않으면 실행 전에 거부합니다.
- `confirmation`: operation별 확인 문구가 정확히 일치해야 합니다. destructive 작업은 대상 ID/resource key를 다시 요구합니다.
- `idempotency`: `api_operations.idempotency_key`는 UNIQUE입니다. 재사용 시 `operation_type`과 `source_product_id`를 항상 비교합니다. 요청 본문 비교는 호출자가 `request`를 넘길 때만 수행합니다. SearchAd execute 재사용과 공통 `createAsyncOperation` reuse/race 분기는 현재 `request`를 넘기지 않으므로, 같은 key + 같은 operation/resource + 다른 body가 기존 operation을 반환할 수 있습니다. route 수준 body 동등성 강제는 구현되어 있지 않으며, 필요하면 `request`를 넘기고 route 테스트를 추가해야 합니다.
- `preview`: 실행 전에 payload와 fingerprint를 검증합니다.
- `queue`: `api_operations`에 `queued` 상태로 기록한 뒤 큐에서 실행합니다.
- `gateway`: 커머스 또는 SearchAd gateway가 실제 HTTP 호출을 수행합니다.
- `ledger`: 상태 전이와 결과/오류를 원장에 기록합니다.

### MCP/CLI 직접 쓰기 경로

MCP `atelier_create_product`와 CLI `product create --execute`는 HTTP route를 거치지 않습니다. 두 경로는 `ProductService.create()`를 직접 호출하고, `NAVER_ALLOW_WRITES=true`와 정확한 `writeConfirmation`을 확인한 뒤 `product_jobs` 원장과 판매자관리코드 중복 조회를 사용합니다. HTTP Bearer API key, HTTP rate limit, `idempotencyKey`, `api_operations` 큐는 사용하지 않습니다.

## 6. 실행 의미론

쓰기 경로는 **HTTP v05 async**와 **MCP/CLI direct** 두 가지이며 실행 의미론이 다릅니다.

### HTTP v05 비동기 쓰기

- `api_operations.idempotency_key`는 UNIQUE입니다. 이는 중복 operation 기록을 막는 장치입니다.
- operation 상태는 `queued`, `running`, `succeeded`, `failed`, `interrupted`를 포함합니다.
- 큐 동시성 기본값은 1이며 설정으로 조정할 수 있지만 1~4 범위로 제한됩니다.
- `OperationQueue` 생성 시 `recoverInterruptedOperations()`가 호출되어 이전 프로세스의 `queued`/`running` 행을 `interrupted`로 바꿉니다.
- 자동 재개·자동 재시도는 없습니다. `interrupted` 또는 결과 미확인 작업은 수동으로 판단해야 합니다.

### MCP/CLI 직접 쓰기

- MCP `atelier_create_product`와 CLI `product create --execute`는 `ProductService.create()`를 직접 호출합니다.
- `NAVER_ALLOW_WRITES=true`와 정확한 `writeConfirmation`이 모두 필요합니다.
- `product_jobs` 원장과 판매자관리코드 중복 조회를 사용합니다.
- HTTP Bearer API key, rate limit, `idempotencyKey`, `api_operations` 큐는 사용하지 않습니다.
- `findBySellerManagementCode`는 중복 guard이지 분산 환경의 exactly-once 보장이 아닙니다.

### 공통 한계

- 원격 쓰기의 exactly-once 실행은 보장하지 않습니다. crash 시 원격 결과가 불명확할 수 있고, reconciliation은 수동입니다.

## 7. 자격증명 토폴로지와 보장 범위

| 자격증명 | 범위 | 보장하지 않는 것 |
|---|---|---|
| HTTP Bearer API key | 서버에 설정된 공유 key | 사용자별 identity·권한 분리 |
| SearchAd principal | access license + secret | end-user authorization |
| SearchAd grant | principal과 customer 연결, 고객당 1 principal | 다중 사용자 세션 격리 |
| Naver 커머스 앱 자격증명 | 스토어 애플리케이션 단위 | 사용자별 권한 분리 |

SearchAd의 customer-level credential scoping은 서명 대상 고객을 명확히 하는 장치입니다. 사용자별 authorization isolation, 즉 “누가 어떤 작업을 할 수 있는가”를 구현한 것이 아닙니다. HTTP 역시 공유 Bearer key를 사용합니다.

## 8. 테스트 전략

- `node --test test/*.test.js`로 실행합니다.
- 대부분의 gateway·HTTP·Drive·catalog 테스트는 mock/fixture 기반이며 실제 운영 API에 쓰기 요청을 보내지 않습니다.
- `test/mcp-contract.test.js`는 임시 디렉터리의 fixture manifest로 `src/mcp.js`를 child process로 띄워 initialize, notifications/initialized, tools/list, tools/call을 확인합니다. stdout의 모든 비어 있지 않은 줄이 JSON인지도 검사합니다.
- `test/mcp-tools.test.js`는 fake server/app으로 6개 handler, error wrapping, auth redaction, real `ProductService` gate를 검증합니다.
- `test/local-demo-fixture.test.js`는 `examples/local-demo` fixture를 `CatalogRepository`로 읽어 stats를 검증합니다.
- `test/http-security-config.test.js`는 loopback host, demo key, `ATELIER_API_KEYS` precedence, default `0.0.0.0` host를 검증합니다.
- Postgres 통합 테스트는 schema 수준이며 `TEST_DATABASE_URL`이 없으면 skip됩니다. CI에서는 Postgres service와 함께 실행되지만 workflow는 path/branch 범위로 동작합니다.
- 현재 테스트 스위트는 130개이며 129개 통과, 1개 skip입니다.

## 9. Legacy versioned entrypoint

| 버전 | HTTP entrypoint | 구성 | 상태 |
|---|---|---|---|
| v03 | `src/http-v03.js` | system, product, ledger, Drive | legacy compatibility |
| v04 | `src/http-v04.js` | v03 + commerce gateway | legacy compatibility |
| v05 | `src/http-v05.js` | v04 + SearchAd + multi-source catalog | 현재 기준 |

v03/v04의 version 상수는 당시 배포 이력을 보존하기 위해 그대로 두었습니다. 새 작업과 새 문서는 v05를 기준으로 합니다.

## 10. 파일 지도

| 역할 | 파일 |
|---|---|
| MCP 엔트리 | `src/mcp.js` |
| MCP 도구 정의 | `src/mcp/tools.js` |
| 공유 버전 | `src/version.js` |
| composition 루트 | `src/bootstrap-v05.js`, `src/bootstrap-v04.js`, `src/bootstrap-v03.js`, `src/bootstrap.js` |
| HTTP v05 | `src/http-v05.js`, `src/http/server-v05.js` |
| 커머스 gateway | `src/naver/commerce/gateway.js` |
| SearchAd 서명 | `src/naver/searchad/auth.js` |
| SearchAd gateway | `src/naver/searchad/gateway.js` |
| Drive 경계 | `src/drive/boundary.js` |
| 작업 큐 | `src/application/operation-queue.js` |
| SQLite 원장 | `src/infrastructure/ledger.js` |
| 채널 가져오기 | `src/catalog/channel-import/import-service.js` |
| 채널 가져오기 저장소 | `src/catalog/channel-import/sqlite-repository.js` |
| PostgreSQL migrations | `migrations/postgres/` |
| 로컬 데모 fixture | `examples/local-demo/catalog/catalog_manifest.json` |
| 로컬 데모 절차 | `examples/local-demo/README.md` |
| MCP 계약 테스트 | `test/mcp-contract.test.js` |
| MCP handler 테스트 | `test/mcp-tools.test.js` |
| 로컬 데모 fixture 테스트 | `test/local-demo-fixture.test.js` |
| HTTP 보안 설정 테스트 | `test/http-security-config.test.js` |
