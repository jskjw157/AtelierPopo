# v0.4.0 — Naver Commerce full-operation gateway

## Added

- 공식 `llms.txt` 기준 네이버 커머스API 115개 operation manifest
- 임의 URL이 아닌 `operationId` allowlist gateway
- 상품·주문·클레임·문의·정산·물류·판매자·커머스솔루션 gate
- GET/POST/PUT/PATCH/DELETE 및 308 redirect 처리 강화
- Rate/Quota/Trace ID 응답 메타데이터
- 쓰기 작업 비동기 원장·멱등성
- 고위험 작업 확인 문구와 resource-key 2차 확인
- API 그룹 Capability probe
- 기존 채널상품·원상품 조회
- 기존 상세페이지 `detailContent` 백업·수정·재조회 검증·롤백
- 공식 spec sync 및 coverage 명령
- Commerce OpenAPI Actions
- 개인정보 기본 마스킹

## Verification

- `npm run check`: PASS
- `npm run commerce:coverage`: 115/115 PASS
- `npm test`: 47 passed, 0 failed
- Live Hostinger/Naver account capability probe: deployment secrets required
