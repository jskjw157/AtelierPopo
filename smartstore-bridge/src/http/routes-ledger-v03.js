import { HttpError } from './errors.js';
import { parseBooleanQuery, parseIntegerQuery, validateConfirmation, validateIdempotencyKey } from './security.js';
import { publicJob, publicOperation } from './presenters.js';
import {
  assertHttpWriteAllowed,
  ensureSameIdempotentOperation,
  operationResponse,
  operationStatusCode,
  route,
  sendJson,
  validateOperationId,
  validateProductId
} from './runtime.js';

async function materializeBatchJobs(app, { status, limit, includeImages = true }) {
  if (!app.catalogMaterializer) return { requested: 0, succeeded: 0, failed: 0, failures: [] };
  const jobs = app.ledger.list({ status, limit });
  const failures = [];
  let succeeded = 0;
  for (const job of jobs) {
    try {
      const materialized = await app.catalogMaterializer.ensureProduct(job.source_product_id, { includeImages });
      app.ledger.upsertQueued({
        sourceProductId: job.source_product_id,
        sellerManagementCode: job.seller_management_code,
        sourcePath: materialized.productPath
      });
      succeeded += 1;
    } catch (error) {
      app.ledger.mark(job.source_product_id, 'failed', { lastError: error.stack || error.message });
      failures.push({
        productId: String(job.source_product_id),
        code: error.code || 'DRIVE_CATALOG_MATERIALIZE_FAILED',
        message: error.message
      });
    }
  }
  return { requested: jobs.length, succeeded, failed: failures.length, failures };
}

export function createLedgerRoutesV03({ app, httpConfig, createAsyncOperation, redactionRoots }) {
  return [
    route('GET', /^\/api\/v1\/jobs$/, async ({ req, res, url }) => {
      const status = url.searchParams.get('status') || undefined;
      const limit = parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 500 });
      const offset = parseIntegerQuery(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
      sendJson(req, res, 200, {
        ok: true,
        counts: app.ledger.counts(),
        jobs: app.ledger.list({ status, limit, offset }).map(row => publicJob(row, {
          includeDetails: false,
          redactionRoots
        }))
      });
    }),

    route('GET', /^\/api\/v1\/jobs\/([^/]+)$/, async ({ req, res, match, url }) => {
      const productId = validateProductId(decodeURIComponent(match[1]));
      const job = app.ledger.get(productId);
      if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', `상품 ${productId}의 작업 원장이 없습니다.`);
      sendJson(req, res, 200, {
        ok: true,
        job: publicJob(job, {
          includeDetails: parseBooleanQuery(url.searchParams.get('includeDetails'), false),
          redactionRoots
        })
      });
    }),

    route('GET', /^\/api\/v1\/operations$/, async ({ req, res, url }) => {
      const status = url.searchParams.get('status') || undefined;
      const operationType = url.searchParams.get('operationType') || undefined;
      const limit = parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 500 });
      const offset = parseIntegerQuery(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 });
      sendJson(req, res, 200, {
        ok: true,
        counts: app.ledger.operationCounts(),
        operations: app.ledger
          .listOperations({ status, operationType, limit, offset })
          .map(row => publicOperation(row, { includeDetails: false, redactionRoots }))
      });
    }),

    route('GET', /^\/api\/v1\/operations\/([^/]+)$/, async ({ req, res, match }) => {
      const operationId = validateOperationId(decodeURIComponent(match[1]));
      const operation = app.ledger.getOperation(operationId);
      if (!operation) throw new HttpError(404, 'OPERATION_NOT_FOUND', `API 작업을 찾을 수 없습니다: ${operationId}`);
      sendJson(req, res, 200, { ok: true, operation: publicOperation(operation, { redactionRoots }) });
    }),

    route('POST', /^\/api\/v1\/batches\/preview$/, async ({ req, res, body }) => {
      const limit = parseIntegerQuery(body.limit, 10, { min: 1, max: 20 });
      const status = String(body.status || 'queued');
      const materialization = await materializeBatchJobs(app, { status, limit, includeImages: true });
      const result = await app.productService.runBatch({ limit, status, execute: false });
      sendJson(req, res, 200, { ok: true, materialization, result });
    }),

    route('POST', /^\/api\/v1\/batches\/register$/, async ({ req, res, body }) => {
      const confirmation = validateConfirmation(body.confirmation, app.config.writeConfirmation);
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const limit = parseIntegerQuery(body.limit, 10, { min: 1, max: 20 });
      const status = String(body.status || 'previewed');
      const operationType = 'register_batch';
      const sourceProductId = `batch:${status}:${limit}`;
      const operationRequest = { status, limit, catalogProvider: app.catalogProvider };
      const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        ensureSameIdempotentOperation(existing, { operationType, sourceProductId, request: operationRequest });
        sendJson(req, res, operationStatusCode(existing), operationResponse(existing, { reused: true, redactionRoots }), {
          Location: `/api/v1/operations/${existing.operation_id}`
        });
        return;
      }

      assertHttpWriteAllowed(app, httpConfig, confirmation, { batch: true });
      const created = await createAsyncOperation({
        idempotencyKey,
        operationType,
        sourceProductId,
        request: operationRequest,
        task: async () => {
          const materialization = await materializeBatchJobs(app, { status, limit, includeImages: true });
          const result = await app.productService.runBatch({
            limit,
            status,
            execute: true,
            confirm: confirmation
          });
          return { materialization, result };
        }
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), {
        Location: `/api/v1/operations/${created.row.operation_id}`
      });
    }, { write: true })
  ];
}
