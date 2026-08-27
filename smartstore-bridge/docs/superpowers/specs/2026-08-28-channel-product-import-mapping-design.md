# HAAR 기존 채널 상품 가져오기·내부 등록·정확 일치 매핑 설계

> 작성일: 2026-08-28  
> 상태: **USER-APPROVED DESIGN — IMPLEMENTATION PLAN PENDING**  
> 대상: `smartstore-bridge`  
> 관련 채널: 네이버 스마트스토어, HAAR 자사몰(Cafe24/haar.co.kr)

---

## 1. 목적

이미 네이버 스마트스토어와 HAAR 자사몰(Cafe24)에 등록된 상품을 모두 가져와 HAAR 내부 상품 체계에 등록한다.

이 작업의 목적은 두 채널의 상품을 자동으로 맞추거나 덮어쓰는 것이 아니다. 각 채널의 기존 값을 그대로 보존하면서, 동일 제품으로 확실히 식별되는 항목만 하나의 `haar_product_id` 아래 연결하는 것이다.

```text
네이버 기존 상품 ─┐
                  ├─ HAAR 내부 상품(haar_product_id)
Cafe24 기존 상품 ─┘
```

---

## 2. 핵심 결정

### 2.1 가져오기와 동기화는 다르다

지원:

```text
기존 상품 전체 가져오기
채널별 원본 스냅샷 보존
HAAR 내부 상품 등록
채널 상품번호 연결
정확한 코드 일치 시 자동 연결
모호한 항목 검토 대기
```

지원하지 않음:

```text
네이버 ↔ Cafe24 자동 가격 동기화
재고 자동 동기화
상품명 자동 동기화
옵션 자동 동기화
상세페이지 자동 동기화
판매상태 자동 동기화
한 채널 값을 다른 채널에 자동 덮어쓰기
```

### 2.2 Cafe24와 자사몰은 하나의 채널이다

```text
channel_id: haar_own_mall
channel_role: owned_store
platform_type: cafe24
primary_domain: haar.co.kr
```

`Cafe24`, `OWN_SITE`, `haar.co.kr`을 서로 다른 채널로 생성하지 않는다.

### 2.3 자동 연결은 정확 일치만 허용한다

사용자 승인 방식은 **A안**이다.

자동 연결 가능:

- 동일한 기존 수동 매핑
- 양 채널의 내부 SKU가 정규화 후 정확히 일치하고 각 채널에서 유일함
- 네이버 `sellerManagementCode`와 Cafe24의 설정된 상품 코드가 정확히 일치하고 양쪽에서 유일함
- 상품 단위 코드와 옵션 SKU 집합이 모두 정확히 일치하고 중복이 없음

자동 연결 금지:

- 상품명만 유사함
- 가격만 같음
- 이미지가 비슷함
- 옵션명이 비슷함
- 일부 SKU만 같음
- 같은 코드가 한 채널에서 두 상품 이상에 사용됨

상품명·가격·이미지 유사도는 검토 화면의 정렬·추천 근거로만 사용할 수 있고 자동 병합 근거로 사용하지 않는다.

---

## 3. 가져오기 결과 원칙

모든 정상 조회 상품은 HAAR 내부에 누락 없이 등록한다.

### 3.1 정확히 매칭된 경우

```text
네이버 상품 N-100
Cafe24 상품 C-200
정확 SKU: HAAR-EAR-0012
        ↓
haar_product_id: 동일 UUID 1개
        ├─ channel_product: N-100
        └─ channel_product: C-200
```

### 3.2 매칭되지 않은 경우

잘못된 자동 병합을 하지 않고 각 채널 상품을 별도 HAAR 상품으로 우선 등록한다.

```text
네이버 상품 N-101
→ haar_product_id A
→ 상태: imported_unverified

Cafe24 상품 C-201
→ haar_product_id B
→ 상태: imported_unverified
```

이후 검토자가 A와 B가 같은 제품임을 확인하면 내부 병합을 수행한다.

### 3.3 충돌한 경우

같은 코드가 여러 상품에 존재하면 자동 연결하지 않는다.

```text
동일 코드 후보 2개 이상
→ review_required
→ 후보와 충돌 이유 기록
→ 사람이 하나를 선택하거나 별도 상품으로 확정
```

---

## 4. 식별자 계층

### 4.1 HAAR 내부 상품

```text
haar_product_id
internal_sku
```

판매·광고·수익성의 최종 내부 기준이다.

### 4.2 네이버 상품 식별자

가능한 값을 모두 보존한다.

```text
originProductNo
channelProductNo
sellerManagementCode
채널 상품 URL
옵션별 네이버 식별자·판매자 SKU
```

### 4.3 Cafe24 자사몰 식별자

Cafe24 API 응답에서 제공되는 값을 원문 그대로 보존한다.

```text
mall_id 또는 외부 스토어 ID
product_no
상품 코드
자체 상품 코드
옵션·품목 식별자
variant code / item code / SKU 성격의 필드
상품 URL
```

실제 필드명은 Cafe24 공식 API 응답 계약에 맞춰 Adapter에서 매핑한다. 확인되지 않은 필드명을 임의로 고정하지 않는다.

### 4.4 채널 상품 키

```text
channel_product_key
= channel_id + remote_product_id
```

예:

```text
haar_naver_smartstore:13732645378
haar_own_mall:421
```

---

## 5. 구성요소

### 5.1 `NaverChannelProductImporter`

역할:

- 네이버 커머스API로 기존 상품 목록 페이지 조회
- 원상품·채널상품·옵션 식별자 수집
- 원문 스냅샷 보존
- 읽기만 수행

금지:

- 상품 수정
- 판매상태 변경
- 가격·재고 변경

### 5.2 `Cafe24ChannelProductImporter`

역할:

- HAAR Cafe24 몰의 기존 상품·품목·옵션 조회
- 상품 코드·품목 코드·URL 수집
- 원문 스냅샷 보존
- 읽기만 수행

금지:

- Cafe24 상품 수정
- 상품 생성·삭제
- 가격·재고 변경

### 5.3 `ChannelProductRegistrar`

역할:

- 가져온 모든 채널 상품을 `channel_products`에 upsert
- 기존 연결이 없으면 임시 `haar_product_id` 생성
- 같은 채널 상품 재수집 시 중복 생성 방지
- 채널별 원본값 보존

### 5.4 `ExactChannelMatchEngine`

역할:

- 정규화된 exact key 생성
- 유일성 검사
- 자동 연결 가능·충돌·검토 대기 분류
- 유사도만으로 자동 병합 금지

### 5.5 `ChannelMatchReviewService`

역할:

- 모호한 후보 검토 대기열
- 후보 비교
- 수동 연결
- 별도 상품 확정
- 기존 잘못된 연결 해제
- HAAR 상품 내부 병합·복구 이력

---

## 6. Exact Key 규칙

### 6.1 문자열 정규화

정확 일치 비교 전에 다음만 정규화한다.

```text
앞뒤 공백 제거
영문 대소문자 통일
Unicode 정규화
연속 공백 1개로 축소
설정으로 허용된 구분자(-, _, 공백) 정규화
```

숫자 제거, 접두어 제거, 임의 단어 삭제처럼 의미를 바꾸는 정규화는 하지 않는다.

### 6.2 우선순위

```text
1. 기존 manual_verified 매핑
2. 내부 SKU exact unique match
3. sellerManagementCode ↔ Cafe24 configured product code exact unique match
4. 상품 코드 exact + 옵션 SKU 집합 exact unique match
5. 그 외 review_required
```

### 6.3 유일성 조건

자동 연결은 아래가 모두 참일 때만 허용한다.

```text
네이버 쪽 후보 수 = 1
Cafe24 쪽 후보 수 = 1
코드가 빈 문자열이 아님
해당 코드를 채널 내 다른 상품이 사용하지 않음
기존 수동 확정 매핑과 충돌하지 않음
옵션 SKU 집합 검사 대상인 경우 집합이 완전히 동일함
```

---

## 7. 데이터 모델

기존 `haar_products`, `channel_products`, `sales_channels`를 확장하고 다음 테이블을 추가한다.

### 7.1 `channel_import_runs`

```text
import_run_id
channel_id
mode                  # full / incremental / single
status                # queued / running / succeeded / partial / failed
remote_count
imported_count
updated_count
unchanged_count
failed_count
started_at
completed_at
cursor_json
error_json
```

### 7.2 `channel_product_snapshots`

```text
snapshot_id
channel_product_key
import_run_id
source_modified_at
raw_json
normalized_json
content_hash
captured_at
```

원본 스냅샷은 변경하지 않는다. 최신 상태는 별도 포인터나 최신 시각으로 조회한다.

### 7.3 `channel_product_identifiers`

```text
channel_product_key
identifier_type       # seller_management_code / product_code / variant_sku 등
identifier_value
normalized_value
scope                 # product / variant
variant_reference
is_active
```

### 7.4 `channel_match_runs`

```text
match_run_id
naver_import_run_id
cafe24_import_run_id
status
exact_match_count
review_count
unmatched_count
conflict_count
created_at
completed_at
```

### 7.5 `channel_match_candidates`

```text
candidate_id
match_run_id
left_channel_product_key
right_channel_product_key
match_type
exact_key_type
exact_key_value
confidence            # exact는 1.0, 검토 후보는 표시용
status                # auto_match / review_required / rejected / confirmed
reason_json
```

### 7.6 `channel_match_reviews`

```text
review_id
candidate_id
status                # pending / confirmed / keep_separate / rejected
reviewed_by
reviewed_at
note
```

### 7.7 `haar_product_merge_history`

```text
merge_id
survivor_haar_product_id
merged_haar_product_id
before_json
after_json
reason
actor
created_at
reverted_at
```

내부 병합은 원격 채널 상품을 수정하지 않는다.

---

## 8. 데이터 흐름

### 8.1 최초 전체 가져오기

```text
네이버 Full Import
→ 네이버 상품 내부 등록
→ Cafe24 Full Import
→ Cafe24 상품 내부 등록
→ Exact Match Preview
→ 자동 연결 대상·검토 대상 표시
→ 명시적 Apply
→ 검토 대기열 처리
```

### 8.2 재실행

```text
같은 channel_product_key
+ 같은 content_hash
→ unchanged

같은 channel_product_key
+ 다른 content_hash
→ 새 snapshot 저장 + channel_products 최신값 갱신

새 remote_product_id
→ 신규 등록
```

### 8.3 원격에서 사라진 상품

완료된 Full Import에서 이전 상품이 보이지 않더라도 즉시 삭제하지 않는다.

```text
missing_from_latest_full_import=true
```

로 표시하고, 연속 확인 또는 수동 검토 전까지 내부 기록과 매핑을 유지한다.

부분 실패한 Import는 누락 판정의 기준으로 사용할 수 없다.

---

## 9. API 설계

### 9.1 가져오기

```http
POST /api/v1/channel-imports/naver/preview
POST /api/v1/channel-imports/naver/run
POST /api/v1/channel-imports/cafe24/preview
POST /api/v1/channel-imports/cafe24/run
GET  /api/v1/channel-imports
GET  /api/v1/channel-imports/{importRunId}
```

### 9.2 내부 채널 상품 조회

```http
GET /api/v1/channel-products
GET /api/v1/channel-products/{channelProductKey}
GET /api/v1/haar-products/{haarProductId}/channel-products
```

### 9.3 매칭

```http
POST /api/v1/channel-matches/preview
POST /api/v1/channel-matches/apply-exact
GET  /api/v1/channel-matches/{matchRunId}
GET  /api/v1/channel-match-reviews
GET  /api/v1/channel-match-reviews/{reviewId}
```

### 9.4 수동 검토

```http
POST /api/v1/channel-match-reviews/{reviewId}/confirm
POST /api/v1/channel-match-reviews/{reviewId}/keep-separate
POST /api/v1/haar-products/{haarProductId}/merge
POST /api/v1/haar-product-merges/{mergeId}/revert
```

### 9.5 확인 문구

```text
기존 상품 가져오기             IMPORT_CHANNEL_PRODUCTS
정확 일치 연결 적용            APPLY_EXACT_CHANNEL_MATCHES
수동 연결 확정                 CONFIRM_CHANNEL_PRODUCT_MATCH
별도 상품 확정                 KEEP_CHANNEL_PRODUCTS_SEPARATE
HAAR 내부 상품 병합            MERGE_HAAR_PRODUCTS
병합 복구                      REVERT_HAAR_PRODUCT_MERGE
```

가져오기는 원격 읽기 작업이지만 내부 DB에 대량 등록하므로 멱등성 키와 확인 문구를 요구한다.

---

## 10. 안전장치

- 채널 Importer에는 원격 쓰기 메서드를 주입하지 않는다.
- 가져오기 단계는 네이버·Cafe24의 상품을 수정하지 않는다.
- 각 요청에 `channel_id`를 명시해 채널 간 식별자를 섞지 않는다.
- Import run은 페이지별 checkpoint를 저장한다.
- 완전 성공한 Full Import만 누락 상품 판정에 사용한다.
- `sellerManagementCode` 또는 SKU 중복은 자동 연결하지 않는다.
- 수동 확정 매핑은 자동 매칭보다 우선한다.
- 매칭 적용 전 Preview에 대상 수와 충돌 수를 표시한다.
- 내부 병합 전후 JSON과 연결 관계를 저장한다.
- 병합 복구는 원격 채널에는 아무 쓰기도 하지 않는다.
- API 자격증명·Cafe24 토큰·네이버 토큰은 로그에 남기지 않는다.

---

## 11. 오류 처리

### 11.1 채널 조회 실패

```text
401/403
→ credential_or_permission_error
→ Import 중단

429
→ Retry-After 기반 재시도

5xx/timeout
→ 제한 재시도
→ 페이지 checkpoint 유지
```

### 11.2 부분 Import

한 페이지 이상 실패하면:

```text
status=partial
```

로 기록한다. 부분 Import 결과로 원격 삭제·누락을 판단하지 않는다.

### 11.3 코드 충돌

```text
동일 exact key가 여러 상품에 존재
→ conflict
→ review_required
→ 자동 연결 0건
```

---

## 12. 테스트

### 12.1 자동 매칭

- 정확한 유일 SKU가 양 채널에 하나씩 있으면 자동 연결
- 대소문자·앞뒤 공백 차이만 있는 SKU는 정규화 후 연결
- 같은 코드가 두 번 나오면 자동 연결 금지
- 이름이 같아도 코드가 다르면 자동 연결 금지
- 가격과 이미지가 같아도 코드가 없으면 자동 연결 금지
- 상품 코드는 같지만 옵션 SKU 집합이 다르면 검토 대기
- 기존 수동 매핑과 충돌하면 검토 대기

### 12.2 가져오기

- 전체 페이지 수집
- 페이지 checkpoint 재개
- 동일 재실행 idempotent
- 변경 Hash가 같은 상품은 새 HAAR 상품을 만들지 않음
- 변경된 상품은 snapshot만 추가
- 부분 실패 시 누락 표시 금지
- 완료된 Full Import에서만 missing flag 갱신

### 12.3 채널 독립성

- 네이버 Import가 Cafe24 상품 값을 수정하지 않음
- Cafe24 Import가 네이버 상품 값을 수정하지 않음
- 매칭 적용이 원격 API의 POST/PUT/PATCH/DELETE를 호출하지 않음
- 가격·재고·옵션·상세페이지가 채널별로 유지됨

### 12.4 병합·복구

- 두 HAAR 상품 병합 후 모든 channel_product 연결이 survivor로 이동
- 원본 상품 기록과 merge history 유지
- 복구 시 병합 전 연결 관계 복원
- 광고 매핑이 존재하는 경우 후속 단계 전까지 병합 차단 또는 검토 요구

---

## 13. 완료 기준

- [ ] 네이버 기존 상품 전체를 내부에 가져올 수 있다.
- [ ] HAAR Cafe24 자사몰 기존 상품 전체를 내부에 가져올 수 있다.
- [ ] 모든 가져온 상품에 `haar_product_id`가 존재한다.
- [ ] 정확하고 유일한 코드만 자동 연결된다.
- [ ] 유사 이름·가격·이미지만으로 자동 병합되지 않는다.
- [ ] 중복 코드와 옵션 불일치는 검토 대기열로 간다.
- [ ] 네이버·Cafe24 값이 서로 자동 동기화되지 않는다.
- [ ] 채널 원문 스냅샷이 보존된다.
- [ ] 재가져오기가 멱등적으로 동작한다.
- [ ] 부분 Import가 삭제·누락 판정을 만들지 않는다.
- [ ] 내부 병합과 복구 이력이 남는다.
- [ ] Cafe24와 HAAR 자사몰이 하나의 채널로 유지된다.
- [ ] 원격 채널 쓰기 없이 모든 Import·매핑 테스트가 통과한다.

---

## 14. 명시적 비범위

이번 단계에서 구현하지 않는다.

```text
채널 간 자동 상품 동기화
네이버 또는 Cafe24 자동 수정·등록
가격·재고·옵션·상세페이지 일괄 배포
SearchAd 자동 매핑·입찰 변경
유사도 기반 자동 병합
주문·정산 통합 수익성 계산
```

이 기능들은 가져오기·내부 등록·정확 매핑이 안정화된 뒤 별도 설계와 승인으로 진행한다.
