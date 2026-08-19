#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { bootstrap } from './bootstrap.js';
import { catalogStats } from './domain/queensilver.js';
import { issueAccessToken } from './naver/auth.js';
import { logger } from './infrastructure/logger.js';

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

function wrap(handler) {
  return async input => {
    try {
      return textResult(await handler(input));
    } catch (error) {
      logger.error(error.message, { stack: error.stack });
      return textResult({ error: error.message, name: error.name }, true);
    }
  };
}

const app = bootstrap();
const server = new McpServer({ name: 'atelier-popo-smartstore', version: '0.1.0' });

server.registerTool('atelier_auth_test', {
  description: '네이버 커머스API 인증 토큰 발급이 가능한지 확인합니다. 토큰 원문은 반환하지 않습니다.',
  inputSchema: z.object({})
}, wrap(async () => {
  const token = await issueAccessToken({
    clientId: app.config.naver.clientId,
    clientSecret: app.config.naver.clientSecret,
    tokenType: app.config.naver.tokenType,
    accountId: app.config.naver.accountId,
    baseUrl: app.config.naver.baseUrl
  });
  return { ok: true, tokenType: token.tokenType, expiresIn: token.expiresIn };
}));

server.registerTool('atelier_catalog_stats', {
  description: '퀸실버 catalog_manifest.json을 읽어 상품 수와 카테고리별 수량을 확인합니다.',
  inputSchema: z.object({ catalogRoot: z.string().optional() })
}, wrap(async ({ catalogRoot }) => catalogStats(catalogRoot || app.config.catalogRoot)));

server.registerTool('atelier_preview_product', {
  description: 'product_info.json을 네이버 상품 등록 페이로드로 변환하고 검증합니다. 네이버에는 쓰지 않습니다.',
  inputSchema: z.object({ productPath: z.string() })
}, wrap(async ({ productPath }) => app.productService.preview(productPath)));

server.registerTool('atelier_find_product', {
  description: '퀸실버 상품번호를 판매자관리코드로 바꿔 스마트스토어에 이미 등록되었는지 검색합니다.',
  inputSchema: z.object({ sourceProductId: z.string() })
}, wrap(async ({ sourceProductId }) => {
  const sellerManagementCode = `${app.config.sellerCodePrefix}-${sourceProductId}`;
  return {
    sellerManagementCode,
    product: await app.productsApi.findBySellerManagementCode(sellerManagementCode)
  };
}));

server.registerTool('atelier_create_product', {
  description: '상품 1개를 실제 등록합니다. NAVER_ALLOW_WRITES=true와 정확한 confirm 값이 모두 필요합니다.',
  inputSchema: z.object({
    productPath: z.string(),
    confirm: z.string().describe('설정의 writeConfirmation 값. 기본 REGISTER')
  })
}, wrap(async ({ productPath, confirm }) => app.productService.create(productPath, { confirm })));

server.registerTool('atelier_batch_status', {
  description: '로컬 SQLite 작업 원장의 상태별 건수와 작업 목록을 조회합니다.',
  inputSchema: z.object({
    status: z.enum(['queued', 'previewed', 'creating', 'created', 'exists', 'skipped', 'failed']).optional(),
    limit: z.number().int().min(1).max(500).default(100)
  })
}, wrap(async ({ status, limit }) => ({ counts: app.ledger.counts(), jobs: app.ledger.list({ status, limit }) })));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started');
}

main().catch(error => {
  logger.error('MCP server failed', { message: error.message, stack: error.stack });
  try { app.ledger.close(); } catch {}
  process.exitCode = 1;
});
