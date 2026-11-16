# AtelierPopo — 네이버 스마트스토어·SearchAd·Google Drive 브리지

네이버 커머스API, SearchAd, Google Drive, 다중 공급처 상품 카탈로그를 하나의 Node.js 브리지로 묶어 MCP·HTTP·CLI로 노출하는 1인 프로젝트입니다. 현재 브리지 버전은 **0.6.0**이며 Apache-2.0 라이선스를 사용합니다.

## 이 저장소가 보여주는 것

- **MCP stdio 서버와 6개의 좁은 도구**: 인증 확인, 카탈로그 통계, 상품 미리보기, 원격 상품 검색, 상품 등록, 로컬 원장 조회만 노출합니다.
- **스펙 기반 커머스·SearchAd gateway**: 커머스 116개 operation(8개 도메인), SearchAd 126개 operation(117개 runtime allowlist, tier B/D)을 manifest에서 읽어 게이트와 확인 문구를 적용합니다. 9개 tier D는 `runtimeAllowlisted: false`라 `ATELIER_SEARCHAD_ALLOW_UNVERIFIED_OPERATIONS=true`로도 활성화되지 않습니다.
- **HTTP v05 비동기 쓰기 게이트와 SQLite 원장**: 환경변수 기본값은 쓰기 금지이며, Bearer 인증·rate limit·operation gate·정확한 확인 문구·멱등성 키를 통과한 HTTP v05 요청만 SQLite `api_operations`와 `OperationQueue`로 들어갑니다.
- **Drive 경계와 채널 가져오기**: 허용 루트 안에서만 동작하는 Drive 서비스, 필요한 카탈로그 파일만 캐시하는 materializer, 정확한 source identity와 재개 가능한 checkpoint를 쓰는 read-only 채널 importer가 있습니다.

## 구성

| 경로 | 역할 |
|---|---|
| `smartstore-bridge/` | 핵심 Node.js 브리지. MCP stdio, HTTP v05, CLI, commerce/SearchAd gateway, Drive, 다중 공급처 카탈로그, SQLite 원장 + PostgreSQL 채널 가져오기 스키마/마이그레이션 |
| `frontend/` | Next.js 15 / React 19 정적 스토어프론트 프로토타입. 브리지와 연결되지 않으며 자동화 테스트가 없습니다. |
| `.github/workflows/` | 채널 가져오기·다중 공급처 카탈로그 CI. path/branch 범위로 실행됩니다. |

초기 Vite 스캐폴드였던 `baseFront/`는 Next.js `frontend/`로 이전한 뒤 제거했습니다.

## 검증 상태

| 영역 | 코드 구현 | 자동화 테스트 | 실계정 운영 검증 |
|---|---|---|---|
| MCP 6개 도구 | stdio 서버와 6개 도구 등록 | `test/mcp-contract.test.js` stdio 계약 테스트, `test/mcp-tools.test.js` handler 테스트 | 이번 검토에서 미실행 |
| 커머스 읽기·probe | 116개 operation, 8개 도메인 | fixture/mock 기반 gateway·HTTP 테스트 | 이번 검토에서 미실행 |
| 커머스 쓰기·상품 등록 | HTTP v05 async gate/queue + MCP/CLI direct ProductService gates | mock/fixture 기반 테스트만 | 이번 검토에서 미실행 |
| SearchAd 읽기 | 126개 operation 중 117개 runtime allowlist, 9개 tier D 차단 | fixture/mock 기반 registry·gateway 테스트 | 이번 검토에서 미실행 |
| SearchAd 쓰기 | tier B 확인·2차 확인·gate, tier D는 `runtimeAllowlisted: false`로 차단 | mock/fixture 기반 테스트만 | 이번 검토에서 미실행 |
| Drive | 루트 경계 검사, allowlist, 캐시·materialize | unit/fixture 기반 테스트 | 이번 검토에서 미실행 |
| 채널 가져오기 | read-only Naver/Cafe24 importer, checkpoint | SQLite repository + PostgreSQL 스키마 테스트(DB 없으면 skip) | 이번 검토에서 미실행 |
| 프론트엔드 | 정적 Next.js 프로토타입 | 없음 | 해당 없음 |

## 아키텍처

```text
MCP stdio (6 tools) ─┐
CLI (src/cli.js) ────┴──▶ bootstrap (config · product service · ledger)

HTTP v05 (:3000) ────────▶ bootstrap-v05
                              └─ bootstrap-v04 ─▶ bootstrap-v03 ─▶ bootstrap
                                   ├─ commerce gateway (116 operations)
                                   ├─ SearchAd gateway (126 operations)
                                   ├─ Drive service (boundary + cache)
                                   ├─ multi-source catalog / channel import
                                   └─ SQLite ledger + operation queue
```

MCP와 CLI는 base `bootstrap` 구성을 사용하고, HTTP v05는 `bootstrap-v05 → bootstrap-v04 → bootstrap-v03 → bootstrap` 순서로 전체 구성을 조립합니다. 커머스와 SearchAd는 각각 manifest를 읽는 operation gateway로 동작하며, Drive와 다중 공급처 카탈로그는 별도 서비스로 분리되어 있습니다. HTTP v05의 비동기 쓰기 요청만 Bearer 인증·rate limit·operation gate·확인 문구·멱등성 키를 통과한 뒤 SQLite `api_operations`에 기록되고 `OperationQueue`에서 실행됩니다. MCP와 CLI의 상품 등록은 HTTP route를 거치지 않고 `ProductService.create()`를 직접 호출하며, `product_jobs` 원장과 판매자관리코드 중복 조회를 사용합니다. HTTP `api_operations` 큐, Bearer API key, HTTP rate limit은 사용하지 않습니다.

## 쓰기 경로

| 경로 | auth / gates | ledger / queue | notes |
|---|---|---|---|
| HTTP v05 async | Bearer API key + rate limit + operation gate + exact confirmation + idempotencyKey | SQLite `api_operations` + `OperationQueue` | `202` 접수 후 `/api/v1/operations/{id}` polling |
| MCP `atelier_create_product` | `NAVER_ALLOW_WRITES=true` + exact `writeConfirmation` | SQLite `product_jobs` | `ProductService.create()` direct; seller-management-code duplicate lookup; HTTP Bearer/rate limit/api_operations 미사용 |
| CLI `product create --execute` | `NAVER_ALLOW_WRITES=true` + exact `writeConfirmation` | SQLite `product_jobs` | `ProductService.create()` direct; HTTP Bearer/rate limit/api_operations 미사용 |

## 핵심 설계 판단

1. **MCP는 6개 도구로 좁게, HTTP는 operation 전체로 넓게** — 에이전트가 실수로 넓은 쓰기 표면을 갖지 않도록 MCP 표면을 최소화했습니다. 대신 HTTP v05는 스펙의 operation을 게이트와 함께 노출합니다. 트레이드오프는 MCP만으로는 전체 운영 기능을 사용할 수 없다는 점입니다.
2. **손으로 endpoint를 나열하는 대신 manifest 기반 allowlist** — `specs/naver-commerce/current.json`과 `specs/naver-searchad/current.json`을 읽어 operation, gate, confirmation을 결정합니다. 스펙 동기화와 coverage 검사를 할 수 있지만, manifest 품질과 runtime gate 구성이 곧 안전 경계가 됩니다.
3. **fail-closed 다층 쓰기 게이트와 정확한 확인 문구** — 환경변수 기본값을 false로 두고, 읽기/쓰기/삭제/주문/클레임/문의/솔루션/판매자/multipart/unverified 게이트를 각각 확인합니다. 파괴적 작업은 2차 확인을 요구합니다. 트레이드오프는 운영 절차가 번거로워진다는 점입니다.
4. **고객 단위 SearchAd 자격증명** — principal(access license + secret) → grant → customer 구조를 쓰고, 한 고객에 principal 하나만 허용해 서명 주체가 모호해지지 않게 했습니다. status/accounts는 원본 `customerId`와 `customerIdMasked`를 함께 반환하며 secret key는 반환하지 않습니다. 원본 ID 비노출이 필요하면 response DTO 변경과 별도 테스트가 필요합니다. 이는 고객 단위 자격증명 스코프이며, 사용자별 권한 격리를 의미하지 않습니다.
5. **멱등성 원장과 명시적인 non-exactly-once 의미론** — `idempotency_key` unique 제약으로 중복 operation 기록을 막고, 재사용 시 `operation_type`과 `source_product_id`를 항상 비교합니다. 요청 본문 비교는 호출자가 `request`를 넘길 때만 수행되며, SearchAd execute 재사용과 `createAsyncOperation` reuse/race 분기는 현재 `request`를 넘기지 않아 같은 key + 같은 operation/resource + 다른 body가 기존 operation을 반환할 수 있습니다. route 수준 body 동등성 강제는 아직 없습니다. 자세한 계약은 `smartstore-bridge/docs/ARCHITECTURE.md` §5를 참고합니다. 다만 원격 쓰기 자체의 exactly-once를 보장하지 않으며, 프로세스 중단 시 `interrupted` 또는 결과 미확인 상태가 남을 수 있어 reconciliation은 수동입니다.
6. **Drive 경계·지연 materialize·정확한 채널 식별자** — HAAR 허용 루트 밖 작업을 차단하고, 전체 카탈로그를 상시 복사하지 않고 필요한 파일만 캐시합니다. 채널 가져오기는 `(source_id, source_product_id)`를 정확한 식별자로 사용합니다. 트레이드오프는 캐시 최신성 관리와 경계 설정의 운영 복잡성입니다.

## 직접 구현한 범위

요구사항과 API 스펙 분석, MCP 도구 계약 설계, 커머스·SearchAd gateway, HTTP v05 조립, Drive 경계, 채널 가져오기, 테스트를 1인 프로젝트로 구현했습니다. 이 저장소는 구현과 로컬/모의 테스트에 초점을 두며, 실계정 운영 성과를 주장하지 않습니다.

## 코드 읽기 지도

| 보고 싶은 것 | 파일 |
|---|---|
| MCP 엔트리와 stdio 전송 | `smartstore-bridge/src/mcp.js` |
| MCP 6개 도구 계약 | `smartstore-bridge/src/mcp/tools.js` |
| 커머스 operation gateway | `smartstore-bridge/src/naver/commerce/gateway.js` |
| SearchAd 서명·자격증명 | `smartstore-bridge/src/naver/searchad/auth.js` |
| SearchAd operation gateway | `smartstore-bridge/src/naver/searchad/gateway.js` |
| HTTP v05 라우트 조립 | `smartstore-bridge/src/http/server-v05.js` |
| 비동기 작업 큐 | `smartstore-bridge/src/application/operation-queue.js` |
| SQLite 작업 원장 | `smartstore-bridge/src/infrastructure/ledger.js` |
| Drive 루트 경계 | `smartstore-bridge/src/drive/boundary.js` |
| 채널 가져오기 서비스 | `smartstore-bridge/src/catalog/channel-import/import-service.js` |
| MCP stdio 계약 테스트 | `smartstore-bridge/test/mcp-contract.test.js` |
| MCP handler 테스트 | `smartstore-bridge/test/mcp-tools.test.js` |
| HTTP 보안 설정 테스트 | `smartstore-bridge/test/http-security-config.test.js` |
| 로컬 데모 fixture | `smartstore-bridge/examples/local-demo/catalog/catalog_manifest.json` |

## 실행과 테스트

```bash
cd smartstore-bridge && npm ci && npm test && npm run check
```

```bash
# MCP stdio 서버 (stdio로 블록됨)
npm run mcp

# 선택: MCP Inspector
npm run inspect:mcp
```

```bash
# HTTP v05, 기본 포트 3000, 기본 읽기 전용
# 기본 .env.example 상태는 API key/카탈로그가 없어 read-ready가 아닙니다. 로컬 데모는 아래 참고.
npm start
```

```bash
# 정적 스토어프론트 프로토타입
# 새 터미널에서 저장소 루트 기준
cd frontend && npm ci && npm run dev

# 브리지가 3000 포트를 사용 중이면
npm run dev -- -p 3001
```

로컬 HTTP 데모는 실제 자격증명 없이 fixture 카탈로그로 읽기 경로를 확인합니다. `smartstore-bridge`에서 `npm ci` 후 `examples/local-demo/README.md`의 환경변수로 `npm start`를 실행합니다. 상세 절차와 예상 응답은 [`smartstore-bridge/examples/local-demo/README.md`](smartstore-bridge/examples/local-demo/README.md)와 [`smartstore-bridge/README.md`](smartstore-bridge/README.md#로컬-http-데모)를 참고하세요.

MCP 클라이언트 설정 예시:

MCP에서 별도 config를 쓰려면 먼저 config/atelier-popo.example.json을 config/atelier-popo.json으로 복사합니다.

```json
{
  "mcpServers": {
    "atelier-popo-smartstore": {
      "command": "node",
      "args": ["/absolute/path/to/AtelierPopo/smartstore-bridge/src/mcp.js"],
      "env": {
        "ATELIER_POPO_CONFIG": "/absolute/path/to/AtelierPopo/smartstore-bridge/config/atelier-popo.json"
      }
    }
  }
}
```

절대 경로와 config 파일은 환경에 맞게 바꿉니다. 테스트는 mock/fixture 기반이며, Postgres 통합 테스트는 `TEST_DATABASE_URL`이 없으면 skip됩니다. 현재 테스트 스위트는 130개이며 129개 통과, 1개 skip입니다. MCP stdio 계약 테스트와 MCP handler 테스트, 로컬 데모 fixture 테스트, HTTP 보안 설정 테스트가 포함됩니다.

## 검증의 한계와 남은 문제

- 사용자별 authorization isolation은 구현되지 않았습니다. HTTP는 공유 Bearer API key를 쓰고, SearchAd grant는 고객 단위 자격증명입니다.
- 원격 쓰기의 exactly-once 실행은 보장하지 않습니다. 멱등성은 중복 operation 기록을 막는 수준이며, crash 이후 reconciliation은 수동입니다.
- HTTP v05 멱등성 재사용 경로 일부는 `request`를 넘기지 않아 같은 key + 같은 operation/resource + 다른 body가 기존 operation을 반환할 수 있습니다. route 수준 body 동등성 강제는 아직 없습니다.
- 상품 등록·광고 변경의 실계정 운영 검증은 이번 브랜치에서 실행하지 않았습니다. 자동화 테스트는 mocked/local입니다.
- Postgres 통합 테스트는 `TEST_DATABASE_URL`이 없으면 skip됩니다. CI에서는 Postgres service와 함께 실행되지만, workflow는 path/branch 범위로 동작합니다.
- `smartstore-bridge`의 `npm audit`은 이번 스냅샷에서 high advisory 0개입니다. 검증된 버전은 `@modelcontextprotocol/server 2.4.0`, `sharp 0.35.5`, `zod 4.6.7`입니다.
- `frontend`는 정적 프로토타입이며 clean `npm ci` 기준 `npm audit`도 0입니다. 검증된 버전은 Next `15.5.29`, Tailwind `3.4.19`, Autoprefixer `10.6.2` 및 build-time transitive overrides입니다. 이는 모든 의존성이 안전하다는 의미가 아닙니다.
- 프론트엔드는 정적 프로토타입이며 smartstore-bridge에 연결되어 있지 않고 자동화 테스트도 없습니다.
- 멱등성 재사용 처리 블록이 여러 route 모듈에 반복되어 있어 향후 공통 헬퍼로 추출할 후보입니다.
- v03/v04 legacy entrypoint와 과거 planning 문서는 이력 보존을 위해 남겨두었습니다. 현재 작업 기준은 v05입니다.

## 문서

- [`smartstore-bridge/README.md`](smartstore-bridge/README.md)
- [`smartstore-bridge/examples/local-demo/README.md`](smartstore-bridge/examples/local-demo/README.md)
- [`smartstore-bridge/docs/ARCHITECTURE.md`](smartstore-bridge/docs/ARCHITECTURE.md)
- [`smartstore-bridge/docs/NAVER_SEARCHAD_CURRENT.md`](smartstore-bridge/docs/NAVER_SEARCHAD_CURRENT.md)
- [`smartstore-bridge/docs/MULTI_SOURCE_PRODUCT_ARCHITECTURE.md`](smartstore-bridge/docs/MULTI_SOURCE_PRODUCT_ARCHITECTURE.md)
- [`smartstore-bridge/.env.example`](smartstore-bridge/.env.example)

## License

Apache-2.0. See [`LICENSE`](LICENSE).
