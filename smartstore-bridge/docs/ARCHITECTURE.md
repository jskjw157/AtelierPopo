# 아뜰리에포포 스마트스토어 브리지 아키텍처

## 목표

퀸실버 수집 데이터의 `product_info.json`과 로컬 이미지를 읽어, 검증 가능한 네이버 커머스API 상품 등록 요청으로 변환한다. 같은 핵심 서비스를 CLI와 MCP가 공유한다.

```text
퀸실버 catalog_manifest.json / product_info.json / images
                           │
                           ▼
                 Source Adapter & Validator
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        Pricing / Option Mapper   Image Normalizer
                │                     │
                └──────────┬──────────┘
                           ▼
                    Payload Builder
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       Dry-run           CLI              MCP
          │                │                │
          └────────────────┴────────────────┘
                           ▼
                  Naver Commerce Client
                           │
                           ▼
                  네이버 스마트스토어
```

## 모듈 경계

- `domain/`: 외부 I/O가 없는 가격·옵션·페이로드 변환 규칙
- `naver/`: 인증, 재시도, 상품/이미지 API
- `application/`: 한 상품 등록 파이프라인과 배치 오케스트레이션
- `infrastructure/`: SQLite 원장, 로그
- `cli.js`, `mcp.js`: 얇은 인터페이스

## 멱등성

퀸실버 상품번호를 `QUEEN-<product_id>` 형태의 `sellerManagementCode`로 사용한다. 등록 전 상품 검색 API로 같은 코드를 조회하고, 존재하면 신규 등록을 중단한다. 로컬 SQLite 원장에도 상태와 응답 번호를 저장한다.

## 안전장치

1. 모든 작업은 기본적으로 dry-run이다.
2. 실제 쓰기는 `NAVER_ALLOW_WRITES=true`와 확인문구 `REGISTER`를 동시에 요구한다.
3. 품절 소스는 기본적으로 건너뛴다. `includeSoldOut=true`일 때만 재고 0의 품절 상품으로 등록한다.
4. 카테고리 ID와 스토어 고유 배송/반품/A/S/상품고시 템플릿이 채워지지 않으면 실행을 차단한다.
5. MCP는 배치 등록 도구를 노출하지 않고 1개 상품 등록만 노출한다.
6. 시크릿과 액세스 토큰을 로그/응답에 출력하지 않는다.

## 이미지 처리

- WebP를 포함한 소스 이미지를 네이버가 허용하는 JPEG로 변환한다.
- 대표 이미지는 흰 배경 1000×1000 정사각형으로 정규화한다.
- 상세 이미지는 최대 폭 860px로 정규화한다.
- API 한 번당 최대 10개, 설정상 총 9.5MB 이하가 되도록 배치를 분할한다.
- 상품 등록 페이로드에는 이미지 업로드 API가 반환한 URL만 넣는다.

## 확장 순서

1. 단일 상품 dry-run 및 등록
2. 20개 단위 배치 등록/실패 재시도
3. 가격·재고 일괄 수정
4. 주문 수집/발주/송장 처리
5. 관리자 웹 UI
