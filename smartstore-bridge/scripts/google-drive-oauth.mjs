#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function loadDotEnv(filePath = path.resolve('.env')) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, child) => child.toUpperCase());
    if (inlineValue !== undefined) result[key] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[key] = argv[++index];
    else result[key] = true;
  }
  return result;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function browserCommand(url) {
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

function tryOpenBrowser(url) {
  const { command, args } = browserCommand(url);
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectUri }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(data.error_description || data.error || data.raw || `Google OAuth HTTP ${response.status}`);
  }
  return data;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const clientId = String(args.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(args.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const host = String(args.host || '127.0.0.1');
  const requestedPort = Number(args.port || 53682);
  const timeoutMs = Number(args.timeoutMs || 10 * 60_000);
  const outputPath = path.resolve(args.output || './work/google-drive-oauth.env');
  const noOpen = Boolean(args.noOpen);
  const printSecrets = Boolean(args.printSecrets);

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID와 GOOGLE_OAUTH_CLIENT_SECRET이 필요합니다. Google Cloud에서 데스크톱 앱 OAuth 클라이언트를 만든 뒤 .env 또는 인자로 설정하세요.'
    );
  }

  const state = base64Url(crypto.randomBytes(32));
  const codeVerifier = base64Url(crypto.randomBytes(64));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  let resolveCallback;
  let rejectCallback;
  const callbackPromise = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname !== '/oauth2/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end('OAuth state mismatch.');
        rejectCallback(new Error('Google OAuth state가 일치하지 않습니다.'));
        return;
      }
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        res.statusCode = 400;
        res.end(`OAuth failed: ${oauthError}`);
        rejectCallback(new Error(`Google OAuth 승인 실패: ${oauthError}`));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.end('Authorization code is missing.');
        rejectCallback(new Error('Google OAuth authorization code가 없습니다.'));
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<h2>HAAR Google Drive 연결 승인 완료</h2><p>이 창을 닫고 터미널로 돌아가세요.</p>');
      resolveCallback(code);
    } catch (error) {
      rejectCallback(error);
      res.statusCode = 500;
      res.end('OAuth callback failed.');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  const redirectUri = `http://${host}:${port}/oauth2/callback`;
  const authorizationUrl = new URL(AUTH_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  console.log('\nHAAR Google Drive 사용자 OAuth 승인 URL:\n');
  console.log(authorizationUrl.toString());
  console.log(`\n승인 콜백 대기 중: ${redirectUri}`);
  if (!noOpen) {
    const opened = tryOpenBrowser(authorizationUrl.toString());
    if (!opened) console.log('브라우저를 자동으로 열지 못했습니다. 위 URL을 직접 여세요.');
  }

  const timeout = setTimeout(() => rejectCallback(new Error('Google OAuth 승인 대기 시간이 초과되었습니다.')), timeoutMs);
  try {
    const code = await callbackPromise;
    const token = await exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectUri });
    if (!token.refresh_token) {
      throw new Error(
        'Google이 refresh_token을 반환하지 않았습니다. 기존 앱 권한을 취소한 뒤 다시 실행하거나 prompt=consent 승인 여부를 확인하세요.'
      );
    }
    const envFile = [
      '# Generated by npm run drive:oauth',
      `# createdAt=${new Date().toISOString()}`,
      `# scope=${token.scope || DRIVE_SCOPE}`,
      `GOOGLE_OAUTH_CLIENT_ID=${clientId}`,
      `GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`,
      `GOOGLE_OAUTH_REFRESH_TOKEN=${token.refresh_token}`,
      ''
    ].join('\n');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, envFile, { mode: 0o600 });
    try { fs.chmodSync(outputPath, 0o600); } catch {}

    console.log('\n승인 성공. Hostinger Secret에 GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN을 저장하세요.');
    console.log(`비밀값 파일(권한 0600): ${outputPath}`);
    if (printSecrets) {
      console.log('\n--print-secrets가 지정되어 비밀값을 표시합니다.');
      console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
      console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${token.refresh_token}`);
    }
    console.log('비밀값은 GitHub, 채팅, 캡처에 올리지 마세요.');
  } finally {
    clearTimeout(timeout);
    await new Promise(resolve => server.close(() => resolve()));
  }
}

main().catch(error => {
  console.error(`\nGoogle Drive OAuth 설정 실패: ${error.message}`);
  process.exitCode = 1;
});
