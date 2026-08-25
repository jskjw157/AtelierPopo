#!/usr/bin/env node
import { loadSearchAdConfig, publicSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';

try {
  const config = loadSearchAdConfig(process.env);
  const registry = loadSearchAdSpecRegistry(config.manifestPath);
  const credentials = new SearchAdCredentialsRegistry(config.topology);
  console.log(JSON.stringify({ ok: true, config: publicSearchAdConfig(config), credentials: credentials.status(), spec: registry.status() }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || null, message: error.message }, null, 2));
  process.exitCode = 1;
}
