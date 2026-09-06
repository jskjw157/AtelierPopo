# HAAR 네이버 SearchAd 쓰기·생성·자동화 활성화 정책

> 상태: 승인됨  
> 기준일: 2026-09-02  
> 대상: HAAR / 아뜰리에포포 SearchAd 통합

## 1. 확정 정책

HAAR SearchAd 통합은 조회 전용 프로그램이 아니다.

다음 공식 기능은 모두 개발하고, 네이버가 공개 지원하며 HAAR 광고계정에 권한이 승인된 기능은 운영계정에서 사용할 수 있게 활성화한다.

```text
캠페인 조회·생성·수정·ON/OFF·원격 삭제 처리
광고그룹 조회·생성·수정·ON/OFF·원격 삭제 처리
키워드 생성·수정·입찰가·URL·ON/OFF·원격 삭제 처리
소재·확장소재 생성·수정·복사·ON/OFF·원격 삭제 처리
비즈채널·타게팅·공유예산·라벨·상품그룹 관리
캠페인·광고그룹 일예산 변경
광고그룹·키워드 입찰가 변경
지원되는 자동입찰 전략
대량 생성·대량 수정
보고서·전환·검색어·입찰 추정
변경 계획·승인·실행·재검증·재조정·롤백
규칙 기반 자동화와 정책 범위 내 auto 실행
ChatGPT Reader·Operator·Executor·Admin Action
```

영구적인 쓰기 금지 정책은 없다.

## 2. 검증 전 임시 게이트

최초 실계정 연결 직후에는 다음 검증이 아직 끝나지 않았으므로 실행 게이트만 임시로 닫는다.

```text
Access License·Secret Key·Customer ID 검증
실제 계정 API 권한 확인
공식 operation manifest와 현재 광고상품 유형 확인
Passive Capability Probe
중지 상태 전용 Canary 생성
ON/OFF·입찰가·예산·생성·재검증·롤백 Canary
원격 타임아웃·unknown outcome·reconcile 검증
감사 로그·비밀정보 마스킹·Kill Switch 검증
```

초기값:

```dotenv
ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED=true
ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS=true
ATELIER_SEARCHAD_ALLOW_WRITES=false
ATELIER_SEARCHAD_ALLOW_ROLLBACK=false
ATELIER_SEARCHAD_ALLOW_RECONCILE=true
ATELIER_SEARCHAD_ACTIVATION_MODE=prevalidation
ATELIER_SEARCHAD_AUTOMATION_MODE=observe
```

이 상태에서도 변경 계획 작성, 현재값 조회, 예상 변경 검토, 승인 흐름 검증은 가능하다. 실제 원격 쓰기와 롤백만 임시로 막힌다.

## 3. Capability·Canary 통과 후 운영 활성화

검증 기록이 남으면 운영 환경변수를 다음과 같이 승격한다.

```dotenv
ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED=true
ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS=true
ATELIER_SEARCHAD_ALLOW_WRITES=true
ATELIER_SEARCHAD_ALLOW_CREATES=true
ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=true
ATELIER_SEARCHAD_ALLOW_ROLLBACK=true
ATELIER_SEARCHAD_ALLOW_DELETES=true
ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=true
ATELIER_SEARCHAD_ALLOW_RECONCILE=true
ATELIER_SEARCHAD_ACTIVATION_MODE=active
ATELIER_SEARCHAD_AUTOMATION_MODE=auto
```

실제 네이버 계정이 승인하지 않은 API 그룹이나 현재 광고상품에서 지원하지 않는 필드는 코드가 있어도 Capability에 따라 비활성화된다. 이것은 프로그램 기능 제한이 아니라 네이버 원격 권한·상품 조건이다.

## 4. 운영 중에도 유지되는 안전장치

전체 기능 활성화는 무제한·무기록 실행을 뜻하지 않는다.

```text
공식 operationKey allowlist
Customer ID 격리
변경 전 실제 원격값 저장
변경 전 Hash와 실행 직전 원격 Hash 비교
승인 후 1회용 실행 토큰
동일 계획 중복 실행 잠금
실행 후 원격 재조회
예상 변경값 부분집합 검증
타임아웃 시 동일 POST·DELETE 즉시 반복 금지
unknown outcome 재조정
적용 후 다른 변경이 없을 때만 자동 롤백
감사 시도 원장
비밀키·토큰·서명 마스킹
예산·입찰·일일 손실·작업 수 상한
비상 Kill Switch
```

## 5. 표현 규칙

금지 표현:

```text
SearchAd 캠페인·입찰가·예산 쓰기 활성화 금지
SearchAd는 조회 전용
운영계정 쓰기는 구현하지 않음
```

정확한 표현:

```text
SearchAd 공식 쓰기·생성·수정·배치·삭제·롤백·자동화 기능 전체 구현 및 운영 활성화 대상.
최초 실계정 Capability·Canary 검증 전까지만 원격 실행 게이트를 임시 비활성화하고,
검증 통과 후 해당 계정에서 승인된 전체 운영 기능을 활성화한다.
```
