# 네이버 검색광고 설계 리뷰 조치 결과 v2.1

> 기준 문서: `NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2_1.md`  
> 작성일: 2026-08-25  
> 상태: P0/P1 반영 완료

## 요약

기존 v2.0의 전체 기능 목표는 유지하고, 공개 API 분류·스펙 보정·운영 저장소·Customer 격리·Validator·자동화 안전장치를 보완했다.

| 번호 | 리뷰 지적 | 조치 | 결과 파일 |
|---:|---|---|---|
| 1 | Raw Swagger와 공개 API 혼동 | Raw/Public/Sample/Release/Capability/Internal/Deprecated 분리 | v2.1 3장, `tag-visibility.yaml` |
| 2 | Swagger 오류·비표준 경로 | 명시적 correction registry | `corrections/*` |
| 3 | Tool API 누락 | Analytics/Documents/IP Exclusions/Bill Recipient 추가 | v2.1 5.13 |
| 4 | ManagedKeyword 공개 약속 | 초기 격리 | `operation-lifecycle.yaml` |
| 5 | 영구 삭제 표현 | 원격 삭제 처리로 변경 | v2.1 6장 |
| 6 | 기본 env가 auto | 최초 observe/read-only, 검증 후 승격 | v2.1 21장 |
| 7 | PostgreSQL 전환 불명확 | v0.5~v0.7 migration 계약 | v2.1 9장 |
| 8 | 보고서 원본 저장 위치 | ReportBlobStorage 및 보존정책 | v2.1 10장 |
| 9 | 광고계정 격리 | 모든 엔티티·작업에 customer_id 복합키 | v2.1 8장 |
| 10 | 광고상품 Validator 부족 | Validator Matrix | v2.1 7장, `validator-matrix.seed.yaml` |
| 11 | 이미지 확장소재 규칙 누락 | MIME·5MB·214×214·개수·Data URI | `parameter-overrides.yaml` |
| 12 | Deprecated Seed 없음 | NAVERPAY_CONVERSION 종료 Seed | `operation-lifecycle.yaml` |
| 13 | 검수 이력 제한 누락 | 90일·100개·빈 객체 규칙 | `parameter-overrides.yaml` |
| 14 | finalized 오해 | provisional/stabilized_by_policy 등으로 변경 | `report-schema-overrides.yaml` |
| 15 | Circuit Breaker 부족 | cooldown·손실·실패·unknown 상한 | v2.1 16장 |
| 16 | Canary 이름 기반 정리 위험 | canary_run_id와 반환 remote ID만 사용 | v2.1 17장 |
| 17 | GPT 승인 재사용 위험 | 10분·1회용 execution token | v2.1 14장 |
| 18 | 5분 전체 동기화 | Delta·editTm·checkpoint·jitter | v2.1 18장 |

## 공식 근거 Seed

### SearchAd 공식 Swagger 번들

```text
ncc-heroes-ncc.json
ncc-heroes-tool.json
ncc-heroes-billing.json
atower.json
ncc-report.json
master-report.json
ncc-keywordstool.json
estimate.json
ncc-inspect-history.json
```

### NAVERPAY_CONVERSION 종료

- 2025-04-09 업데이트 중단
- 2025-04-08 이후 데이터 없음
- 2025-05-09 과거 조회 포함 종료

공식 공지:

`https://naver.github.io/searchad-apidoc/notice/2025/04/02/notice1/`

### 이미지 확장소재

- JPEG/PNG
- 최대 5MB
- 214×214
- POWER_LINK_IMAGE 최대 1개
- IMAGE_SUB_LINKS 최대 3개

공식 릴리스:

`https://naver.github.io/searchad-apidoc/release/2025/06/25/release-note/`

### 검수 이력

- 최근 3개월
- 다건 최대 100개
- 사유 없음 또는 없는 ID는 빈 객체

공식 릴리스:

`https://naver.github.io/searchad-apidoc/release/2025/12/03/release-note/`

### 쇼핑검색 전환목표 자동입찰

- 쇼핑검색광고
- 쇼핑몰 상품형 광고그룹
- 전환 로그 수집
- `autobidStrategy`

공식 릴리스:

`https://naver.github.io/searchad-apidoc/release/2025/10/15/release-note/`

### AI Ads 마스터 필드

Adgroup Master에 2026-07-16부터 `Using Ai Ads`가 추가된다. 이는 조회 스키마 근거이며 쓰기 API 공개 근거로 확대 해석하지 않는다.

공식 공지:

`https://naver.github.io/searchad-apidoc/notice/2026/06/16/notice1/`

## 개발 시작 조건

다음 파일을 실제 코드가 읽어야 Phase S0 완료로 인정한다.

```text
specs/naver-searchad/corrections/path-overrides.yaml
specs/naver-searchad/corrections/parameter-overrides.yaml
specs/naver-searchad/corrections/operation-lifecycle.yaml
specs/naver-searchad/corrections/tag-visibility.yaml
specs/naver-searchad/corrections/report-schema-overrides.yaml
specs/naver-searchad/validator-matrix.seed.yaml
```

완료 검사:

```text
raw operation count > 0
public/internal/deprecated 분류 완료
unclassified = 0
correction 적용 diff 생성
runtime allowlist에 internal/deprecated 없음
```
