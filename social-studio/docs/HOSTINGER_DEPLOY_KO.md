# Hostinger VPS 배포 절차

이 모듈은 기존 `smartstore-bridge`와 충돌하지 않도록 별도 Docker Compose 프로젝트와 기본 로컬 포트 `3100`을 사용합니다.

## 1. 서버에서 코드 받기

Hostinger 브라우저 터미널에서 실행합니다.

```bash
cd /opt
sudo git clone https://github.com/jskjw157/AtelierPopo.git atelier-popo
cd /opt/atelier-popo
git fetch origin
git checkout feat/haar-social-studio-meta-phase1
cd social-studio
```

이미 저장소가 있다면 새로 clone하지 말고 해당 작업 디렉터리에서 `git fetch` 후 브랜치를 체크아웃합니다.

## 2. 환경 파일 생성

```bash
cp .env.docker.example .env
nano .env
```

무작위 값 예시:

```bash
openssl rand -hex 32
```

관리자 비밀번호 해시는 로컬 또는 일회성 Node 컨테이너에서 생성합니다.

```bash
docker run --rm -it -v "$PWD:/app" -w /app node:22-alpine \
  sh -lc 'npm install --no-audit --no-fund && npm run hash-password -- "실제-관리자-비밀번호"'
```

출력된 bcrypt 해시만 `.env`의 `ADMIN_PASSWORD_HASH`에 저장하고 평문 비밀번호는 저장소에 커밋하지 않습니다.

## 3. 컨테이너 기동

```bash
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=150 app
```

로컬 상태 확인:

```bash
curl -fsS http://127.0.0.1:3100/api/health | jq
```

## 4. HTTPS 리버스 프록시

Hostinger의 도메인/리버스 프록시 기능 또는 Nginx에서 공개 도메인을 `127.0.0.1:3100`으로 전달합니다.

Nginx 예시:

```nginx
server {
    listen 443 ssl http2;
    server_name social.haar.co.kr;

    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
    }
}
```

HTTPS가 적용된 최종 주소와 `.env`의 `APP_BASE_URL`, `META_REDIRECT_URI`가 일치해야 합니다.

## 5. 외부 예약 실행

5분마다 호출하는 crontab 예시:

```cron
*/5 * * * * curl --fail --silent --show-error --max-time 900 \
  -X POST \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://social.haar.co.kr/api/jobs/run-due \
  >> /var/log/haar-social-cron.log 2>&1
```

`CRON_SECRET`을 crontab에 직접 노출하지 않으려면 권한이 제한된 환경 파일을 source하는 실행 스크립트를 사용합니다.

## 6. 배포 후 확인

```bash
curl -fsS https://social.haar.co.kr/api/health | jq
```

관리자 화면에서 다음 순서로 확인합니다.

1. 로그인
2. 설정 화면에서 환경 변수 누락 여부 확인
3. Meta OAuth Callback URL 복사
4. Meta 앱에 Callback 등록 및 환경 변수 입력
5. Meta 계정 연결
6. 연결 테스트
7. 미디어 1개 업로드
8. 초안 저장
9. 통제된 테스트 게시
10. 예약 게시 1건과 스케줄러 기록 확인

## 7. 업데이트와 롤백

```bash
cd /opt/atelier-popo
git fetch origin
git checkout feat/haar-social-studio-meta-phase1
git pull --ff-only
cd social-studio
docker compose build
docker compose up -d
```

롤백은 검증된 이전 커밋으로 체크아웃한 뒤 다시 build/up 합니다. PostgreSQL 볼륨과 업로드 볼륨은 이미지 재배포와 분리되어 있습니다.
