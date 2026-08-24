# HAAR Google Drive 전체 쓰기 통합 계획

> 문서 버전: 1.0  
> 작성 기준일: 2026-08-24  
> 대상 저장소: `jskjw157/AtelierPopo`  
> 대상 애플리케이션: `smartstore-bridge`  
> 상태: OWNER APPROVED — HAAR Drive 루트 내 전체 쓰기 활성화

---

## 0. 결정

Hostinger에서 실행되는 `smartstore-bridge`가 Google Drive를 읽기 전용 카탈로그로만 사용하지 않고, HAAR 프로젝트 범위 안에서 생성·업로드·수정·이동·복사·삭제·복원·공유까지 수행할 수 있게 확장한다.

전체 Google 계정 루트가 아니라 다음 HAAR 전용 루트를 쓰기 경계로 사용한다.

```text
HAAR 상세페이지
Folder ID: 1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
```

이 루트의 현재·미래 하위 폴더에 쓰기 권한을 상속시키는 방식으로 운영한다.

주요 하위 폴더:

```text
퀸실버_전체상품_20260811
Folder ID: 1OxlupopKo8BR-8_fDE72LEknRbWIoGoS

최종상세페이지
Folder ID: 1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y
```

서비스 계정:

```text
haar-drive-catalog-reader@haar-store-gws-6f3c9a.iam.gserviceaccount.com
```

서비스 계정 이름에 `reader`가 남아 있어도 권한 역할은 `writer`로 변경할 수 있다. 추후 명확성을 위해 별도 `haar-drive-operator` 서비스 계정으로 교체할 수 있지만 필수는 아니다.

---

## 1. 실제 Google Drive 공유 권한 변경

서비스 계정을 `HAAR 상세페이지` 루트 폴더의 **편집자(writer)** 로 추가한다.

```text
대상 폴더: HAAR 상세페이지
ID: 1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
권한 대상: haar-drive-catalog-reader@haar-store-gws-6f3c9a.iam.gserviceaccount.com
역할: 편집자 / writer
```

이렇게 하면 다음이 상속된다.

- 퀸실버 원본 카탈로그 읽기·쓰기
- 최종상세페이지 결과물 생성·업로드·수정
- 새 상품별 작업 폴더 생성
- 향후 추가되는 HAAR 하위 폴더 접근

기존 `퀸실버_전체상품_20260811`에 직접 부여된 `reader` 권한은 루트의 상속 `writer`가 적용된 뒤 제거하거나 그대로 둘 수 있다. 혼동을 줄이기 위해 직접 `reader` 권한은 제거하는 편이 권장된다.

---

## 2. Google API OAuth Scope

Hostinger 서비스 계정 인증에서 읽기 전용 Scope를 사용하지 않는다.

```text
https://www.googleapis.com/auth/drive
```

금지되는 읽기 전용 Scope:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.metadata.readonly
```

애플리케이션은 서비스 계정이 실제로 공유받은 HAAR 루트 안에서만 동작한다. Full Drive Scope를 사용해도 공유되지 않은 사용자 개인 파일을 자동으로 볼 수 있는 것은 아니다.

---

## 3. Hostinger 환경변수

```dotenv
ATELIER_DRIVE_PROVIDER=google-drive
GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=

GOOGLE_DRIVE_ROOT_FOLDER_ID=1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
GOOGLE_DRIVE_CATALOG_FOLDER_ID=1OxlupopKo8BR-8_fDE72LEknRbWIoGoS
GOOGLE_DRIVE_FINAL_DETAIL_FOLDER_ID=1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y

ATELIER_DRIVE_ALLOW_WRITES=true
ATELIER_DRIVE_ALLOW_MOVES=true
ATELIER_DRIVE_ALLOW_TRASH=true
ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=true
ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=true

ATELIER_DRIVE_MAX_UPLOAD_BYTES=1073741824
ATELIER_DRIVE_CACHE_DIR=/tmp/atelier-drive-cache
ATELIER_DRIVE_CACHE_TTL_SECONDS=3600
```

서비스 계정 JSON 원문과 Base64 값은 GitHub, 채팅, 로그에 출력하지 않는다.

---

## 4. 구현할 Drive 기능

### 4.1 조회

- 내 서비스 계정 상태
- 루트 접근 상태
- 파일·폴더 검색
- 폴더 목록
- 파일 메타데이터
- 권한 목록
- 버전·수정시각
- 파일 다운로드
- Google Docs/Sheets/Slides export

### 4.2 생성·업로드

- 폴더 생성
- 단일·다중 파일 업로드
- 재개 가능한 대용량 업로드
- Google Docs/Sheets/Slides 생성
- 상세페이지 최종 패키지 업로드
- 상품별 작업 폴더 생성

### 4.3 수정

- 파일 내용 교체
- 이름 변경
- 폴더 이동
- 부모 폴더 추가·제거
- 메타데이터 수정
- 기존 최종본 새 버전 저장
- Google Docs/Sheets/Slides 내용 편집

### 4.4 복사·버전

- 파일 복사
- 폴더 구조 복제
- 작업 전 백업
- 버전 번호 자동 증가
- 체크섬 비교
- 동일 파일 중복 방지

### 4.5 삭제·복원

- 휴지통 이동
- 휴지통 복원
- 영구 삭제
- 작업 전 삭제 영향 미리보기
- 삭제 감사 로그

기본 자동 삭제는 휴지통 이동을 사용한다. 영구 삭제는 별도 확인 문구를 요구한다.

### 4.6 권한 관리

Google API와 계정 정책이 허용하는 범위에서:

- reader / commenter / writer 공유
- 공유 대상 조회
- 잘못된 공유 제거
- 서비스 계정 권한 상태 검증

소유권 이전은 일반 운영 기능으로 노출하지 않는다.

---

## 5. HTTP API

### 5.1 Reader

```http
GET /api/v1/drive/status
GET /api/v1/drive/files
GET /api/v1/drive/files/{fileId}
GET /api/v1/drive/folders/{folderId}/children
GET /api/v1/drive/files/{fileId}/permissions
POST /api/v1/drive/files/{fileId}/download
```

### 5.2 Writer

```http
POST /api/v1/drive/folders
POST /api/v1/drive/files/upload
POST /api/v1/drive/files/{fileId}/replace
POST /api/v1/drive/files/{fileId}/rename
POST /api/v1/drive/files/{fileId}/move
POST /api/v1/drive/files/{fileId}/copy
POST /api/v1/drive/files/{fileId}/trash
POST /api/v1/drive/files/{fileId}/restore
POST /api/v1/drive/files/{fileId}/permissions
DELETE /api/v1/drive/files/{fileId}/permissions/{permissionId}
```

### 5.3 Admin

```http
DELETE /api/v1/drive/files/{fileId}
POST /api/v1/drive/sync/catalog
POST /api/v1/drive/verify-tree
POST /api/v1/drive/cleanup-cache
```

임의 Google Drive API URL을 받는 raw proxy는 만들지 않는다.

---

## 6. 경로 경계

모든 작업 전에 대상이 다음 루트의 하위인지 검증한다.

```text
1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD
```

검증 항목:

- 대상 파일의 ancestor chain
- 이동 전·후 부모 폴더
- 복사 목적지
- 삭제 대상
- 권한 변경 대상

HAAR 루트 밖의 파일은 기본 거부한다.

```text
DRIVE_PATH_OUTSIDE_ALLOWED_ROOT
```

관리자가 별도 Allowlist를 추가한 경우에만 다른 루트를 사용할 수 있다.

---

## 7. 상세페이지 작업 흐름

```text
퀸실버 원본 폴더 조회
→ 필요한 product_info.json·이미지 다운로드
→ 상세페이지 제작
→ 최종상세페이지 아래 새 버전 폴더 생성
→ PNG/JPG/ZIP/HTML/QUALITY_REPORT 업로드
→ 파일 수·크기·체크섬 검증
→ 스마트스토어 detailContent 수정
→ Drive 결과 링크와 네이버 작업 로그 연결
```

최종 폴더는 다음 고정 루트의 직접 하위에 생성한다.

```text
최종상세페이지
ID: 1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y
```

---

## 8. 원본 수정 정책

사용자 결정에 따라 원본 폴더에도 쓰기가 가능하다.

다만 프로그램이 원본 이미지를 임의로 덮어쓰지 않도록 작업 유형을 구분한다.

```text
source_write
- 사용자가 명시한 원본 교체·추가·정리

working_write
- 작업 산출물·임시 메타데이터

final_write
- 승인된 최종 결과
```

원본 파일 교체 전:

- 기존 파일 ID·체크섬·크기 저장
- 백업 또는 Drive revision 확인
- 변경 이유 기록
- 변경 후 다시 다운로드해 체크섬 확인

---

## 9. 삭제 안전장치

휴지통 이동:

```json
{
  "confirmation": "TRASH_DRIVE_ITEM",
  "secondConfirmation": "<fileId>"
}
```

영구 삭제:

```json
{
  "confirmation": "PERMANENTLY_DELETE_DRIVE_ITEM",
  "secondConfirmation": "<fileId>"
}
```

폴더 영구 삭제 시 하위 파일 수와 총 용량을 먼저 계산해 표시한다.

---

## 10. 감사 로그

```text
drive_operation_id
actor
source
operation_type
file_id
file_name
old_parent_ids
new_parent_ids
old_checksum
new_checksum
permission_before
permission_after
confirmation
outcome
created_at
verified_at
```

Google 서비스 계정 키와 다운로드 인증 URL은 로그에서 제거한다.

---

## 11. Capability Probe

서비스 시작 시 다음을 확인한다.

1. 서비스 계정 토큰 발급
2. `HAAR 상세페이지` 루트 조회
3. 임시 폴더 생성
4. 임시 텍스트 파일 업로드
5. 이름 변경
6. 하위 폴더 이동
7. 휴지통 이동
8. 복원
9. 임시 파일 영구 삭제
10. 권한 목록 조회
11. 허용되면 임시 공유 추가·제거

Probe는 `__HAAR_DRIVE_CANARY__` 폴더 안에서만 실행하고 완료 후 정리한다.

결과 예시:

```json
{
  "read": true,
  "create": true,
  "upload": true,
  "replace": true,
  "rename": true,
  "move": true,
  "copy": true,
  "trash": true,
  "restore": true,
  "permanentDelete": true,
  "permissionWrite": true,
  "checkedAt": "2026-08-24T00:00:00Z"
}
```

---

## 12. 구현 순서

### Phase D0 — 실제 공유 권한

- `HAAR 상세페이지` 루트에 서비스 계정 writer 추가
- 기존 child reader 정리
- Hostinger Scope를 full Drive로 변경
- 서비스 재배포

### Phase D1 — 공통 Drive 클라이언트

- 인증
- 목록·검색·다운로드
- 폴더 생성·업로드·교체
- rename·move·copy
- trash·restore·delete
- permission adapter

### Phase D2 — GoogleDriveCatalogProvider

- catalog_manifest 캐시
- 상품번호 탐색
- product_info.json 다운로드
- 이미지 선택 다운로드
- 캐시 정리

### Phase D3 — 상세페이지 결과 업로드

- 최종 폴더 버전 생성
- 최종 파일 일괄 업로드
- 업로드 검증
- manifest·quality report 저장

### Phase D4 — 스마트스토어 연결

- Drive 최종 결과를 네이버 상세 HTML로 변환
- 기존 상품 백업
- detailContent 수정
- 네이버 재조회 검증
- Drive·네이버 작업 ID 연결

### Phase D5 — 전체 쓰기 Action

- Reader/Writer/Admin OpenAPI 분리
- ChatGPT Action 연결
- 삭제·권한 변경 확인 절차
- 운영 Runbook

---

## 13. 완료 기준

- [ ] 서비스 계정이 `HAAR 상세페이지` 루트에서 writer다.
- [ ] 현재·신규 하위 폴더에 writer 권한이 상속된다.
- [ ] Hostinger 인증 Scope가 full Drive다.
- [ ] 생성·업로드·교체·rename·move·copy가 동작한다.
- [ ] trash·restore·permanent delete가 동작한다.
- [ ] 권한 조회·변경이 계정 정책 범위에서 동작한다.
- [ ] 루트 밖 작업이 차단된다.
- [ ] GoogleDriveCatalogProvider가 상품 1,515개 카탈로그를 읽는다.
- [ ] 최종상세페이지 폴더에 산출물을 업로드하고 검증한다.
- [ ] 상세페이지 Drive 결과와 네이버 상품 수정 작업이 연결된다.
- [ ] 모든 쓰기 작업에 감사 로그가 남는다.
- [ ] 전체 Drive 쓰기 Kill Switch가 동작한다.

Kill Switch:

```dotenv
ATELIER_DRIVE_ALLOW_WRITES=false
ATELIER_DRIVE_ALLOW_MOVES=false
ATELIER_DRIVE_ALLOW_TRASH=false
ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=false
ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=false
```
