# Meta 개발자 연동 설정

## 1. 사전 조건

- Instagram 계정은 **Business 또는 Creator 프로페셔널 계정**이어야 합니다.
- Instagram 계정은 운영할 **Facebook Page에 연결**되어 있어야 합니다.
- OAuth를 승인하는 Facebook 사용자는 해당 Page를 관리할 권한이 있어야 합니다.
- 운영 환경은 Meta가 접근할 수 있는 **공개 HTTPS 도메인**이어야 합니다.

## 2. Meta 앱 생성

Meta for Developers에서 앱을 만들고 Facebook Login 및 Instagram Graph API 사용 구성을 추가합니다. 앱 유형과 제품 구성은 Meta 대시보드에서 현재 제공되는 선택지를 따릅니다.

앱 설정에 다음 공개 페이지를 등록할 수 있습니다.

- 개인정보 처리 안내: `https://<도메인>/privacy`
- 이용 안내: `https://<도메인>/terms`
- 데이터 삭제 콜백: `https://<도메인>/api/data-deletion/meta`
- 데이터 삭제 상태/안내: `https://<도메인>/data-deletion`

## 3. OAuth Callback 등록

관리자 화면의 **설정 > 개발자 연동** 또는 **계정 연동**에서 표시되는 URL을 그대로 Meta 앱의 Valid OAuth Redirect URI에 등록합니다.

기본 형식:

```text
https://<도메인>/api/meta/callback
```

`META_REDIRECT_URI` 값과 Meta 대시보드에 등록한 값은 스킴, 호스트, 경로, 후행 슬래시까지 정확히 일치해야 합니다.

## 4. 서버 환경 변수

```dotenv
APP_BASE_URL=https://<도메인>
META_GRAPH_VERSION=v26.0
META_APP_ID=<앱 ID>
META_APP_SECRET=<앱 시크릿>
META_REDIRECT_URI=https://<도메인>/api/meta/callback
META_SCOPES=pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish
```

- 앱 시크릿과 토큰을 브라우저 입력 폼이나 프론트엔드 환경 변수에 넣지 않습니다.
- Graph API 버전은 환경 변수 한 곳에서만 변경합니다.
- 실제 운영에 필요한 권한만 요청하고 Meta 앱 검수 결과에 맞춰 `META_SCOPES`를 조정합니다.

## 5. 연결 절차

1. 관리자 로그인
2. **계정 연동 > Meta 계정 연결** 선택
3. Meta 공식 동의 화면에서 Page 조회 및 게시 권한 승인
4. 관리 가능한 Facebook Page 중 하나 선택
5. 연결된 Instagram 프로페셔널 계정 확인
6. **연결 테스트** 실행
7. 통제된 테스트 미디어로 게시 1건 확인

연결 결과나 게시 성공은 Meta가 실제 성공 응답을 반환한 경우에만 저장됩니다.

## 6. 앱 모드와 검수

개발 모드에서는 앱 역할이 부여된 계정만 테스트할 수 있습니다. 일반 사용자 계정으로 운영하려면 필요한 권한에 대한 검수와 비즈니스 확인 등 Meta 대시보드에서 요구하는 절차를 완료해야 합니다.

## 7. 데이터 삭제

Meta 데이터 삭제 콜백은 `signed_request`의 HMAC-SHA256 서명을 검증한 뒤 확인 코드와 상태 URL을 반환합니다. 수동 삭제 요청도 `/data-deletion`에서 접수할 수 있습니다. 실제 운영자는 접수된 요청의 계정 소유 여부를 확인한 후 삭제 절차를 완료해야 합니다.

## 8. 문제 진단

- `META_NOT_CONFIGURED`: 필수 Meta 환경 변수가 누락됨
- `OAUTH_STATE_INVALID`: OAuth 요청 만료, 중복 사용 또는 state 불일치
- `NO_MANAGED_PAGES`: 승인 사용자에게 관리 가능한 Page가 없음
- `permission_error`: 필요한 권한이 토큰 디버그 결과에 없음
- `expired`: 토큰 만료 또는 Meta 오류 코드 190
- `INSTAGRAM_NOT_CONNECTED`: 선택한 Page에 연결된 프로페셔널 계정이 없음
