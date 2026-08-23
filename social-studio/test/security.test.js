import { beforeAll, describe, expect, it } from 'vitest';

let security;

beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = '11'.repeat(32);
  process.env.MEDIA_SIGNING_SECRET = 'media-signing-secret-for-tests-1234567890';
  security = await import('../server/security.js');
});

describe('server security helpers', () => {
  it('encrypts and decrypts secrets without retaining plaintext', () => {
    const encrypted = security.encryptSecret('page-access-token');
    expect(encrypted).not.toContain('page-access-token');
    expect(security.decryptSecret(encrypted)).toBe('page-access-token');
  });

  it('accepts a valid media signature and rejects expired signatures', () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    const signature = security.signMedia('asset-1', future);
    expect(security.verifyMediaSignature('asset-1', future, signature)).toBe(true);
    expect(security.verifyMediaSignature('asset-1', future - 120, signature)).toBe(false);
  });

  it('redacts nested sensitive fields', () => {
    expect(security.redact({ accessToken: 'secret', nested: { client_secret: 'secret', ok: true } }))
      .toEqual({ accessToken: '[REDACTED]', nested: { client_secret: '[REDACTED]', ok: true } });
  });
});
