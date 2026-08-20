import fs from 'node:fs';
import path from 'node:path';

function parseDotEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadDotEnv(filePath = path.resolve('.env')) {
  if (!fs.existsSync(filePath)) return;
  const values = parseDotEnv(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function resolveFrom(baseDir, value) {
  if (!value || path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function resolveEnvPath(name, fallback, baseDir) {
  const value = process.env[name];
  if (!value) return resolveFrom(baseDir, fallback);
  return path.isAbsolute(value) ? value : path.resolve(value);
}

export function loadConfig(explicitPath) {
  loadDotEnv();
  const configPath = path.resolve(explicitPath || process.env.ATELIER_POPO_CONFIG || './config/atelier-popo.example.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`설정 파일을 찾을 수 없습니다: ${configPath}`);
  }
  const baseDir = path.dirname(configPath);
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const config = {
    ...raw,
    configPath,
    workDir: resolveEnvPath('ATELIER_WORK_DIR', raw.workDir || '../work', baseDir),
    databasePath: resolveEnvPath('ATELIER_DATABASE_PATH', raw.databasePath || '../work/atelier-popo.sqlite', baseDir),
    templateFile: resolveEnvPath('ATELIER_TEMPLATE_FILE', raw.templateFile, baseDir),
    catalogRoot: process.env.ATELIER_CATALOG_ROOT
      ? resolveEnvPath('ATELIER_CATALOG_ROOT', undefined, baseDir)
      : (raw.catalogRoot ? resolveFrom(baseDir, raw.catalogRoot) : undefined),
    naver: {
      clientId: process.env.NAVER_CLIENT_ID || '',
      clientSecret: process.env.NAVER_CLIENT_SECRET || '',
      tokenType: process.env.NAVER_TOKEN_TYPE || 'SELF',
      accountId: process.env.NAVER_ACCOUNT_ID || '',
      baseUrl: process.env.NAVER_BASE_URL || 'https://api.commerce.naver.com/external',
      allowWrites: ['1', 'true', 'yes', 'on'].includes(String(process.env.NAVER_ALLOW_WRITES || '').toLowerCase())
    }
  };
  fs.mkdirSync(config.workDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  return config;
}

export function loadProductTemplate(config) {
  if (!config.templateFile || !fs.existsSync(config.templateFile)) {
    throw new Error(`상품 템플릿 파일을 찾을 수 없습니다: ${config.templateFile || '(미설정)'}`);
  }
  return JSON.parse(fs.readFileSync(config.templateFile, 'utf8'));
}
