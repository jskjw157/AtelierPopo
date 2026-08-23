import crypto from 'node:crypto';
import { config } from './config.js';

function encryptionKey() {
  const value = config.tokenEncryptionKey;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;
  throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters or 32 bytes in base64.');
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(value) {
  const [ivPart, tagPart, ciphertextPart] = String(value).split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Encrypted value is malformed.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function signMedia(assetId, expiresAt) {
  return crypto
    .createHmac('sha256', config.mediaSigningSecret)
    .update(`${assetId}.${expiresAt}`)
    .digest('base64url');
}

export function verifyMediaSignature(assetId, expiresAt, signature) {
  if (!signature || !expiresAt) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const expected = signMedia(assetId, expiresAt);
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

const secretKeyPattern = /(access[_-]?token|refresh[_-]?token|app[_-]?secret|client[_-]?secret|authorization|auth[_-]?code|signed[_-]?request|signature|cron[_-]?secret)/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, secretKeyPattern.test(key) ? '[REDACTED]' : redact(item)])
  );
}

export function safeErrorMessage(error) {
  const message = String(error?.message || '알 수 없는 오류가 발생했습니다.');
  return message
    .replace(/EA[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 1000);
}
