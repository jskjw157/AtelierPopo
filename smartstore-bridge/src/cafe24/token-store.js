import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Cafe24Error } from './errors.js';

function normalizeTokens(input = {}) {
  return {
    accessToken: input.accessToken || input.access_token || null,
    accessTokenExpiresAt: input.accessTokenExpiresAt || input.access_token_expires_at || input.expires_at || null,
    refreshToken: input.refreshToken || input.refresh_token || null,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt || input.refresh_token_expires_at || null,
    scope: input.scope || null,
    updatedAt: input.updatedAt || null
  };
}

export class FileCafe24TokenStore {
  constructor({ filePath, initialTokens = null, clock = () => new Date().toISOString() } = {}) {
    if (!filePath) throw new Error('FileCafe24TokenStore에는 filePath가 필요합니다.');
    this.filePath = path.resolve(filePath);
    this.initialTokens = initialTokens ? normalizeTokens(initialTokens) : null;
    this.clock = clock;
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        return normalizeTokens(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
      } catch (error) {
        throw new Cafe24Error('CAFE24_TOKEN_STORE_INVALID', 'Cafe24 토큰 저장 파일을 읽을 수 없습니다.', {
          status: 500,
          cause: error
        });
      }
    }
    return this.initialTokens ? structuredClone(this.initialTokens) : null;
  }

  save(tokens) {
    const normalized = { ...normalizeTokens(tokens), updatedAt: this.clock() };
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw new Cafe24Error('CAFE24_TOKEN_STORE_WRITE_FAILED', 'Cafe24 회전 토큰을 원자적으로 저장하지 못했습니다.', {
        status: 500,
        cause: error
      });
    }
    this.initialTokens = structuredClone(normalized);
    return structuredClone(normalized);
  }
}

export const _internal = { normalizeTokens };
