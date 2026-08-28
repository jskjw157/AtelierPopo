# Channel Product Import and Exact Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import all existing Naver SmartStore and HAAR Cafe24 listings into the HAAR internal catalog, assign every imported listing a `haar_product_id`, and join only exact, unique cross-channel code matches without synchronizing or modifying either remote channel.

**Architecture:** Add two read-only adapters: one over the existing Naver Commerce operation gateway and one over a new Cafe24 OAuth/Admin GET client. Persist import runs, immutable channel snapshots, exact identifiers, match candidates, review decisions, and reversible HAAR merges in a dedicated SQLite workspace, with an equivalent PostgreSQL migration for production. Keep import, registration, match preview, exact apply, review, merge, and revert as separate services so each can be tested with zero remote product writes.

**Tech Stack:** Node.js 22 ESM, built-in `fetch`, built-in `node:sqlite`, existing Naver Commerce gateway, Cafe24 Admin API OAuth 2.0, OpenAPI 3.1, Node test runner, GitHub Actions.

**Spec:** `smartstore-bridge/docs/superpowers/specs/2026-08-28-channel-product-import-mapping-design.md`

## Global Constraints

- `HAAR 자사몰 = Cafe24 = haar.co.kr` is one channel: `channel_id=haar_own_mall`, `channel_role=owned_store`, `platform_type=cafe24`.
- Importers may call remote read operations only. Naver `POST /v1/products/search` is allowed only because the local official manifest classifies it as `readOnly=true`.
- No code in this feature may create, update, publish, pause, delete, reprice, restock, or edit remote Naver/Cafe24 products.
- Naver and Cafe24 names, prices, options, stock, descriptions, images, and sales status remain independent.
- Every successfully imported channel listing receives exactly one `haar_product_id`.
- Automatic joining requires a non-empty exact key unique inside both channels.
- Name, price, image, category, and fuzzy option similarity never trigger an automatic join.
- Duplicate codes, partial SKU overlap, option-SKU mismatch, or manual mapping conflict become `review_required`.
- Re-importing the same remote content hash does not create another snapshot or HAAR product.
- Only a completed full import may set `missing_from_latest_full_import=true`.
- Internal writes require `ATELIER_HTTP_ALLOW_WRITES=true`, `ATELIER_CHANNEL_IMPORT_ALLOW_WRITES=true`, the exact confirmation string, and an idempotency key.
- Tokens, authorization headers, client secrets, and unmasked account identifiers never appear in logs or API responses.
- Runtime target: `smartstore-bridge v0.6.0`.
- Commerce coverage, SearchAd coverage, Drive tests, and multi-source tests stay green.

---

## File Map

### Create

```text
src/cafe24/config.js
src/cafe24/errors.js
src/cafe24/token-store.js
src/cafe24/auth.js
src/cafe24/client.js

src/catalog/channel-import/config.js
src/catalog/channel-import/canonical-json.js
src/catalog/channel-import/normalization.js
src/catalog/channel-import/sqlite-repository.js
src/catalog/channel-import/naver-importer.js
src/catalog/channel-import/cafe24-importer.js
src/catalog/channel-import/registrar.js
src/catalog/channel-import/import-service.js
src/catalog/channel-import/exact-match-engine.js
src/catalog/channel-import/merge-service.js
src/catalog/channel-import/review-service.js
src/catalog/channel-import/bootstrap.js

src/http/routes-channel-import.js
src/http/openapi-channel-import.js
migrations/sqlite/0001_channel_import_mapping.sql
migrations/postgres/0005_channel_import_mapping.sql
scripts/cafe24-oauth.mjs
scripts/channel-import-remote-smoke.mjs

test/fixtures/channel-import/naver-search-page.json
test/fixtures/channel-import/naver-product-detail.json
test/fixtures/channel-import/cafe24-products-page.json
test/fixtures/channel-import/cafe24-variants-page.json
test/channel-import-repository.test.js
test/cafe24-auth-client.test.js
test/channel-import-normalization.test.js
test/naver-channel-importer.test.js
test/cafe24-channel-importer.test.js
test/channel-import-service.test.js
test/exact-channel-match.test.js
test/haar-product-merge.test.js
test/channel-match-review.test.js
test/channel-import-bootstrap.test.js
test/channel-import-http.test.js
test/channel-import-remote-smoke.test.js
```

### Modify

```text
.env.example
.gitignore
package.json
package-lock.json
src/bootstrap-v05.js
src/http/server-v05.js
src/http/errors-v05.js
src/http/routes-system-v04.js
src/http-v05.js
Dockerfile
README.md
CHANGELOG_V0.6.0.md
.github/workflows/channel-import-ci.yml
```

---

### Task 1: Canonical hash and persistence schema

**Files:**
- Create: `src/catalog/channel-import/canonical-json.js`
- Create: `migrations/sqlite/0001_channel_import_mapping.sql`
- Create: `migrations/postgres/0005_channel_import_mapping.sql`
- Test: `test/channel-import-repository.test.js`

**Interfaces:**
- `stableJson(value): string`
- `sha256Json(value): string`

- [ ] **Step 1: Write the failing hash test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stableJson, sha256Json } from '../src/catalog/channel-import/canonical-json.js';

test('canonical hash ignores object key order and preserves array order', () => {
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
  assert.notEqual(sha256Json([1, 2]), sha256Json([2, 1]));
});
```

- [ ] **Step 2: Verify the test fails**

```bash
cd smartstore-bridge
node --test test/channel-import-repository.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement canonical JSON**

```js
import crypto from 'node:crypto';

export function stableJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => (
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  )).join(',')}}`;
}

export function sha256Json(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}
```

- [ ] **Step 4: Create SQLite tables**

The migration must create:

```text
schema_migrations
haar_products
channel_import_runs
channel_products
channel_product_snapshots
channel_product_identifiers
channel_match_runs
channel_match_candidates
channel_match_reviews
haar_product_merge_history
```

Required constraints:

```sql
CREATE TABLE IF NOT EXISTS haar_products (
  haar_product_id TEXT PRIMARY KEY,
  internal_sku TEXT UNIQUE,
  product_name TEXT NOT NULL,
  brand_name TEXT NOT NULL DEFAULT 'HAAR',
  status TEXT NOT NULL,
  canonical_attributes_json TEXT NOT NULL DEFAULT '{}',
  canonical_content_json TEXT NOT NULL DEFAULT '{}',
  merged_into_haar_product_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN (
    'draft','imported_unverified','active','paused','sold_out',
    'discontinued','archived','merged'
  ))
);

CREATE TABLE IF NOT EXISTS channel_import_runs (
  import_run_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  remote_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (mode IN ('full','incremental','single')),
  CHECK (status IN ('queued','running','succeeded','partial','failed'))
);

CREATE TABLE IF NOT EXISTS channel_products (
  channel_product_id TEXT PRIMARY KEY,
  channel_product_key TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  haar_product_id TEXT NOT NULL,
  remote_product_id TEXT NOT NULL,
  origin_product_no TEXT,
  seller_management_code TEXT,
  product_name TEXT NOT NULL,
  channel_status TEXT,
  channel_url TEXT,
  source_modified_at TEXT,
  latest_snapshot_id TEXT,
  link_provenance TEXT NOT NULL DEFAULT 'imported_unverified',
  missing_from_latest_full_import INTEGER NOT NULL DEFAULT 0,
  last_seen_import_run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (channel_id, remote_product_id),
  CHECK (link_provenance IN (
    'imported_unverified','exact_auto','manual_verified','merge_recovered'
  ))
);

CREATE TABLE IF NOT EXISTS channel_product_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  channel_product_id TEXT NOT NULL,
  import_run_id TEXT NOT NULL,
  source_modified_at TEXT,
  raw_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE (channel_product_id, content_hash)
);

CREATE TABLE IF NOT EXISTS channel_product_identifiers (
  identifier_id TEXT PRIMARY KEY,
  channel_product_id TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  scope TEXT NOT NULL,
  variant_reference TEXT NOT NULL DEFAULT '',
  eligible_for_exact_match INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (
    channel_product_id,identifier_type,normalized_value,scope,variant_reference
  ),
  CHECK (scope IN ('product','variant'))
);
```

- [ ] **Step 5: Create PostgreSQL migration**

`0005_channel_import_mapping.sql` must:

1. Rename existing UUID `channel_products.channel_product_key` to `channel_product_id`.
2. Add text `channel_product_key`, `remote_product_id`, snapshot/link/missing columns.
3. Backfill `remote_product_id` from `channel_product_no`.
4. Backfill `channel_product_key=channel_id || ':' || remote_product_id`.
5. Drop the unique `(channel_id,seller_management_code)` constraint; duplicate codes must be reviewable.
6. Add a non-unique seller-code index.
7. Extend HAAR statuses with `imported_unverified` and `merged`.
8. Rename old `product_ad_mappings.channel_product_key` UUID FK to `channel_product_id`.
9. Mirror all new tables with UUID, JSONB, and TIMESTAMPTZ types.

Use guarded PostgreSQL `DO $$` blocks so fresh and previously migrated databases both pass.

- [ ] **Step 6: Run test**

```bash
node --test test/channel-import-repository.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/catalog/channel-import/canonical-json.js \
        migrations/sqlite/0001_channel_import_mapping.sql \
        migrations/postgres/0005_channel_import_mapping.sql \
        test/channel-import-repository.test.js
git commit -m "feat: define channel import persistence schema"
```

---

### Task 2: Transactional SQLite repository

**Files:**
- Create: `src/catalog/channel-import/sqlite-repository.js`
- Modify: `test/channel-import-repository.test.js`

**Interfaces:**

```text
initialize()
close()
createImportRun(input)
updateImportCheckpoint(importRunId,patch)
finishImportRun(importRunId,patch)
upsertImportedChannelProduct({importRunId,draft})
getChannelProductByKey(channelProductKey)
listChannelProducts(filter)
listIdentifiers(filter)
listSnapshots(channelProductId)
markMissingAfterSuccessfulFullImport(channelId,importRunId)
```

- [ ] **Step 1: Add repository fixture tests**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteChannelImportRepository } from '../src/catalog/channel-import/sqlite-repository.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-repo-'));
  let sequence = 0;
  const repository = new SqliteChannelImportRepository({
    databasePath: path.join(dir, 'channel-import.sqlite'),
    idFactory: () => `id-${++sequence}`,
    clock: () => '2026-08-28T10:00:00.000Z'
  });
  repository.initialize();
  return { repository, close() {
    repository.close();
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

function draft(remoteProductId, code='HAAR-EAR-0012') {
  return {
    channelId: 'haar_naver_smartstore',
    remoteProductId,
    productName: `상품 ${remoteProductId}`,
    raw: { channelProductNo: remoteProductId, sellerManagementCode: code },
    normalized: { remoteProductId },
    identifiers: [{
      type: 'seller_management_code', value: code, normalizedValue: code,
      scope: 'product', variantReference: '', eligibleForExactMatch: true
    }],
    variants: []
  };
}

test('new listing creates one provisional HAAR product and snapshot', () => {
  const f = fixture();
  try {
    const run = f.repository.createImportRun({
      importRunId:'run-1', channelId:'haar_naver_smartstore',
      mode:'full', idempotencyKey:'naver-full-1'
    });
    const result = f.repository.upsertImportedChannelProduct({
      importRunId:run.importRunId, draft:draft('13732645378')
    });
    assert.equal(result.created, true);
    assert.equal(result.channelProduct.channelProductKey,
                 'haar_naver_smartstore:13732645378');
    assert.equal(result.haarProduct.status, 'imported_unverified');
    assert.equal(f.repository.listSnapshots(
      result.channelProduct.channelProductId).length, 1);
  } finally { f.close(); }
});

test('same hash reimport is unchanged and preserves the HAAR id', () => {
  const f = fixture();
  try {
    const one = f.repository.createImportRun({
      importRunId:'run-1', channelId:'haar_naver_smartstore',
      mode:'full', idempotencyKey:'one'
    });
    const first = f.repository.upsertImportedChannelProduct({
      importRunId:one.importRunId, draft:draft('1001')
    });
    const two = f.repository.createImportRun({
      importRunId:'run-2', channelId:'haar_naver_smartstore',
      mode:'full', idempotencyKey:'two'
    });
    const second = f.repository.upsertImportedChannelProduct({
      importRunId:two.importRunId, draft:draft('1001')
    });
    assert.equal(second.unchanged, true);
    assert.equal(second.haarProduct.haarProductId,
                 first.haarProduct.haarProductId);
    assert.equal(f.repository.listSnapshots(
      first.channelProduct.channelProductId).length, 1);
  } finally { f.close(); }
});

test('duplicate codes are stored instead of rejected', () => {
  const f = fixture();
  try {
    const run = f.repository.createImportRun({
      importRunId:'run-1', channelId:'haar_naver_smartstore',
      mode:'full', idempotencyKey:'duplicates'
    });
    f.repository.upsertImportedChannelProduct({
      importRunId:run.importRunId, draft:draft('1001','DUP')
    });
    f.repository.upsertImportedChannelProduct({
      importRunId:run.importRunId, draft:draft('1002','DUP')
    });
    assert.equal(f.repository.listIdentifiers({
      type:'seller_management_code', normalizedValue:'DUP',
      channelId:'haar_naver_smartstore'
    }).length, 2);
  } finally { f.close(); }
});
```

- [ ] **Step 2: Verify failure**

```bash
node --test test/channel-import-repository.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement migration runner**

Use `BEGIN IMMEDIATE`; record each migration filename in `schema_migrations`; rollback on failure.

- [ ] **Step 4: Implement transactional upsert**

Inside one transaction:

1. Build `channelProductKey=channelId + ':' + remoteProductId`.
2. Hash `{raw,normalized}`.
3. Create provisional HAAR product only when channel product is new.
4. Preserve existing `haar_product_id` on update.
5. Insert snapshot only when `(channel_product_id,content_hash)` is new.
6. Deactivate old identifiers; upsert current identifiers.
7. Return `{created,updated,unchanged,snapshotCreated,channelProduct,haarProduct}`.

- [ ] **Step 5: Implement missing detection**

Require the referenced run to be `mode=full`, `status=succeeded`, and the same channel before marking unseen rows missing.

- [ ] **Step 6: Run tests and commit**

```bash
node --test test/channel-import-repository.test.js
git add src/catalog/channel-import/sqlite-repository.js \
        test/channel-import-repository.test.js
git commit -m "feat: add transactional channel import repository"
```

---

### Task 3: Cafe24 OAuth rotation and read-only Admin client

**Files:**
- Create: `src/cafe24/config.js`, `errors.js`, `token-store.js`, `auth.js`, `client.js`
- Create: `scripts/cafe24-oauth.mjs`
- Test: `test/cafe24-auth-client.test.js`
- Modify: `.gitignore`

**Interfaces:**

```text
loadCafe24Config(env)
FileCafe24TokenStore.load()/save()
Cafe24TokenProvider.getAccessToken()/clear()
Cafe24AdminClient.get(apiPath,{query,timeoutMs})
```

The client exposes no POST/PUT/PATCH/DELETE product method.

- [ ] **Step 1: Write refresh-token test**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FileCafe24TokenStore } from '../src/cafe24/token-store.js';
import { Cafe24TokenProvider } from '../src/cafe24/auth.js';

test('refreshes early and persists rotated refresh token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe24-token-'));
  const store = new FileCafe24TokenStore({
    filePath:path.join(dir,'tokens.json'),
    initialTokens:{
      accessToken:'old', accessTokenExpiresAt:'2026-08-28T10:03:00.000Z',
      refreshToken:'refresh-old',
      refreshTokenExpiresAt:'2026-09-10T10:00:00.000Z'
    }
  });
  const provider = new Cafe24TokenProvider({
    config:{mallId:'haar',clientId:'id',clientSecret:'secret',
      tokenUrl:'https://haar.cafe24api.com/api/v2/oauth/token',
      refreshSkewMs:300000,requestTimeoutMs:30000},
    tokenStore:store,
    clock:()=>Date.parse('2026-08-28T10:00:00.000Z'),
    fetchImpl:async()=>new Response(JSON.stringify({
      access_token:'new',expires_at:'2026-08-28T12:00:00.000Z',
      refresh_token:'refresh-new',
      refresh_token_expires_at:'2026-09-11T10:00:00.000Z'
    }),{status:200,headers:{'content-type':'application/json'}})
  });
  try {
    assert.equal(await provider.getAccessToken(),'new');
    assert.equal(store.load().refreshToken,'refresh-new');
    assert.equal(fs.statSync(path.join(dir,'tokens.json')).mode & 0o777,0o600);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
```

- [ ] **Step 2: Implement strict configuration**

Read:

```dotenv
CAFE24_MALL_ID=
CAFE24_SHOP_NO=1
CAFE24_CLIENT_ID=
CAFE24_CLIENT_SECRET=
CAFE24_ACCESS_TOKEN=
CAFE24_ACCESS_TOKEN_EXPIRES_AT=
CAFE24_REFRESH_TOKEN=
CAFE24_REFRESH_TOKEN_EXPIRES_AT=
CAFE24_TOKEN_STORE_PATH=./work/cafe24-oauth-token.json
CAFE24_API_VERSION=
CAFE24_REQUEST_TIMEOUT_MS=30000
CAFE24_MAX_RETRIES=3
```

Validate mall ID, positive shop number, and `mall.read_product` scope.

- [ ] **Step 3: Implement atomic token store and refresh**

Write a temp sibling file, chmod `0600`, rename atomically, refresh five minutes before access expiry, rotate refresh tokens, and coalesce concurrent refresh requests.

- [ ] **Step 4: Write GET-client test**

```js
import { Cafe24AdminClient } from '../src/cafe24/client.js';

test('GET client is same-origin and redacts token metadata', async () => {
  let request;
  const client = new Cafe24AdminClient({
    config:{baseUrl:'https://haar.cafe24api.com/api/v2',
      requestTimeoutMs:30000,maxRetries:0},
    tokenProvider:{async getAccessToken(){return 'access-fixture';},clear(){}},
    fetchImpl:async(url,init)=>{
      request={url:String(url),init};
      return new Response(JSON.stringify({products:[]}),{
        status:200,headers:{'content-type':'application/json','x-request-id':'r1'}
      });
    }
  });
  const result=await client.get('/admin/products',{
    query:{shop_no:1,limit:100,offset:0}
  });
  assert.equal(request.init.method,'GET');
  assert.equal(request.init.headers.get('authorization'),'Bearer access-fixture');
  assert.equal(JSON.stringify(result.meta).includes('access-fixture'),false);
});
```

- [ ] **Step 5: Implement read-only retry rules**

Manual redirects, same-origin enforcement, one 401 refresh retry, GET-only retries for 429/502/503/504, `Retry-After`, and redacted metadata.

- [ ] **Step 6: Add OAuth helper and commit**

The helper generates state, prints an authorization URL for `mall.read_product`, exchanges `--code`, writes the token store, and prints expiry metadata only.

```bash
node --test test/cafe24-auth-client.test.js
git add src/cafe24 scripts/cafe24-oauth.mjs \
        test/cafe24-auth-client.test.js .gitignore
git commit -m "feat: add read-only Cafe24 OAuth client"
```

---

### Task 4: Exact identifier normalization

**Files:**
- Create: `src/catalog/channel-import/normalization.js`
- Test: `test/channel-import-normalization.test.js`

**Interfaces:**

```text
normalizeExactIdentifier(value)
normalizeVariantSkuSet(variants)
normalizeChannelProductDraft(input)
```

- [ ] **Step 1: Write tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExactIdentifier, normalizeVariantSkuSet,
  normalizeChannelProductDraft } from '../src/catalog/channel-import/normalization.js';

test('normalizes approved presentation differences only',()=>{
  assert.equal(normalizeExactIdentifier('  haar_ear 0012  '),'HAAR-EAR-0012');
  assert.equal(normalizeExactIdentifier('ＨＡＡＲ－００１２'),'HAAR-0012');
  assert.equal(normalizeExactIdentifier(''),null);
});

test('variant set is order-independent and rejects duplicates',()=>{
  assert.equal(normalizeVariantSkuSet([{normalizedSku:'A'},{normalizedSku:'B'}]),
               normalizeVariantSkuSet([{normalizedSku:'B'},{normalizedSku:'A'}]));
  assert.equal(normalizeVariantSkuSet([{normalizedSku:'A'},{normalizedSku:'A'}]),null);
});

test('name price and image never become exact identifiers',()=>{
  const draft=normalizeChannelProductDraft({
    channelId:'haar_own_mall',remoteProductId:421,productName:'같은 이름',
    price:19900,imageUrl:'https://example.com/a.jpg',identifiers:[]
  });
  assert.deepEqual(draft.identifiers,[]);
});
```

- [ ] **Step 2: Implement**

Use Unicode NFKC, trim, uppercase, and normalize only runs of spaces/`_`/`-` to `-`. Never remove digits, prefixes, suffixes, or words. Variant sets drop empty codes, reject duplicate codes, sort, then SHA-256 hash.

- [ ] **Step 3: Run and commit**

```bash
node --test test/channel-import-normalization.test.js
git add src/catalog/channel-import/normalization.js \
        test/channel-import-normalization.test.js
git commit -m "feat: define exact channel identifiers"
```

---

### Task 5: Read-only Naver importer

**Files:**
- Create: `src/catalog/channel-import/naver-importer.js`
- Create: Naver sanitized fixtures
- Test: `test/naver-channel-importer.test.js`

**Interfaces:**

```text
NaverChannelProductImporter.preview()
NaverChannelProductImporter.iterate({checkpoint})
```

- [ ] **Step 1: Save sanitized fixtures**

Capture current successful responses for `POST /v1/products/search` and `GET /v2/products/channel-products/{channelProductNo}`. Retain exact nesting and field names; replace live identifiers, names, and URLs.

- [ ] **Step 2: Write importer test**

```js
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverChannelProductImporter } from '../src/catalog/channel-import/naver-importer.js';

const search=JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/naver-search-page.json',import.meta.url),'utf8'));
const detail=JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/naver-product-detail.json',import.meta.url),'utf8'));

function gateway(calls){return{
  manifest:{operations:[
    {operationId:'post_v1_products_search',readOnly:true},
    {operationId:'get_v2_products_channel_products_by_channel_product_no',
      readOnly:true}
  ]},
  async execute(id,input){
    calls.push({id,input});
    if(id==='post_v1_products_search')return{data:structuredClone(search.data)};
    if(id==='get_v2_products_channel_products_by_channel_product_no')
      return{data:structuredClone(detail.data)};
    throw new Error(`unexpected ${id}`);
  }
};}

test('emits seller code using only pinned read operations',async()=>{
  const calls=[];
  const importer=new NaverChannelProductImporter({
    commerceGateway:gateway(calls),pageSize:100
  });
  const pages=[];
  for await(const page of importer.iterate())pages.push(page);
  assert.equal(pages[0].items[0].channelId,'haar_naver_smartstore');
  assert.equal(pages[0].items[0].remoteProductId,'13732645378');
  assert.equal(pages[0].items[0].identifiers.some(
    x=>x.type==='seller_management_code'),true);
  assert.deepEqual([...new Set(calls.map(x=>x.id))].sort(),[
    'get_v2_products_channel_products_by_channel_product_no',
    'post_v1_products_search'
  ]);
});
```

- [ ] **Step 3: Implement**

Constructor asserts both manifest operations exist and are read-only. Page search results, hydrate each channel product detail, emit raw search/detail snapshots, seller code, origin/channel IDs, status, URL, and variant manage codes. Resume from `{page}`. Never pass write confirmation or remote write context.

- [ ] **Step 4: Run and commit**

```bash
node --test test/naver-channel-importer.test.js
git add src/catalog/channel-import/naver-importer.js \
        test/fixtures/channel-import/naver-*.json \
        test/naver-channel-importer.test.js
git commit -m "feat: add read-only Naver channel importer"
```

---

### Task 6: Read-only Cafe24 importer

**Files:**
- Create: `src/catalog/channel-import/cafe24-importer.js`
- Create: Cafe24 sanitized fixtures
- Test: `test/cafe24-channel-importer.test.js`

- [ ] **Step 1: Save sanitized fixtures**

Capture current responses for product count, product list, and product variants. Retain product/variant code fields, display/selling fields, names, timestamps, and option structures.

- [ ] **Step 2: Write importer test**

```js
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Cafe24ChannelProductImporter } from '../src/catalog/channel-import/cafe24-importer.js';
const products=JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/cafe24-products-page.json',import.meta.url),'utf8'));
const variants=JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/cafe24-variants-page.json',import.meta.url),'utf8'));

test('uses GET endpoints and exact-enables custom codes only',async()=>{
  const calls=[];
  const client={async get(path,options={}){
    calls.push({path,options});
    if(path==='/admin/products/count')return{data:{count:1},meta:{}};
    if(path==='/admin/products')return{data:products.data,meta:{}};
    if(path==='/admin/products/421/variants')return{data:variants.data,meta:{}};
    throw new Error(`unexpected ${path}`);
  }};
  const importer=new Cafe24ChannelProductImporter({client,shopNo:1,pageSize:100});
  assert.deepEqual(await importer.preview(),{remoteCount:1,pageSize:100});
  const pages=[];
  for await(const page of importer.iterate())pages.push(page);
  const item=pages[0].items[0];
  assert.equal(item.channelId,'haar_own_mall');
  assert.equal(item.remoteProductId,'421');
  assert.equal(item.identifiers.find(x=>x.type==='custom_product_code')
    .eligibleForExactMatch,true);
  assert.equal(item.identifiers.find(x=>x.type==='product_code')
    .eligibleForExactMatch,false);
});
```

- [ ] **Step 3: Implement**

Use GET-only product count/list/variant pages, `shop_no`, limit/offset checkpoints, and canonical key `haar_own_mall:<product_no>`. Store all codes; default exact eligibility is true only for `custom_product_code` and `custom_variant_code`.

- [ ] **Step 4: Run and commit**

```bash
node --test test/cafe24-channel-importer.test.js
git add src/catalog/channel-import/cafe24-importer.js \
        test/fixtures/channel-import/cafe24-*.json \
        test/cafe24-channel-importer.test.js
git commit -m "feat: add read-only Cafe24 channel importer"
```

---

### Task 7: Registration and resumable import orchestration

**Files:**
- Create: `registrar.js`, `import-service.js`
- Modify: repository
- Test: `test/channel-import-service.test.js`

**Interfaces:**

```text
ChannelProductRegistrar.registerPage({importRunId,items})
ChannelImportService.preview(channelId)
ChannelImportService.run({channelId,mode,idempotencyKey})
ChannelImportService.getRun(importRunId)
```

- [ ] **Step 1: Write multi-page test**

Create a real SQLite repository fixture, a fake importer yielding two pages, and assert:

```js
const result=await service.run({
  channelId:'haar_naver_smartstore',mode:'full',idempotencyKey:'full-1'
});
assert.equal(result.status,'succeeded');
assert.equal(result.importedCount,2);
assert.equal(repository.listChannelProducts({
  channelId:'haar_naver_smartstore'
}).every(x=>x.haarProductId),true);
```

- [ ] **Step 2: Implement page registration**

Return `{discovered,created,updated,unchanged,failed,failures}`. A bad item records one failure without rolling back successful siblings.

- [ ] **Step 3: Implement state/checkpoint rules**

```text
queued → running → succeeded|partial|failed
Naver checkpoint: {page}
Cafe24 checkpoint: {offset}
```

Save checkpoint only after a complete page. Same idempotency key + same request reuses the run; same key + different request raises `CHANNEL_IMPORT_IDEMPOTENCY_CONFLICT`. Only `succeeded + full` marks missing.

- [ ] **Step 4: Add failure tests**

Assert a second-page failure produces `partial`, preserves the checkpoint, and makes zero missing-detection calls.

- [ ] **Step 5: Run and commit**

```bash
node --test test/channel-import-service.test.js
git add src/catalog/channel-import/registrar.js \
        src/catalog/channel-import/import-service.js \
        src/catalog/channel-import/sqlite-repository.js \
        test/channel-import-service.test.js
git commit -m "feat: add resumable channel imports"
```

---

### Task 8: Exact unique match engine

**Files:**
- Create: `exact-match-engine.js`
- Modify: migrations and repository
- Test: `test/exact-channel-match.test.js`

**Interfaces:**

```text
ExactChannelMatchEngine.preview({naverImportRunId,cafe24ImportRunId})
repository.createMatchRun/insertMatchCandidate/finishMatchRun
repository.listMatchableChannelProducts/listMatchCandidates
```

- [ ] **Step 1: Add match tables**

Add `channel_match_runs` and `channel_match_candidates` with counts, exact key fields, `auto_match|review_required|unmatched` status, reason JSON, and unique candidate identity.

- [ ] **Step 2: Write core tests**

```js
test('unique exact product codes auto-match',()=>{
  const result=previewFixture({
    naver:[listing('N1','haar_naver_smartstore',
      {seller_management_code:'HAAR-EAR-0012'})],
    cafe24:[listing('C1','haar_own_mall',
      {custom_product_code:'HAAR-EAR-0012'})]
  });
  assert.equal(result.run.exactMatchCount,1);
  assert.equal(result.candidates[0].status,'auto_match');
});

test('duplicate key produces review and zero auto matches',()=>{
  const result=previewFixture({
    naver:[
      listing('N1','haar_naver_smartstore',{seller_management_code:'DUP'}),
      listing('N2','haar_naver_smartstore',{seller_management_code:'DUP'})
    ],
    cafe24:[listing('C1','haar_own_mall',{custom_product_code:'DUP'})]
  });
  assert.equal(result.run.exactMatchCount,0);
  assert.equal(result.run.conflictCount,1);
});

test('same name price or image without exact code never auto-match',()=>{
  const result=previewFixture({
    naver:[listing('N1','haar_naver_smartstore',{})],
    cafe24:[listing('C1','haar_own_mall',{})]
  });
  assert.equal(result.candidates.some(x=>x.status==='auto_match'),false);
});
```

In the test file, define `listing()` and a repository fixture that stores left/right rows and candidates; instantiate the real engine.

- [ ] **Step 3: Implement exact priority**

```text
1 existing manual_verified shared HAAR mapping
2 unique internal_sku
3 unique sellerManagementCode ↔ eligible Cafe24 product code
4 unique product code + identical complete option-SKU set
5 review_required or unmatched
```

Build channel-local arrays for each key; auto-match only when both lengths equal one. The auto branch must not access name, price, category, or image data.

- [ ] **Step 4: Run and commit**

```bash
node --test test/exact-channel-match.test.js
git add migrations src/catalog/channel-import/exact-match-engine.js \
        src/catalog/channel-import/sqlite-repository.js \
        test/exact-channel-match.test.js
git commit -m "feat: add exact unique channel matching"
```

---

### Task 9: Reversible internal HAAR merges

**Files:**
- Create: `merge-service.js`
- Modify: migrations/repository
- Test: `test/haar-product-merge.test.js`

**Interfaces:**

```text
HaarProductMergeService({repository,guardProvider,idFactory,clock})
preview({leftHaarProductId,rightHaarProductId})
merge({survivorHaarProductId,mergedHaarProductId,actor,reason,linkProvenance})
revert({mergeId,actor})
```

- [ ] **Step 1: Add merge history table**

Store survivor/loser, full before/after JSON, reason, actor, created/reverted metadata.

- [ ] **Step 2: Write merge/revert test**

Seed two imported products using the real repository. Merge them, assert both channel listings point to survivor, revert, and assert original HAAR IDs return.

- [ ] **Step 3: Write blockers**

Inject `guardProvider.listBlockers(haarProductId)` and test blockers for SearchAd mapping, canonical variants, and conflicting supplier links.

- [ ] **Step 4: Implement deterministic survivor**

```text
1 manual/canonical product with internal SKU
2 active over imported_unverified
3 older created_at
4 lexical UUID
```

Merge in one transaction, change internal rows only, mark loser `merged`, and save before/after hashes. Revert only if current state still equals recorded after-state; otherwise raise `HAAR_MERGE_REVERT_STALE`.

- [ ] **Step 5: Run and commit**

```bash
node --test test/haar-product-merge.test.js
git add migrations src/catalog/channel-import/merge-service.js \
        src/catalog/channel-import/sqlite-repository.js \
        test/haar-product-merge.test.js
git commit -m "feat: add reversible HAAR product merges"
```

---

### Task 10: Exact apply and manual review

**Files:**
- Create: `review-service.js`
- Modify: migrations/repository
- Test: `test/channel-match-review.test.js`

**Interfaces:**

```text
applyExact({matchRunId,actor})
listReviews(filter)
getReview(reviewId)
confirm({reviewId,actor,note})
keepSeparate({reviewId,actor,note})
```

- [ ] **Step 1: Add review table**

Statuses: `pending`, `confirmed`, `keep_separate`, `rejected`.

- [ ] **Step 2: Test exact apply idempotency**

Seed one `auto_match` and one `review_required`. First apply invokes one merge with `linkProvenance='exact_auto'`; second apply invokes zero merges.

- [ ] **Step 3: Test manual decisions**

Confirm invokes merge with `manual_verified`; keep-separate records a suppressed pair and never invokes merge.

- [ ] **Step 4: Implement stale protection**

Candidate reason JSON stores expected snapshot hashes and HAAR IDs. Before apply or confirm, compare current values. Drift changes candidate to review and raises `STALE_MATCH_CANDIDATE`.

- [ ] **Step 5: Run and commit**

```bash
node --test test/channel-match-review.test.js
git add migrations src/catalog/channel-import/review-service.js \
        src/catalog/channel-import/sqlite-repository.js \
        test/channel-match-review.test.js
git commit -m "feat: add channel match review workflows"
```

---

### Task 11: Runtime configuration and bootstrap

**Files:**
- Create: `config.js`, `bootstrap.js` under channel-import
- Modify: `src/bootstrap-v05.js`, HTTP server/errors/system route
- Test: `test/channel-import-bootstrap.test.js`

- [ ] **Step 1: Test safe defaults**

```js
const config=loadChannelImportConfig({}, {workDir:'/tmp/haar'});
assert.equal(config.enabled,true);
assert.equal(config.allowWrites,false);
assert.equal(config.pageSize,100);
assert.deepEqual(config.exactProductFields,['custom_product_code']);
assert.deepEqual(config.exactVariantFields,['custom_variant_code']);
```

- [ ] **Step 2: Implement config**

```dotenv
ATELIER_CHANNEL_IMPORT_ENABLED=true
ATELIER_CHANNEL_IMPORT_ALLOW_WRITES=false
ATELIER_CHANNEL_IMPORT_DATABASE_PATH=./work/channel-import.sqlite
ATELIER_CHANNEL_IMPORT_PAGE_SIZE=100
ATELIER_CHANNEL_IMPORT_MAX_ITEM_FAILURES=20
ATELIER_CHANNEL_IMPORT_EXACT_PRODUCT_FIELDS=custom_product_code
ATELIER_CHANNEL_IMPORT_EXACT_VARIANT_FIELDS=custom_variant_code
ATELIER_CHANNEL_IMPORT_ACTOR=system
```

Validate page size 1–100, failures 0–1000, and code-field allowlists.

- [ ] **Step 3: Assemble dependencies**

Create repository, Naver importer, optional Cafe24 OAuth/client/importer, registrar, import service, exact engine, merge service, and review service. Cafe24 missing credentials yield `not_configured` while Naver remains ready.

- [ ] **Step 4: Extend lifecycle/error/readiness**

Map stable errors, redact secrets, show independent Naver/Cafe24 readiness, and close channel-import repository after queued operations stop.

- [ ] **Step 5: Run and commit**

```bash
node --test test/channel-import-bootstrap.test.js
git add src/catalog/channel-import/config.js \
        src/catalog/channel-import/bootstrap.js \
        src/bootstrap-v05.js src/http/server-v05.js \
        src/http/errors-v05.js src/http/routes-system-v04.js \
        test/channel-import-bootstrap.test.js
git commit -m "feat: wire channel import runtime"
```

---

### Task 12: HTTP and OpenAPI

**Files:**
- Create: `src/http/routes-channel-import.js`
- Create: `src/http/openapi-channel-import.js`
- Modify: server/system route
- Test: `test/channel-import-http.test.js`

- [ ] **Step 1: Add routes**

```http
POST /api/v1/channel-imports/naver/preview
POST /api/v1/channel-imports/naver/run
POST /api/v1/channel-imports/cafe24/preview
POST /api/v1/channel-imports/cafe24/run
GET  /api/v1/channel-imports
GET  /api/v1/channel-imports/{importRunId}
GET  /api/v1/channel-products
GET  /api/v1/channel-products/{channelProductKey}
GET  /api/v1/haar-products/{haarProductId}/channel-products
POST /api/v1/channel-matches/preview
POST /api/v1/channel-matches/apply-exact
GET  /api/v1/channel-matches/{matchRunId}
GET  /api/v1/channel-match-reviews
GET  /api/v1/channel-match-reviews/{reviewId}
POST /api/v1/channel-match-reviews/{reviewId}/confirm
POST /api/v1/channel-match-reviews/{reviewId}/keep-separate
POST /api/v1/haar-products/{haarProductId}/merge
POST /api/v1/haar-product-merges/{mergeId}/revert
```

- [ ] **Step 2: Enforce confirmations**

```text
IMPORT_CHANNEL_PRODUCTS
APPLY_EXACT_CHANNEL_MATCHES
CONFIRM_CHANNEL_PRODUCT_MATCH
KEEP_CHANNEL_PRODUCTS_SEPARATE
MERGE_HAAR_PRODUCTS
REVERT_HAAR_PRODUCT_MERGE
```

- [ ] **Step 3: Test gates and zero remote writes**

Using `createHttpApiV05` and a fake runtime:

```js
const preview=await call('POST','/api/v1/channel-imports/naver/preview',{});
assert.equal(preview.status,200);
const blocked=await call('POST','/api/v1/channel-imports/naver/run',{
  mode:'full',confirmation:'IMPORT_CHANNEL_PRODUCTS',idempotencyKey:'run-1'
});
assert.equal(blocked.status,403);
```

With both internal gates enabled, expect `202`, reuse the same operation for repeated idempotency key, and assert a remote product-write spy count of zero.

- [ ] **Step 4: Add OpenAPI**

Expose `/openapi-channel-import.json` with tags `Channel Imports`, `Channel Products`, `Exact Matching`, `Match Reviews`, and `HAAR Product Merges`. Every internal write schema requires confirmation and idempotency key.

- [ ] **Step 5: Run and commit**

```bash
node --test test/channel-import-http.test.js
git add src/http/routes-channel-import.js \
        src/http/openapi-channel-import.js \
        src/http/server-v05.js src/http/routes-system-v04.js \
        test/channel-import-http.test.js
git commit -m "feat: expose channel import and matching API"
```

---

### Task 13: Smoke tool, environment, and runbook

**Files:**
- Create: `scripts/channel-import-remote-smoke.mjs`
- Create: `docs/CHANNEL_PRODUCT_IMPORT_RUNBOOK.md`
- Create: `CHANGELOG_V0.6.0.md`
- Modify: `.env.example`, Dockerfile, README, package files
- Test: `test/channel-import-remote-smoke.test.js`

- [ ] **Step 1: Implement safe CLI modes**

```text
--channel naver|cafe24 --preview
--channel naver|cafe24 --sample 1..10
```

Export `parseArgs(argv)`. Reject run/apply/merge/delete modes. Output only channel, count, key, name, and identifier types; never raw snapshots or identifier values.

- [ ] **Step 2: Add env defaults**

Add channel-import and Cafe24 variables from Tasks 3 and 11 with writes disabled.

- [ ] **Step 3: Write operator runbook**

```text
1 deploy with writes disabled
2 verify Naver read permission
3 create Cafe24 app with mall.read_product
4 run Cafe24 OAuth and store rotating token on persistent disk
5 preview Naver
6 preview Cafe24
7 enable internal HTTP/import writes
8 full-import Naver
9 full-import Cafe24
10 preview exact matches
11 review counts/conflicts
12 apply exact matches
13 resolve manual reviews
```

Rollback disables internal writes, preserves DB/snapshots, and reverts only the selected internal merge. It never calls a remote product update.

- [ ] **Step 4: Version and persistence**

Bump root package/lock version to `0.6.0`; add `cafe24:oauth` and `channel-import:smoke` scripts; create/chown persistent work directories in Docker.

- [ ] **Step 5: Run and commit**

```bash
node --test test/channel-import-remote-smoke.test.js
git add scripts/channel-import-remote-smoke.mjs \
        docs/CHANNEL_PRODUCT_IMPORT_RUNBOOK.md CHANGELOG_V0.6.0.md \
        .env.example Dockerfile README.md package.json package-lock.json \
        test/channel-import-remote-smoke.test.js
git commit -m "docs: add channel import operations and smoke tooling"
```

---

### Task 14: CI and final verification

**Files:**
- Create: `.github/workflows/channel-import-ci.yml`
- Create: `smartstore-bridge/TEST_REPORT_V0.6.0.txt`
- Modify: package check command if necessary

- [ ] **Step 1: Add CI workflow**

```yaml
name: Channel import CI
on:
  pull_request:
    paths:
      - 'smartstore-bridge/**'
      - '.github/workflows/channel-import-ci.yml'
  workflow_dispatch:
jobs:
  verify:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: smartstore-bridge
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci --no-audit --no-fund
      - run: npm run check
      - run: npm test
      - run: npm run commerce:coverage
      - run: npm run searchad:coverage
      - run: >
          node --test
          test/naver-channel-importer.test.js
          test/cafe24-channel-importer.test.js
          test/channel-import-service.test.js
          test/exact-channel-match.test.js
          test/channel-match-review.test.js
          test/haar-product-merge.test.js
```

- [ ] **Step 2: Run complete local verification**

```bash
cd smartstore-bridge
npm ci --no-audit --no-fund
npm run check
npm test
npm run commerce:coverage
npm run searchad:coverage
```

Expected:

```text
all tests pass
Commerce coverage remains 116/116
SearchAd unclassified operations remain 0
SearchAd duplicate operation keys remain 0
remote product write spy count remains 0
```

- [ ] **Step 3: Verify specification coverage**

Test evidence must cover Naver/Cafe24 full imports, one HAAR ID per listing, exact-only matching, no fuzzy matching, duplicate conflicts, channel independence, immutable snapshots, idempotent reimport, partial import no missing flag, merge/revert, one Cafe24 channel, and zero remote writes.

- [ ] **Step 4: Write test report**

Record Node/npm versions, commit SHA, test counts, Commerce/SearchAd coverage, focused channel-import test counts, and remote-write spy result.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/channel-import-ci.yml \
        smartstore-bridge/TEST_REPORT_V0.6.0.txt \
        smartstore-bridge/package.json
git commit -m "test: verify channel import and exact mapping v0.6.0"
```

---

## Execution Order and Review Gates

Execute Tasks 1–14 in order. Require reviewer checkpoints after:

```text
Task 3  Cafe24 token handling and read-only client
Task 6  Cafe24 importer contract
Task 8  exact-match classification
Task 9  reversible merge semantics
Task 12 HTTP/OpenAPI contract
Task 14 full regression and zero-remote-write proof
```

Do not enable operational import writes until every task passes. Do not apply exact matches until both full imports succeed and the preview counts have been reviewed.
