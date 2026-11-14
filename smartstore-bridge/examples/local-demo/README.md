# 로컬 HTTP 데모

실제 네이버·SearchAd·Drive 자격증명 없이 로컬 fixture 카탈로그로 HTTP v05의 읽기 경로를 확인하는 데모입니다. `examples/local-demo/catalog/catalog_manifest.json`에는 상품 1개(`1905`, `귀걸이`)만 들어 있습니다.

## 실행

`smartstore-bridge` 디렉터리에서 실행합니다. 기존 `config/atelier-popo.example.json`을 그대로 사용하며 새 config 파일은 만들지 않습니다.

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

`npm start`는 HTTP 서버를 계속 실행하므로, 아래 `curl` 명령은 다른 터미널에서 API key를 다시 export한 뒤 실행합니다.

## 확인

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

uptimeSeconds는 실행 시점에 따라 달라집니다. `/api/v1/status`의 `readiness`에서 다음 값을 확인합니다.

```json
{"readyForRead":true,"readyForPreview":false,"readyForWrite":false}
```

`readyForPreview`가 `false`인 이유는 예제 config의 카테고리 ID가 `REPLACE_WITH_NAVER_LEAF_CATEGORY_ID` 플레이스홀더이기 때문입니다. `readyForWrite`는 쓰기 gate가 기본 비활성이라 `false`입니다.

## 안전 기본값

`.env.example`만 복사해 API key 없이 실행하면 `/health`는 `200`이지만 `status:"degraded"`, `/health/ready`는 `503` `status:"not_ready"`가 됩니다. 이는 실수로 원격 쓰기가 열리지 않게 하는 안전한 기본값이며 실패가 아닙니다. 이 데모는 로컬 읽기만 확인하며 실제 상품 등록이나 광고 변경을 수행하지 않습니다.
