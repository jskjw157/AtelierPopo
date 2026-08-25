# Naver SearchAd Spec Correction Registry

공식 Swagger 원본은 수정하지 않는다. 원본과 실제 공개 계약·공식 공지·공식 샘플 사이의 차이는 이 디렉터리의 명시적 보정 파일로 관리한다.

## 파일

```text
path-overrides.yaml
parameter-overrides.yaml
operation-lifecycle.yaml
tag-visibility.yaml
report-schema-overrides.yaml
```

## 필수 필드

```yaml
id:
sourceFile:
rawOperationId:
rawMethod:
rawPath:
normalizedMethod:
normalizedPath:
reason:
officialEvidence:
effectiveFrom:
effectiveTo:
reviewedAt:
reviewedBy:
status:
```

## 규칙

1. Swagger 원본 checksum을 보존한다.
2. 보정은 코드 내부에 하드코딩하지 않는다.
3. 모든 보정은 공식 근거 URL 또는 실제 Capability 증거를 가진다.
4. 보정 적용 전·후 operation diff를 생성한다.
5. 근거가 사라지거나 공식 스펙이 수정되면 `status: retired`로 종료한다.
6. `internal_quarantined` operation은 Runtime allowlist에 넣지 않는다.
7. 정식 구현 기준은 `docs/NAVER_SEARCHAD_FULL_IMPLEMENTATION_PLAN_V2_1.md`다.
