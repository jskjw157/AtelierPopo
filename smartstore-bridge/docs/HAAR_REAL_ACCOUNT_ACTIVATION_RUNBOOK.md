# HAAR 실계정 연결·검증·전체 기능 활성화 Runbook

> 대상: 네이버 스마트스토어, HAAR 자사몰(Cafe24), 네이버 SearchAd, Google Drive  
> 원칙: 기존 상품 가져오기는 원격 읽기 + HAAR 내부 DB 쓰기이며, 채널 간 자동 동기화는 하지 않는다.  
> SearchAd 원칙: 공식 조회·쓰기·생성·수정·배치·원격 삭제 처리·롤백·자동화 기능을 모두 구현하고, 최초 Capability·Canary 검증 전까지만 원격 실행 Gate를 임시로 닫는다.

## 0. 배포 기록

운영 시작 전에 아래 값을 기록한다.

```text
배포일시(KST):
Git commit SHA:
Hostinger deployment ID:
운영 도메인:
DATABASE_URL 대상:
네이버 판매자 ID:
Cafe24 mall_id:
SearchAd Customer ID(마스킹):
작업자:
승인자:
```

비밀키·토큰·서명·Refresh Token은 이 문서나 GitHub Issue에 적지 않는다.

## 1. 사전 백업

```text
PostgreSQL 전체 백업
기존 SQLite operation ledger 백업
SearchAd write SQLite 원장 백업
Cafe24 암호화 token-store 백업
Hostinger 환경변수 이름 목록 백업(값 제외)
현재 배포 SHA 기록
```

복원 명령과 백업 파일의 SHA-256을 별도 운영 기록에 남긴다.

## 2. Hostinger 배포

1. GitHub `main`의 승인된 SHA를 배포한다.
2. Node.js 버전이 `package.json`의 engines 조건을 만족하는지 확인한다.
3. `npm ci`로 고정 Lockfile을 설치한다.
4. 영속 디스크 경로를 다음 데이터에 사용한다.

```text
운영 DB 또는 SQLite 파일
SearchAd write 원장
Cafe24 encrypted token store
SearchAd 보고서 원본·quarantine
백업·감사 기록
```

`/tmp` 또는 재배포 시 삭제되는 경로에 운영 원장을 두지 않는다.

## 3. 환경변수

### 3.1 공통

```dotenv
ATELIER_HTTP_API_KEYS=<secret>
ATELIER_HTTP_ALLOW_WRITES=true
DATABASE_URL=<postgres-secret>
```

### 3.2 네이버 커머스API

```dotenv
NAVER_CLIENT_ID=<secret>
NAVER_CLIENT_SECRET=<secret>
NAVER_SELLER_ID=<approved-seller>
```

네이버 API센터에 Hostinger의 고정 Outbound IPv4를 등록한다. 고정 IP가 보장되지 않으면 실계정 호출 전에 배포 방식을 변경한다.

### 3.3 Cafe24

```dotenv
CAFE24_MALL_ID=<mall-id>
CAFE24_CLIENT_ID=<secret>
CAFE24_CLIENT_SECRET=<secret>
CAFE24_REDIRECT_URI=https://<domain>/oauth/cafe24/callback
CAFE24_TOKEN_ENCRYPTION_KEY=<32-byte-secret>
CAFE24_TOKEN_STORE_PATH=<persistent-path>/cafe24-token.enc
```

`HAAR 자사몰 = Cafe24 = haar.co.kr`이며 판매 채널은 `haar_own_mall` 한 개다.

### 3.4 SearchAd

```dotenv
NAVER_SEARCHAD_ACCESS_LICENSE=<secret>
NAVER_SEARCHAD_SECRET_KEY=<secret>
NAVER_SEARCHAD_CUSTOMER_ID=<customer-id>

ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED=true
ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS=true
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_ROLLBACK=false
ATELIER_SEARCHAD_ALLOW_RECONCILE=true
ATELIER_SEARCHAD_ACTIVATION_MODE=prevalidation
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
ATELIER_SEARCHAD_WRITE_DB_PATH=<persistent-path>/searchad-write.sqlite
```

위 `false`는 영구 금지가 아니라 검증 전 임시 Gate다.

## 4. 배포 기본 확인

```http
GET /health
GET /ready
GET /openapi-searchad.json
GET /openapi-searchad-write.json
GET /openapi-channel-imports.json
```

확인 항목:

```text
배포 SHA가 승인 SHA와 일치
SearchAd gateway ready
SearchAd write status에서 permanentWriteProhibition=false
activationMode=prevalidation
allowWrites=false
allowRollback=false
Cafe24 credential 값·파일경로·토큰이 응답에 노출되지 않음
```

## 5. 네이버·Cafe24 기존 상품 가져오기

### 5.1 읽기 전용 Smoke

먼저 각 채널에서 소량 Preview만 수행한다.

```text
네이버 상품 1페이지 조회
Cafe24 상품 1페이지·옵션 조회
원격 HTTP mutation 호출 0건 확인
상품 코드·옵션 SKU 추출 확인
```

### 5.2 Full Import

Preview 결과가 정상일 때 내부 Import를 시작한다.

```text
네이버 full import
Cafe24 full import
```

기록:

```text
Naver importRunId:
Cafe24 importRunId:
페이지 수:
가져온 상품 수:
실패 페이지:
재개 횟수:
```

부분 실패한 Full Import에서는 기존 상품을 missing으로 표시하지 않는다. 실패 원인을 해결한 뒤 동일 Run을 Resume한다.

### 5.3 내부 상품 확인

```text
정상적으로 가져온 모든 채널 상품에 haar_product_id 존재
원본 JSON 불변 스냅샷 존재
같은 Hash 재수집 시 스냅샷 중복 없음
Cafe24와 자사몰 중복 채널 없음
원격 상품 생성·수정·삭제 0건
```

### 5.4 정확 일치 매핑

```text
Exact Match Preview
→ 중복 코드·옵션 불일치 확인
→ exact_unique 후보만 적용
→ review_required 수동 검토
→ 필요한 경우 내부 Merge
```

상품명·가격·이미지 유사도만으로 자동 병합하지 않는다. Merge/Revert는 HAAR 내부 DB만 변경하며 원격 상품을 수정하지 않는다.

## 6. SearchAd Passive Capability

원격 쓰기를 켜기 전에 다음 조회를 수행한다.

```text
광고계정
비즈머니
캠페인
광고그룹
키워드
소재·확장소재
비즈채널
공유예산
타게팅
통계·보고서
키워드 도구
입찰 추정
검수 이력
```

기능별 결과를 다음으로 분류한다.

```text
verified
permission_required
ad_product_required
contract_required
empty_but_reachable
invalid_probe
unsupported
```

`403`, `404`, 빈 배열만으로 미지원이라고 결론내리지 않는다.

## 7. SearchAd 변경 계획 Dry Run

쓰기 Gate를 닫은 상태에서 실제 대상의 현재값을 읽고 변경 계획을 생성한다.

```text
변경 전 전체 스냅샷
before_hash
공식 mutation operationKey
공식 단건 조회 operationKey
expectedPatch
rollback bodyFromBefore
사유·작성자·만료시각
```

승인 토큰은 발급할 수 있지만 Gate가 닫혀 있으므로 실제 execute는 `SEARCHAD_WRITES_PREVALIDATION_GATED`로 차단되어야 한다.

## 8. Active Canary

### 8.1 Canary 조건

```text
전용 이름·라벨
생성 즉시 OFF
최소 허용 예산·입찰가
실제 노출 방지 확인
Canary Run ID와 반환 Remote ID 저장
이름 검색이 아니라 반환 ID만 수정·삭제
TTL과 정리 상태 기록
```

### 8.2 Canary 전용 활성화

```dotenv
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=true
ATELIER_SEARCHAD_ALLOW_WRITES=true
ATELIER_SEARCHAD_ALLOW_ROLLBACK=true
ATELIER_SEARCHAD_ACTIVATION_MODE=canary
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
```

Canary에서 검증:

```text
캠페인 생성·조회
광고그룹 생성·조회
키워드 생성·조회
지원 소재 생성·검수 상태 조회
ON/OFF 왕복
입찰가 변경
일예산 변경
변경 후 원격 재조회
Drift 차단
타임아웃 unknown outcome 재조정
롤백
원격 삭제 처리 또는 OFF 상태 보존
실제 광고비 0원 확인
```

## 9. 전체 운영 활성화

Canary 기록과 정리 결과를 승인한 뒤:

```dotenv
ATELIER_SEARCHAD_ALLOW_WRITES=true
ATELIER_SEARCHAD_ALLOW_CREATES=true
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=true
ATELIER_SEARCHAD_ALLOW_ROLLBACK=true
ATELIER_SEARCHAD_ALLOW_DELETES=true
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=true
ATELIER_SEARCHAD_ALLOW_RECONCILE=true
ATELIER_SEARCHAD_ACTIVATION_MODE=active
```

자동화는 단계적으로 올린다.

```text
observe
→ recommend
→ approve
→ 제한 auto
→ 전체 정책 auto
```

최종 목표는 `auto` 지원과 운영 활성화다. 각 단계의 관찰기간·상한은 운영자가 변경할 수 있다.

## 10. 실제 변경 절차

1. `/api/v1/searchad/changes/plan`으로 계획 생성
2. 현재값·Hash·예상값·롤백 요청 검토
3. `APPROVE_SEARCHAD_CHANGE`로 승인
4. 1회용 실행 토큰 수령
5. Idempotency-Key와 토큰으로 execute
6. 적용 후 원격 재검증 결과 확인
7. `unknown_outcome`이면 같은 쓰기를 반복하지 않고 reconcile
8. 롤백 필요 시 현재 Hash가 적용 직후 Hash와 같은지 확인
9. `ROLLBACK_SEARCHAD_CHANGE`로 롤백
10. 감사 원장과 원격 광고주센터를 함께 확인

## 11. 장애 대응

| 상황 | 처리 |
|---|---|
| 401 | 키·토큰·Customer·서명 입력 확인, 쓰기 중단 |
| 403 | 계정 권한·광고상품·계약·Capability 재검증 |
| 429 | Retry-After 준수, Queue 감속 |
| 조회 5xx | 제한 재시도 |
| 쓰기 Timeout/502/503/504 | unknown_outcome, 동일 쓰기 반복 금지, reconcile |
| STALE_PLAN | 현재값으로 새 계획 생성 |
| 원격 검증 실패 | 추가 쓰기 금지, reconcile |
| rollback_unknown_outcome | 롤백 반복 금지, 광고주센터 수동 확인 |
| 상품 Import partial | missing 처리 금지, Resume |
| 토큰·Secret 노출 의심 | 키 회전, 로그 접근 제한, 사고 기록 |

## 12. Kill Switch

장애 시 다음 순서로 중단한다.

```dotenv
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_CREATES=false
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=false
ATELIER_SEARCHAD_ALLOW_ROLLBACK=false
ATELIER_SEARCHAD_ALLOW_DELETES=false
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
```

필요하면 애플리케이션 API Key도 회전하고 Worker/Scheduler를 중지한다. 조회·감사·reconcile은 사고 범위에 따라 유지할 수 있다.

## 13. Go-Live 승인표

```text
Gate A  배포·백업·영속 경로
Gate B  네이버·Cafe24 읽기 Smoke
Gate C  기존 상품 Full Import·Exact Match
Gate D  SearchAd Passive Capability
Gate E  SearchAd Active Canary·롤백·정리
Gate F  전체 쓰기·생성·배치·삭제·자동화 활성화
```

각 Gate의 실행자·승인자·시각·결과·근거 URL/Run ID를 기록한다. Gate 실패 시 다음 단계로 진행하지 않는다.
