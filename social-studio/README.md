# HAAR Social Studio

HAAR 주얼리 브랜드의 내부용 Instagram·Facebook Page 콘텐츠 작성, 검토, 즉시 발행, 예약 발행 및 활동 기록 관리자입니다.

## 현재 구현 범위

- 관리자 단일 계정 로그인과 CSRF 보호
- 상품 및 미디어 라이브러리
- Instagram / Facebook 채널별 게시 변형
- 초안, 즉시 발행, KST 예약 발행
- Meta OAuth state 검증, Facebook Page 선택, 연결된 Instagram 프로페셔널 계정 확인
- 서버 측 토큰 AES-256-GCM 암호화
- 만료되는 HMAC 서명 미디어 URL
- Instagram 이미지, 이미지 캐러셀, Reel 컨테이너 발행 흐름
- Facebook Page 텍스트/링크, 단일 사진, 다중 사진, 영상 발행 흐름
- 중복 발행 방지용 idempotency key와 DB 원자적 선점
- 제한된 일시 오류 재시도와 스케줄러 실행 기록
- 실제 API 응답 기반의 지원 가능한 성과 동기화
- 개인정보, 이용 안내, 데이터 삭제 콜백/상태 페이지
- TikTok과 X는 2차 연동용 비활성 카드와 공통 어댑터 확장 방향만 제공

성공 연결, 성공 게시, 팔로워 수, 성과 수치는 실제 외부 API 응답 없이 생성하지 않습니다.

## 구성

```text
social-studio/
├─ server/                 Express API, DB, OAuth, publishing
├─ src/                    React 관리자 UI
├─ docs/                   Meta/Hostinger 설정 문서
├─ Dockerfile
├─ docker-compose.yml
└─ .env.example
```

## 로컬 실행

필수 조건: Node.js 20.19 이상, PostgreSQL 15 이상, ffprobe 사용 가능 환경.

```bash
cp .env.example .env
npm install
npm run hash-password -- "관리자-비밀번호"
# 출력 해시를 .env의 ADMIN_PASSWORD_HASH에 입력
npm run dev
```

- 관리자 UI: `http://localhost:5173`
- API: `http://localhost:3000`

프로덕션 단일 프로세스 실행:

```bash
npm run build
npm start
```

서버는 시작 시 idempotent SQL 스키마를 적용하고 관리자 계정 및 HAAR 기본 프로필을 생성합니다.

## 필수 보안 환경 변수

- `APP_BASE_URL`: 실제 공개 HTTPS origin
- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`: 최소 32자 권장
- `TOKEN_ENCRYPTION_KEY`: 64자리 hex 또는 32바이트 base64
- `MEDIA_SIGNING_SECRET`: 최소 32자 권장
- `CRON_SECRET`: 예약 실행 API용 장기 무작위 값

Meta 설정은 `.env.example`과 [Meta 연동 문서](docs/META_SETUP_KO.md)를 참고합니다.

## 예약 발행

외부 스케줄러가 아래 API를 호출합니다.

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<도메인>/api/jobs/run-due
```

동일 게시물은 DB에서 원자적으로 `publishing` 상태로 선점되고, 외부 게시물 ID가 저장된 이후에는 다시 발행하지 않습니다. Meta가 일시 오류로 표시한 요청만 최대 3회 제한적으로 재시도합니다.

## 데이터와 파일

- PostgreSQL: 상품, 캠페인, 게시 변형, 연결 메타데이터, 암호화 토큰, 활동 기록
- `UPLOAD_DIR`: 비공개 업로드 원본/정규화 파일
- 외부 플랫폼이 파일을 가져갈 때만 HMAC 서명과 만료 시간이 포함된 `/public-media/:id` URL 생성

## 검증 명령

```bash
npm test
npm run build
find server -name '*.js' -print0 | xargs -0 -n1 node --check
```

현재 실행 환경에 npm registry 네트워크가 없으면 의존성 설치/번들 빌드는 배포 서버 또는 CI에서 수행해야 합니다. 소스 JavaScript 구문 검사는 별도로 실행할 수 있습니다.

## 운영 문서

- [Meta 개발자 연동](docs/META_SETUP_KO.md)
- [Hostinger VPS 배포](docs/HOSTINGER_DEPLOY_KO.md)

## Meta 광고 관리

`/ads`에서 광고계정 연결, 성과 조회, 상품 링크 포함 초안, 승인된 상태/예산 변경을 관리합니다. 집행 기능은 `META_ADS_WRITES_ENABLED=false`가 기본이며, 별도 광고 OAuth와 활성 owner 역할이 필요합니다. 운영 경계·제한·MCP 인증·검증 절차는 [META_ADS_PHASE1.md](docs/META_ADS_PHASE1.md)를 확인하세요.
