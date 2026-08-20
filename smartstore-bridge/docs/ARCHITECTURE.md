# 아키텍처

## 실행 인터페이스

```text
CLI ─────────────┐
stdio MCP ───────┼── ProductService ── NaverCommerceClient ── 네이버 커머스API
HTTP API ────────┘           │
                              ├─ CatalogRepository
                              ├─ 이미지 정규화/업로드
                              └─ SQLite Ledger
```

CLI, MCP, HTTP는 상품 변환과 등록 핵심 로직을 공유합니다.

## HTTP 계층

```text
Hostinger HTTPS Reverse Proxy
            │
            ▼
Node HTTP Server
  ├─ Bearer API Key
  ├─ Request ID / JSON Log
  ├─ Body Size / Rate Limit
  ├─ Product-ID-only Router
  ├─ Write Safety Gate
  └─ Async Operation Queue
            │
            ▼
SQLite api_operations
            │
            ▼
ProductService.create()
```

외부 호출자는 서버 파일 경로를 전달할 수 없습니다. HTTP API는 `productId`를 받고 `CatalogRepository`가 `catalog_manifest.json`에서 내부 경로를 찾습니다.

## 쓰기 안전장치

단일 등록은 다음을 모두 요구합니다.

1. `NAVER_ALLOW_WRITES=true`
2. `ATELIER_HTTP_ALLOW_WRITES=true`
3. 요청 `confirmation=REGISTER`
4. 유효한 `idempotencyKey`
5. 페이로드 검증 통과
6. 판매자관리코드 중복 없음

배치는 `ATELIER_HTTP_ALLOW_BATCH_WRITES=true`를 추가로 요구하고 설정상 최대 20개로 제한됩니다.

## 비동기 처리

이미지 정규화와 업로드가 오래 걸릴 수 있어 HTTP 등록 요청은 `api_operations`에 기록되고 큐에서 실행됩니다. 기본 동시성은 1입니다.

```text
queued → running → succeeded
                 └→ failed
서버 재시작 → interrupted
```

서버 재시작 후 작업을 자동 재등록하지 않습니다. 네이버 쪽 성공 여부가 불명확한 작업은 판매자관리코드 중복 조회 후 사용자가 다시 결정합니다.

## 데이터와 영속성

```text
Catalog (read-only)
- catalog_manifest.json
- product_info.json
- images/

Work (persistent, writable)
- atelier-popo.sqlite
- previews/
- normalized-images/ (업로드 성공 후 기본 삭제)
```

운영 서버에서는 Catalog를 읽기 전용으로 마운트하고 Work만 쓰기 가능한 영속 볼륨으로 분리하는 구성이 권장됩니다.
