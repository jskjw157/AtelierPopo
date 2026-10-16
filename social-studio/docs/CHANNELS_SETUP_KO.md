# Threads · TikTok · X 개발 범위와 연결 준비

공식 문서 확인일: 2026-10-16 UTC. 이 브랜치는 배포·앱 등록·실계정 OAuth·실제 업로드·결제를 수행하지 않는다. 기존 Instagram/Facebook 앱·권한·토큰·테이블은 변경하지 않는다.

## 지원과 미검증 범위

| 채널 | 이번 구현 | 공개 자동게시 및 조건 |
|---|---|---|
| Threads | 별도 OAuth, 서버 토큰 갱신, 텍스트/이미지/이미지 캐러셀/영상, 1회 예약, 컨테이너 상태 확인 및 최종 게시 | 앱 역할/테스터 범위 밖 연결에는 Meta App Review/필요한 접근 등급을 확인해야 한다. 기존 Facebook 앱 설정만으로 연결되지 않는다. 실제 계정·게시 미검증 |
| X | OAuth 2.0 S256 PKCE, 갱신 토큰 회전, 표준 텍스트/최대 4이미지, 1회 예약 | 개발자 앱의 Web App(서버 기밀 클라이언트), 사용자 OAuth와 크레딧·과금 승인이 필요. 영상/GIF/장문/인용 게시 미지원. 실제 API 미호출 |
| TikTok | Login Kit OAuth, 토큰 회전, 검증된 미디어 origin의 영상 1개를 받은 편지함으로 업로드, 상태 확인, 1회 업로드 예약 | **사용자가 TikTok에서 검토하고 최종 게시해야 한다. 공개 자동게시가 아니다.** 현재 HAAR 내부 전용 도구는 Direct Post 허용 용도에 부합하지 않아 구현에 video.publish나 Direct Post 활성화 우회 설정을 넣지 않았다. 실제 계정·업로드 미검증 |

TikTok Direct Post 공식 지침은 본인/팀이 관리하는 계정의 업로드 도구를 허용하지 않는다. 단순 앱 심사 대기나 비공개 테스트 모드만으로 해결되는 문제가 아니다. 공개 자동게시를 원하면 넓은 사용자층을 위한 제품 목적, 창작자 UX, 상업 콘텐츠 표시, 공개범위·상호작용 선택, 음악 사용 동의 등의 설계를 별도 검토해야 한다. 심사 전 Direct Post는 SELF_ONLY 및 사용자 수 제한도 적용되지만, 이번 구현에서는 이를 사용하지 않는다. [공식 Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)

## 사용자가 나중에 직접 처리할 최소 단계

### Threads

1. [Meta 개발자 앱](https://developers.facebook.com/apps/)에서 Threads 사용 사례를 준비하고 **Threads 전용 App ID/secret**을 확인한다. Facebook/Instagram용 일반 App ID/secret과 다르다. Threads 프로필을 가진 사용자와 앱 테스트 역할을 준비한다. 다른 사용자에게 제공할 경우 App Review와 접근 권한 요건을 콘솔에서 확인한다.
2. 승인된 배포 환경에 정확한 콜백 `https://social.haarapp.tech/api/channels/threads/callback`을 등록한다. staging이면 APP_BASE_URL에 맞는 별도 HTTPS 콜백을 등록한다.
3. 요청 권한은 `threads_basic`, `threads_content_publish` 두 개다. 댓글·분석·메시지 권한은 요청하지 않는다. 이후 서버 운영자가 비밀값을 안전하게 설정하고 연결 스위치만 활성화한 뒤 사용자가 공식 OAuth 화면에서 승인한다.
4. API 호출별 요금은 확인한 Threads 공식 공개 문서에 명시되어 있지 않았다. 무료라고 보장하지 않으며 실제 앱 콘솔/약관에서 최종 확인한다. [시작 가이드](https://developers.facebook.com/documentation/threads/get-started), [Meta 공식 샘플](https://github.com/fbsamples/threads_api), [게시 문서](https://developers.facebook.com/documentation/threads/posts)

### TikTok

1. [TikTok for Developers](https://developers.tiktok.com/) 앱에서 Login Kit와 Content Posting API의 **Upload** 사용 사례와 승인 가능한 제품 목적을 검토한다. 대상 사용자는 TikTok 공식 OAuth 사용 자격이 있는 계정이어야 한다. Instagram 프로페셔널 계정 연결을 재사용하지 않는다.
2. `https://social.haarapp.tech/api/channels/tiktok/callback`을 등록하고 `user.info.basic`, `video.upload` scope의 앱 승인·사용자 승인을 준비한다. scope가 승인됐다는 증거 없이 실제 전송을 켜지 않는다.
3. 개발자 콘솔 Manage URL properties에서 영상 제공 origin(기본 계획 `https://social.haarapp.tech`)의 소유권을 검증한다. `TIKTOK_VERIFIED_MEDIA_ORIGIN`은 검증한 정확한 HTTPS origin과 일치해야 한다. 서버에 이미 저장된 영상은 PULL_FROM_URL로 전달한다.
4. 사용자는 영상 수신 후 TikTok 알림에서 편집과 최종 게시를 완료한다. `awaiting_user`는 게시 성공 수치가 아니다. 사진/Direct Post는 이번 범위에 없다. API 호출별 요금은 확인한 공식 문서에 명시되어 있지 않아 콘솔/약관에서 확인해야 한다. [Upload 가이드](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content), [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web), [토큰 관리](https://developers.tiktok.com/docs/en/oauth-user-access-token-management)

### X

1. [X Developer Console](https://console.x.com/)에서 개발자 계정/앱을 준비하고 OAuth 2.0 Web App 기밀 클라이언트와 Read/Write 접근을 설정한다. 콜백은 `https://social.haarapp.tech/api/channels/x/callback`이다.
2. 권한은 `tweet.read`, `tweet.write`, `users.read`, `offline.access`, `media.write`. 사용자 계정의 OAuth가 필요하며 app-only Bearer로 게시하지 않는다. [공식 OAuth 문서](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
3. X는 현재 구독제가 아닌 **선불 크레딧 기반 사용량 과금**이다. 확인일 공개 단가: 일반 Post 생성 $0.015/요청, URL 포함 $0.200/요청, User read $0.010/리소스. 미디어/추가 호출 비용과 최종 단가는 콘솔에서 확인해야 한다. 자동충전은 설정하지 않는다. 결제·크레딧 구매·비용 상한을 사용자가 별도 승인하기 전에는 `X_BILLING_APPROVED=false`로 유지한다. 읽기 API도 비용이 발생할 수 있다. [공식 요금](https://docs.x.com/x-api/getting-started/pricing)
4. 표준 280 가중자 제한을 보수적으로 적용한다. 이미지 파일은 각 5MB 이하, 최대 4개다. 영상·GIF·장문·인용 게시 등은 거절한다. [게시 API](https://docs.x.com/x-api/posts/create-post), [이미지 업로드 API](https://docs.x.com/x-api/media/upload-media)

## 서버 설정: 승인 전 모두 비활성

`.env.example`의 새 변수는 값 예시용이다. 비밀값은 소스·PR·로그·브라우저에 입력하지 않는다. 실제 환경에는 이 브랜치에서 설정하지 않았다.

- 공통 기존 APP_BASE_URL(HTTPS), TOKEN_ENCRYPTION_KEY, MEDIA_SIGNING_SECRET, DB, 관리자 인증을 사용한다.
- `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET`, `THREADS_CONNECT_ENABLED=false`, `THREADS_WRITES_ENABLED=false`.
- `TIKTOK_CLIENT_ID`(TikTok client_key), `TIKTOK_CLIENT_SECRET`, `TIKTOK_CONNECT_ENABLED=false`, `TIKTOK_WRITES_ENABLED=false`, `TIKTOK_VERIFIED_MEDIA_ORIGIN`.
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_CONNECT_ENABLED=false`, `X_WRITES_ENABLED=false`, `X_BILLING_APPROVED=false`.
- 연결 스위치는 앱 등록·권한 확인 후 사용자 OAuth 시작만 허용한다. 전송 스위치는 별도 운영 업로드/게시 승인 후에만 활성화한다. X 과금 승인 스위치는 연결 시 유료 사용자 조회에도 적용된다.

이 브랜치를 안전하게 검증하려면 먼저 별도 staging DB에 추가 마이그레이션을 적용하고, 운영 키 없이 모의 어댑터로 검증한다. `channel_connections`, `channel_oauth_states`, `channel_posts`, `channel_attempts`를 추가하며 기존 테이블은 ALTER하지 않는다. 애플리케이션 시작 시 DB 마이그레이션이 실행되므로 **운영에서 새 앱을 시작하는 것은 별도 배포 승인 대상**이다. 이전 이미지로 되돌려도 추가 테이블은 남겨두며 데이터를 자동 삭제하지 않는다.

## 전송·중복·장애 처리

`/channels`와 계정 연동 카드에서 현재 계정·권한·전송 잠금을 보여 준다. 사용자가 연결 버튼과 별도 확인을 눌러야 OAuth를 시작하며 화면 진입만으로 인증하지 않는다. 콜백은 활성 owner 세션, 플랫폼, 10분 만료 단일 사용 state에 묶인다. X verifier와 모든 토큰은 서버에서 암호화한다. 원시 공급자 오류는 표시하지 않는다.

새 게시물은 불변 요청이다. clientRequestId+payload hash가 같은 재요청은 저장 결과만 반환하고 다른 내용의 ID 재사용은 409다. 화면에서 내용을 수정하면 새 ID와 새 확인 동의가 필요하다. DB advisory lock으로 연결 변경·토큰 회전·전송·상태 확인을 직렬화한다. 재연결된 계정에 과거 예약을 자동 전송하지 않으며 해제 시 미전송 예약을 취소한다.

X/TikTok access token이 만료돼도 저장된 갱신 권한이 있으면 `refresh_available`로 표시하고 전송 직전에 갱신한다. 이는 실시간 권한 유효성 보장이 아니며 철회·갱신 실패 시 재연결이 필요하다. Threads access token이 이미 만료되면 재인증이 필요하다. 예약 시각이 지난 동일 불변 요청도 재확인할 수 있다.

기존 cron의 run-due가 원래 Meta 큐를 처리한 뒤 새 큐를 처리한다. `*_WRITES_ENABLED=false`인 큐는 외부에 접근하지 않는다. 플랫폼 처리 중이면 다음 cron/사용자 상태 확인으로 이어간다. Threads는 자식 이미지 준비 → 캐러셀 컨테이너 준비 → 게시 요청 순서의 checkpoint를 저장한다. 원격 쓰기 직전에 시작/게시요청 의도를 저장하며, 응답 유실·중간 종료는 `uncertain`으로 잠그고 자동 재전송하지 않는다. 이 정책은 중복 방지를 우선하여 일부 중간 실패의 수동 조사가 필요할 수 있다. 1회 예약만 지원하며 반복·대량 발행 기능은 없다.

이미 저장된 컨테이너/업로드 상태를 읽는 단계의 timeout·429·5xx는 `processing`을 유지하고 다음 상태 조회에서 재시도한다. 부모 컨테이너 생성이나 최종 게시 요청 의도가 기록된 이후의 불확실한 응답은 재시도하지 않는다. 게시 결과를 이미 DB에 저장했다면 이후 audit 기록 오류로 성공 상태를 덮어쓰지 않는다.

## assistant / MCP 연결 경로

현재 새 SNS 모듈과 assistant 사이의 직접 MCP 연결은 없다. 이번 PR은 신규 MCP 툴을 노출하지 않는다. 기존 광고 MCP도 변경하지 않는다.

향후 연결 시에는 서버에 고정한 active owner와 좁은 credential을 가진 인증 transport를 두고 다음 순서로 확장한다.

1. 읽기 전용 `channel_status`, `channel_posts`, `channel_attempts`를 마스킹된 응답으로 제공한다. 토큰·OAuth 코드·서명 미디어 URL을 툴 결과에 넣지 않는다.
2. 쓰기 툴은 현재 HTTP API를 그대로 무조건 노출하지 않는다. 초안 생성과 내용/계정 generation/예약 시각을 포함한 hash 승인 레코드를 분리하고 사용자가 승인한 불변 요청만 실행한다.
3. OAuth 승인은 사용자가 브라우저에서 직접 수행한다. 툴이 대신 승인하거나 토큰을 요구하지 않는다. 과금·운영 게시·반복 발행의 승인 경계도 유지한다.

## 검증

테스트는 실제 provider 함수를 주입된 모의 HTTP로 실행하며 실계정·토큰이 필요 없다. DB 테스트는 localhost의 `_test`로 끝나는 별도 DB만 허용한다. CI도 일회용 PostgreSQL을 사용하며 배포 workflow를 변경하거나 실행하지 않는다. 검증 명령:

```sh
TEST_DATABASE_URL=postgres://<local-test-user>@127.0.0.1:<test-port>/haar_channels_test npm test
npm run check:syntax
npm run build
python3 -m unittest discover -s test -p 'test_*.py' -v
```

모의 테스트 통과는 앱 심사·계정 연결·실제 게시 성공을 뜻하지 않는다. 실제 플랫폼 테스트는 별도 승인과 승인된 앱 조건을 충족한 뒤에만 가능하다.
