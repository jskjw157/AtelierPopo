# HTTP API 운영 명세

## 목적

Hostinger에 배포된 `smartstore-bridge`를 외부 자동화 도구나 GPT Action에서 호출하기 위한 API입니다. 임의 파일 경로나 쉘 명령은 노출하지 않고 퀸실버 상품번호만 입력받습니다.

## 인증

공개 경로:

```text
GET /health
GET /health/ready
GET /openapi.json
```

그 외 경로:

```http
Authorization: Bearer <ATELIER_API_KEY>
```

`ATELIER_API_KEY`는 최소 32자 이상의 랜덤 문자열을 권장합니다. 키 교체 기간에는 `ATELIER_API_KEYS=old-key,new-key`로 복수 키를 사용할 수 있습니다.

## 상태 코드

- `200`: 정상 또는 완료된 기존 멱등 작업 반환
- `202`: 비동기 등록 작업 접수
- `400`: 요청값·확인 문구·멱등성 키 오류
- `401`: API 키 오류
- `403`: 원격 쓰기 잠금
- `404`: 상품·작업·경로 없음
- `409`: 멱등성 키가 다른 작업에 재사용됨
- `413`: 요청 본문 제한 초과
- `422`: 상품이 등록 가능한 상태가 아님
- `429`: 호출량 제한
- `502`: 네이버 커머스API 오류
- `503`: API 키 또는 핵심 설정 미완성

오류 응답:

```json
{
  "ok": false,
  "error": {
    "code": "HTTP_WRITES_DISABLED",
    "message": "...",
    "requestId": "..."
  }
}
```

## 비동기 등록

`POST /api/v1/products/{productId}/register`는 이미지 변환과 네이버 업로드 시간을 고려해 작업을 큐에 넣고 즉시 반환합니다.

```json
{
  "confirmation": "REGISTER",
  "idempotencyKey": "register-1905-20260820-001"
}
```

응답:

```json
{
  "ok": true,
  "reused": false,
  "operation": {
    "operationId": "...",
    "operationType": "register_product",
    "sourceProductId": "1905",
    "status": "queued"
  },
  "poll": "/api/v1/operations/..."
}
```

작업 상태는 `queued → running → succeeded|failed`로 바뀝니다. 서버 재시작 전에 실행 중이던 작업은 `interrupted`로 표시하며 자동 재등록하지 않습니다.

## 쓰기 잠금

단일 상품 등록:

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
```

배치 등록:

```dotenv
NAVER_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_WRITES=true
ATELIER_HTTP_ALLOW_BATCH_WRITES=true
```

요청 본문의 `confirmation`도 설정 파일의 `writeConfirmation`과 정확히 같아야 합니다.

## GPT Action

배포 후 다음 주소를 GPT Action의 OpenAPI URL로 사용할 수 있습니다.

```text
https://YOUR_DOMAIN/openapi.json
```

Action 인증에는 네이버 시크릿이 아니라 `ATELIER_API_KEY`만 사용합니다. 네이버 ID와 시크릿은 Hostinger 환경변수에만 저장합니다.
