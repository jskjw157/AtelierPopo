#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { bootstrap } from './bootstrap.js';
import { logger } from './infrastructure/logger.js';
import { SERVICE_VERSION } from './version.js';
import { registerTools } from './mcp/tools.js';

const app = bootstrap();
const server = new McpServer({ name: 'atelier-popo-smartstore', version: SERVICE_VERSION });
registerTools(server, { app, logger });

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
