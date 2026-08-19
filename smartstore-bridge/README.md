# 아뜰리에포포 스마트스토어 브리지

퀸실버에서 수집한 상품 데이터(`catalog_manifest.json`, 각 상품의 `product_info.json`, `images/`)를 읽어 **아뜰리에포포 스마트스토어용 네이버 커머스API 상품 등록 요청**으로 변환하는 로컬 CLI + MCP 스타터입니다.

현재 범위는 상품 등록 1차 버전입니다.

- 퀸실버 JSON 검증
- 공급가 파싱과 판매가 계산
- 옵션 추가금/품절 변환
- WebP 포함 원본 이미지를 JPEG로 정규화
- 네이버 이미지 업로드
- 상품 등록 페이로드 생성
- 판매자관리코드 기반 중복 등록 방지
- SQLite 작업 원장과 실패 기록
- CLI와 MCP가 같은 핵심 로직 공유
- dry-run 기본, 실제 쓰기 이중 잠금

## 1. 요구 환경

- Node.js 22.5 이상
- 네이버 커머스API센터의 **내 스토어 애플리케이션**
- 실제 API 호출 기기의 등록된 공인 IPv4
- 퀸실버 전체 데이터가 내려받아졌거나 동기화된 로컬 폴더

이 프로그램은 12GB가 넘는 이미지 묶음을 매번 Google Drive API로 읽지 않고 로컬/동기화 폴더에서 처리하도록 설계했습니다.

## 2. 설치

```bash
npm install
copy .env.example .env
copy config\atelier-popo.example.json config\atelier-popo.json
```

macOS/Linux:

```bash
cp .env.example .env
cp config/atelier-popo.example.json config/atelier-popo.json
```

`.env`:

```dotenv
NAVER_CLIENT_ID=발급받은_애플리케이션_ID
NAVER_CLIENT_SECRET=발급받은_애플리케이션_시크릿
NAVER_TOKEN_TYPE=SELF
NAVER_ALLOW_WRITES=false
ATELIER_POPO_CONFIG=./config/atelier-popo.json
```

시크릿은 Git, 채팅, 캡처, MCP 설정 공유본에 올리지 마세요.

## 3. 카탈로그 경로와 가격 정책 설정

`config/atelier-popo.json`의 `catalogRoot`를 실제 로컬 폴더로 바꿉니다.

```json
{
  "catalogRoot": "D:/queensilver_all_products_20260809"
}
```

기본 가격 예시는 다음 순서입니다.

```text
공급가(부가세 별도) × 1.1 × multiplier + flatFee
→ 900원 끝자리 올림
→ minimumPrice 적용
```

예시 설정의 `14,500원`은 `35,900원`으로 계산됩니다. 이 값은 예시이므로 반드시 아뜰리에포포의 수수료·광고비·배송비·마진 정책에 맞춰 수정하세요.

## 4. 네이버 카테고리 매핑

`categories`의 값은 스마트스토어 **리프 카테고리 ID**로 교체합니다. 퀸실버 원본에서 실제 사용되는 키는 `귀걸이`, `피어싱`, `반지`, `목걸이`, `팔찌`, `발찌`, `애완용_미아방지`, `연예인스타일`, `단종_주문제작가능`입니다.

카테고리 매핑이 없으면 실제 등록이 차단됩니다.

## 5. 가장 안전한 상품 템플릿 만들기

배송비, 출고지/반품지, 원산지, A/S 연락처, 상품정보제공고시는 스토어마다 다르므로 코드가 추측하지 않습니다.

스마트스토어센터에서 정상 판매 중인 **실버 액세서리 상품 1개**를 기준으로 템플릿을 추출하는 방법이 가장 안전합니다.

```bash
npm run cli -- template pull 12345678901 --out ./config/naver-product-template.json
```

그다음 `config/atelier-popo.json`의 `templateFile`을 바꿉니다.

```json
{
  "templateFile": "./naver-product-template.json"
}
```

추출 기능은 상품마다 달라지는 이름·카테고리·이미지·상세내용·가격·재고·옵션·판매자관리코드를 제거하고, 배송/반품/A/S/상품고시 같은 공통 설정을 남깁니다. 추출 결과도 첫 등록 전 반드시 검토하세요.

기존 상품이 없다면 `naver-product-template.example.json`의 플레이스홀더를 네이버 공식 스키마에 맞는 실제 스토어 정보로 직접 교체해야 합니다.

## 6. 권장 실행 순서

### 인증

```bash
npm run cli -- auth test
```

### 카탈로그 확인

```bash
npm run cli -- catalog stats "D:/queensilver_all_products_20260809"
```

### 상품 1개 소스 검증

```bash
npm run cli -- product validate "D:/.../귀걸이/1905_.../product_info.json"
```

### 상품 1개 dry-run

```bash
npm run cli -- product preview "D:/.../product_info.json"
```

결과는 기본적으로 `work/previews/<상품번호>.json`에 저장됩니다. 다음을 확인합니다.

- `validationErrors`가 빈 배열인지
- `executable`이 `true`인지
- 카테고리 ID
- 판매가
- 옵션명·추가금·품절
- 대표/상세 이미지 순서
- 배송·반품·A/S·상품정보고시

### 실제 상품 1개 등록

먼저 `.env`에서 다음 값을 명시적으로 켭니다.

```dotenv
NAVER_ALLOW_WRITES=true
```

그 후:

```bash
npm run cli -- product create "D:/.../product_info.json" --execute --confirm REGISTER
```

둘 중 하나라도 빠지면 등록되지 않습니다.

### 배치

```bash
npm run cli -- batch enqueue "D:/queensilver_all_products_20260809"
npm run cli -- batch status --status queued

# 먼저 10개 dry-run
npm run cli -- batch run --limit 10 --status queued

# 검수 후 10개 실제 등록
npm run cli -- batch run --limit 10 --status previewed --execute --confirm REGISTER

# 실패 건 조회/재실행
npm run cli -- batch status --status failed
npm run cli -- batch run --limit 10 --status failed --execute --confirm REGISTER
```

## 7. MCP 연결

`config/mcp-config.example.json`의 경로와 환경변수를 수정해 MCP 클라이언트 설정에 추가합니다.

제공 도구:

- `atelier_auth_test`
- `atelier_catalog_stats`
- `atelier_preview_product`
- `atelier_find_product`
- `atelier_create_product`
- `atelier_batch_status`

대량 등록은 MCP에 노출하지 않았습니다. LLM의 단일 호출로 1,515개가 등록되는 사고를 막기 위한 제한입니다. CLI 배치도 기본 최대 20개로 하드 캡되고 상품 사이에 800ms를 둡니다.

MCP Inspector:

```bash
npm run inspect:mcp
```

## 8. 중복·재시도 정책

- 판매자관리코드: `QUEEN-<퀸실버 상품번호>`
- 실제 등록 전 `/v1/products/search`로 동일 코드를 검색
- 이미 있으면 `exists` 처리하고 새 상품을 만들지 않음
- 모든 상태는 `work/atelier-popo.sqlite`에 저장
- 상태: `queued`, `previewed`, `creating`, `created`, `exists`, `skipped`, `failed`

## 9. 이미지 정책

- 숫자 접두사 순서(`001_`, `002_`...)로 정렬
- `001_`을 대표 이미지로 사용
- 원본의 작은 썸네일인 `002_`는 기본 상세 이미지에서 제외
- 대표 이미지: 흰 배경 1000×1000 JPEG
- 상세 이미지: 최대 폭 860px JPEG
- 추가 이미지: 최대 9개
- 업로드: 요청당 최대 10개, 설정상 총 9.5MB 이하로 분할

## 10. 테스트

```bash
npm test
npm run check
```

현재 포함된 테스트는 가격 계산, 900원 끝자리 처리, 옵션 추가금/품절 변환, 원화 파싱, 이미지 순서, 퀸실버 최소 구조를 검증합니다.

## 아직 실제 계정에서 확인해야 하는 부분

이 패키지에는 실제 아뜰리에포포 API ID/시크릿, 카테고리 ID, 배송/반품지 ID가 들어 있지 않습니다. 따라서 소스 변환 테스트는 가능하지만 **실제 스마트스토어 등록 성공 여부는 아뜰리에포포 자격증명과 완성된 템플릿으로 테스트 상품 1개를 등록해 확인해야 합니다.**

전체 설계는 `docs/ARCHITECTURE.md`, 초기 작업 순서는 `docs/SETUP_CHECKLIST.md`를 참고하세요.

## 원본 데이터 기준

이 스타터는 `docs/QUEENSILVER_SOURCE_REPORT.md`와 `examples/product_info.sample.json`의 실제 수집 구조를 기준으로 작성했습니다. 전체 데이터는 1,515개 상품, 1,515개 상품 JSON, 31,473개 이미지 구조입니다.
