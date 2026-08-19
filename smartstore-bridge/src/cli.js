#!/usr/bin/env node
import { parseCliArgs, asBoolean, asInteger } from './utils/args.js';
import { bootstrap } from './bootstrap.js';
import { catalogStats, loadProductInfo } from './domain/queensilver.js';
import { issueAccessToken } from './naver/auth.js';
import { sellerManagementCode } from './domain/payload.js';
import { templateFromChannelProductResponse, writeTemplate } from './domain/template.js';
import { NaverApiError } from './naver/errors.js';

const HELP = `
아뜰리에포포 스마트스토어 CLI

사용법
  npm run cli -- auth test [--config FILE]
  npm run cli -- catalog stats <CATALOG_ROOT>
  npm run cli -- product validate <PRODUCT_JSON_OR_FOLDER>
  npm run cli -- product preview <PRODUCT_JSON_OR_FOLDER> [--out FILE]
  npm run cli -- product find <SOURCE_PRODUCT_ID>
  npm run cli -- product create <PRODUCT_JSON_OR_FOLDER> --execute --confirm REGISTER
  npm run cli -- template pull <EXISTING_CHANNEL_PRODUCT_NO> [--out FILE]
  npm run cli -- batch enqueue <CATALOG_ROOT>
  npm run cli -- batch run [--limit 20] [--status queued] [--execute --confirm REGISTER]
  npm run cli -- batch status [--status failed] [--limit 100]

안전 규칙
  - preview는 네이버에 아무것도 쓰지 않습니다.
  - create/batch --execute는 NAVER_ALLOW_WRITES=true와 확인문구가 모두 필요합니다.
`;

function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const { positionals, flags } = parseCliArgs(process.argv.slice(2));
  if (!positionals.length || flags.help || flags.h) {
    print(HELP);
    return;
  }
  const [group, action, target] = positionals;
  const app = bootstrap(flags.config);
  try {
    if (group === 'auth' && action === 'test') {
      const token = await issueAccessToken({
        clientId: app.config.naver.clientId,
        clientSecret: app.config.naver.clientSecret,
        tokenType: app.config.naver.tokenType,
        accountId: app.config.naver.accountId,
        baseUrl: app.config.naver.baseUrl
      });
      print({ ok: true, tokenType: token.tokenType, expiresIn: token.expiresIn, accessTokenPreview: `${token.accessToken.slice(0, 6)}…` });
      return;
    }
    if (group === 'catalog' && action === 'stats') {
      print(catalogStats(target || app.config.catalogRoot));
      return;
    }
    if (group === 'product' && action === 'validate') {
      const loaded = loadProductInfo(target);
      print({ ok: loaded.errors.length === 0, productId: loaded.product.product_id, name: loaded.product.name, errors: loaded.errors });
      return;
    }
    if (group === 'product' && action === 'preview') {
      const preview = app.productService.preview(target);
      const output = app.productService.writePreview(preview, flags.out);
      print({ ...preview, previewFile: output });
      return;
    }
    if (group === 'product' && action === 'find') {
      const code = sellerManagementCode(app.config, target);
      print({ sellerManagementCode: code, product: await app.productsApi.findBySellerManagementCode(code) });
      return;
    }
    if (group === 'product' && action === 'create') {
      if (!asBoolean(flags.execute)) throw new Error('실제 등록에는 --execute가 필요합니다. 먼저 preview를 확인하세요.');
      print(await app.productService.create(target, { confirm: flags.confirm }));
      return;
    }
    if (group === 'template' && action === 'pull') {
      if (!target) throw new Error('기존 스마트스토어 채널 상품번호가 필요합니다.');
      const response = await app.productsApi.getChannelProduct(target);
      const template = templateFromChannelProductResponse(response, app.config.channel);
      const output = writeTemplate(template, flags.out || './config/naver-product-template.json');
      print({ ok: true, output, warning: '추출된 템플릿도 반드시 preview 후 실제 등록하세요.' });
      return;
    }
    if (group === 'batch' && action === 'enqueue') {
      print(app.productService.enqueueCatalog(target || app.config.catalogRoot));
      return;
    }
    if (group === 'batch' && action === 'run') {
      print(await app.productService.runBatch({
        limit: asInteger(flags.limit, 20),
        status: flags.status || 'queued',
        execute: asBoolean(flags.execute),
        confirm: flags.confirm
      }));
      return;
    }
    if (group === 'batch' && action === 'status') {
      print({
        counts: app.ledger.counts(),
        jobs: app.ledger.list({ status: flags.status, limit: asInteger(flags.limit, 100) })
      });
      return;
    }
    throw new Error(`알 수 없는 명령입니다: ${positionals.join(' ')}\n${HELP}`);
  } finally {
    app.ledger.close();
  }
}

main().catch(error => {
  const body = error instanceof NaverApiError ? error.toJSON() : { name: error.name, message: error.message };
  process.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exitCode = 1;
});
