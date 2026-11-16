import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcpEntry = path.join(bridgeRoot, 'src', 'mcp.js');
const exampleConfig = path.join(bridgeRoot, 'config', 'atelier-popo.example.json');
const expectedTools = [
  'atelier_auth_test',
  'atelier_catalog_stats',
  'atelier_preview_product',
  'atelier_find_product',
  'atelier_create_product',
  'atelier_batch_status'
];

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(bridgeRoot, 'package.json'), 'utf8')).version;
}

test('MCP stdio 계약: 6개 도구와 catalog stats를 노출한다', { timeout: 20_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-mcp-contract-'));
  const catalogRoot = path.join(directory, 'catalog');
  const workDir = path.join(directory, 'work');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(catalogRoot, 'catalog_manifest.json'),
    JSON.stringify({
      source: 'fixture',
      total_products: 1,
      total_completed: 1,
      products: {
        'fixture-product-1': {
          completed: true,
          categories: ['귀걸이']
        }
      }
    }, null, 2)
  );

  const child = spawn(process.execPath, [mcpEntry], {
    cwd: bridgeRoot,
    env: {
      ...process.env,
      ATELIER_POPO_CONFIG: exampleConfig,
      ATELIER_CATALOG_ROOT: catalogRoot,
      ATELIER_WORK_DIR: workDir,
      ATELIER_DATABASE_PATH: path.join(directory, 'ledger.sqlite')
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const stdoutLines = [];
  const invalidStdoutLines = [];
  const pending = new Map();
  let stderr = '';
  let stdoutBuffer = '';

  function failPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        stdoutLines.push(line);
        try {
          const message = JSON.parse(line);
          const waiter = message.id !== undefined ? pending.get(message.id) : null;
          if (waiter) {
            clearTimeout(waiter.timer);
            pending.delete(message.id);
            waiter.resolve(message);
          }
        } catch {
          invalidStdoutLines.push(line);
        }
      }
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.on('error', error => {
    failPending(new Error(`Failed to spawn MCP child: ${error.message}\nstderr:\n${stderr}`));
  });
  child.on('exit', code => {
    failPending(new Error(`MCP child exited early with code ${code}\nstderr:\n${stderr}`));
  });

  function send(id, method, params) {
    const message = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\nstderr:\n${stderr}\nstdout:\n${stdoutLines.join('\n')}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  try {
    const initialized = await send(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'atelier-mcp-contract-test', version: '0.0.0' }
    });
    assert.equal(initialized.result.serverInfo.version, readPackageVersion());

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const listed = await send(2, 'tools/list', {});
    const toolNames = listed.result.tools.map(tool => tool.name).sort();
    assert.deepEqual(toolNames, [...expectedTools].sort());

    const createProduct = listed.result.tools.find(tool => tool.name === 'atelier_create_product');
    assert.ok(createProduct, 'atelier_create_product tool must be registered');
    assert.deepEqual(
      [...createProduct.inputSchema.required].sort(),
      ['confirm', 'productPath']
    );

    const called = await send(3, 'tools/call', {
      name: 'atelier_catalog_stats',
      arguments: { catalogRoot }
    });
    assert.notEqual(called.result.isError, true, `atelier_catalog_stats failed: ${JSON.stringify(called.result)}`);
    const stats = JSON.parse(called.result.content[0].text);
    assert.deepEqual(stats, {
      source: 'fixture',
      totalProducts: 1,
      totalCompleted: 1,
      byCategory: { '귀걸이': 1 }
    });

    const trailingOutput = stdoutBuffer.trim();
    if (trailingOutput) {
      stdoutLines.push(trailingOutput);
      try {
        JSON.parse(trailingOutput);
      } catch {
        invalidStdoutLines.push(trailingOutput);
      }
    }

    assert.deepEqual(invalidStdoutLines, [], `stdout contained non-JSON lines:\n${invalidStdoutLines.join('\n')}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill(); } catch {}
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 2_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
