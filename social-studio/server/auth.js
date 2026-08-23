import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { config, isProduction } from './config.js';
import { query, audit } from './db.js';

const SESSION_COOKIE = 'haar_session';
const CSRF_COOKIE = 'haar_csrf';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' } }
});

function cookieOptions(httpOnly) {
  return {
    httpOnly,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000
  };
}

function issueSession(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.sessionSecret,
    { expiresIn: SESSION_TTL_SECONDS, issuer: 'haar-social-studio', audience: 'haar-admin' }
  );
}

export async function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const result = await query(
    `SELECT id, email, password_hash, role, status
     FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const user = result.rows[0];
  const valid = Boolean(user && user.status === 'active' && (await bcrypt.compare(password, user.password_hash)));
  if (!valid) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' } });
  }

  const csrf = randomBytes(24).toString('base64url');
  res.cookie(SESSION_COOKIE, issueSession(user), cookieOptions(true));
  res.cookie(CSRF_COOKIE, csrf, cookieOptions(false));
  await query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
  await audit(user.id, 'auth.login', 'user', user.id, { email: user.email });
  return res.json({ user: { id: user.id, email: user.email, role: user.role } });
}

export function logout(req, res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  return res.status(204).end();
}

export function optionalAuth(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    req.user = jwt.verify(token, config.sessionSecret, {
      issuer: 'haar-social-studio',
      audience: 'haar-admin'
    });
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } });
  }
  return next();
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: { code: 'CSRF_FAILED', message: '보안 토큰이 만료되었습니다. 새로고침 후 다시 시도해 주세요.' } });
  }

  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(config.appBaseUrl).origin) {
        return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: '허용되지 않은 요청 출처입니다.' } });
      }
    } catch {
      return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: '요청 출처를 확인할 수 없습니다.' } });
    }
  }
  return next();
}

export function currentUser(req, res) {
  if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } });
  return res.json({ user: { id: req.user.sub, email: req.user.email, role: req.user.role } });
}
