# 네이버 검색광고 개발 기준 문서

현재 구현 기준은 다음 문서다.

- [`NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2_1.md`](./NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2_1.md)
- [`MULTI_SOURCE_PRODUCT_ARCHITECTURE.md`](./MULTI_SOURCE_PRODUCT_ARCHITECTURE.md) — S4 상품·광고 연결의 최우선 기준

이전 문서:

- `NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2.md` — v2.1 이전 초안
- `NAVER_SEARCHAD_FULL_INTEGRATION_DESIGN_V1_1.md` — 정책·아키텍처 초안

충돌 시:

1. SearchAd 공통 API·보고서·자동화는 v2.1을 우선한다.
2. 상품 원천·PIM·채널·광고 매핑은 `MULTI_SOURCE_PRODUCT_ARCHITECTURE.md`를 우선한다.
3. 퀸실버 전용으로 읽히는 표현은 다중 공급처·다중 상품소스 모델로 대체한다.

현재 상태:

```text
설계·구현 계약서: 완료
P0/P1 리뷰 반영: 완료
SearchAd S0·S0.5·S1: 구현 완료
SearchAd S2: 코드 완료, 실계정 검증 대기
SearchAd S3: 보고서 파이프라인 개발 진행
S4 기준: 퀸실버 전용 가정 폐기, HAAR 다중 소스 모델 확정
실제 광고계정 변경: 없음
```
