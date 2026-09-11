import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { SearchAdWriteError } from '../write/errors.js';
import { classifyReportSchema } from './report-schema.js';

const ROLE_RANK = Object.freeze({ reader: 1, operator: 2, executor: 3, admin: 4 });
const READY_STATUSES = new Set(['registered', 'reconciled']);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function principalFrom(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
}

function assertOperatorPrincipal(context = {}) {
  const principal = principalFrom(context);
  if ((ROLE_RANK[principal.role] || 0) < ROLE_RANK.operator) {
    fail('SEARCHAD_OPERATOR_REQUIRED', 'SearchAd Operator role or higher is required.', 403);
  }
  if (!principal.principalId) {
    fail('SEARCHAD_PRINCIPAL_REQUIRED', 'Authenticated SearchAd principal is required.', 403);
  }
  return principal;
}

function clockIso(clock) {
  const value = Number(clock());
  if (!Number.isFinite(value)) fail('SEARCHAD_REPORTING_CLOCK_INVALID', 'Reporting clock must return epoch milliseconds.', 503);
  return new Date(value).toISOString();
}

function reportTypeForIntent(intent) {
  if (intent.reportKind === 'stat') return String(intent.request?.reportTp || '').trim();
  if (intent.reportKind === 'master') return String(intent.request?.item || '').trim();
  return '';
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('SEARCHAD_REPORT_SCHEMA_INVALID', 'SearchAd report bytes are not valid UTF-8.', 409);
  }
}

export function parseCsvHeader(bytes) {
  const text = decodeUtf8(bytes);
  let index = 0;
  if (text.charCodeAt(0) === 0xFEFF) index = 1;
  const fields = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  while (index < text.length) {
    const ch = text[index];
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        closedQuote = true;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }

    if (closedQuote) {
      if (ch === ',') {
        fields.push(field);
        field = '';
        closedQuote = false;
        index += 1;
        continue;
      }
      if (ch === '\r' && text[index + 1] === '\n') {
        fields.push(field);
        return fields;
      }
      if (ch === '\n' || ch === '\r') {
        fields.push(field);
        return fields;
      }
      fail('SEARCHAD_REPORT_SCHEMA_INVALID', 'Unexpected characters follow a quoted SearchAd report header field.', 409);
    }

    if (ch === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (ch === ',') {
      fields.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (ch === '\r' && text[index + 1] === '\n') {
      fields.push(field);
      return fields;
    }
    if (ch === '\n' || ch === '\r') {
      fields.push(field);
      return fields;
    }
    if (ch === '"') {
      fail('SEARCHAD_REPORT_SCHEMA_INVALID', 'Unexpected quote in SearchAd report header.', 409);
    }
    field += ch;
    index += 1;
  }

  if (quoted) fail('SEARCHAD_REPORT_SCHEMA_INVALID', 'Unclosed quote in SearchAd report header.', 409);
  fields.push(field);
  return fields;
}

export class SearchAdReportIngestService {
  constructor({ repository, downloadAdapter, clock = Date.now } = {}) {
    for (const method of [
      'getReportIntent', 'putBlob', 'getSchema', 'putSchema', 'linkJobBlob',
      'appendReportEvent', 'updateReportIntent'
    ]) {
      if (typeof repository?.[method] !== 'function') throw new TypeError(`repository.${method} is required`);
    }
    if (!downloadAdapter?.download) throw new TypeError('downloadAdapter.download is required');
    if (typeof clock !== 'function') throw new TypeError('clock is required');
    this.repository = repository;
    this.downloadAdapter = downloadAdapter;
    this.clock = clock;
  }

  async ingest(reportIntentId, context = {}) {
    if (typeof reportIntentId !== 'string' || !reportIntentId.trim()) {
      fail('SEARCHAD_REPORT_INGEST_INPUT_INVALID', 'ingest accepts exactly one persisted reportIntentId string.', 400);
    }
    const id = reportIntentId.trim();
    const principal = assertOperatorPrincipal(context);
    const intent = await this.repository.getReportIntent(id);
    if (!intent || !principal.customerIds.includes(String(intent.customerId))) {
      fail('SEARCHAD_REPORT_INTENT_NOT_FOUND', 'SearchAd report intent was not found.', 404);
    }

    const reportType = reportTypeForIntent(intent);
    if (
      !READY_STATUSES.has(String(intent.status || '')) ||
      !String(intent.returnedJobId || '').trim() ||
      !String(intent.persistedDownloadUrl || '').trim() ||
      !['stat', 'master'].includes(String(intent.reportKind || '')) ||
      !reportType
    ) {
      fail('SEARCHAD_REPORT_INGEST_NOT_READY', 'SearchAd report intent is not ready for safe ingestion.', 409);
    }

    const downloaded = await this.downloadAdapter.download({
      customerId: String(intent.customerId),
      persistedDownloadUrl: String(intent.persistedDownloadUrl)
    });
    const bytes = Buffer.isBuffer(downloaded?.bytes) ? downloaded.bytes : Buffer.from(downloaded?.bytes || []);
    const blobSha256 = createHash('sha256').update(bytes).digest('hex');
    const now = clockIso(this.clock);

    await this.repository.putBlob({
      sha256: blobSha256,
      contentBytes: bytes,
      byteLength: bytes.length,
      contentType: String(downloaded?.contentType || 'application/octet-stream'),
      createdAt: now
    });

    const columns = parseCsvHeader(bytes);
    const probe = classifyReportSchema({
      reportKind: String(intent.reportKind),
      reportType,
      columns,
      knownSchemas: []
    });
    const existingSchema = await this.repository.getSchema(probe.schemaSha256);
    const classification = classifyReportSchema({
      reportKind: String(intent.reportKind),
      reportType,
      columns,
      knownSchemas: existingSchema ? [existingSchema] : []
    });

    const schema = existingSchema || await this.repository.putSchema({
      schemaSha256: classification.schemaSha256,
      reportKind: String(intent.reportKind),
      reportType,
      orderedColumns: columns,
      semanticMapping: {},
      state: 'quarantined',
      quarantineReason: 'unknown_schema',
      createdAt: now,
      reviewedAt: null,
      reviewedByPrincipalId: null
    });
    const finalClassification = existingSchema
      ? classification
      : classifyReportSchema({
          reportKind: String(intent.reportKind),
          reportType,
          columns,
          knownSchemas: [schema]
        });

    await this.repository.linkJobBlob({
      jobBlobId: randomUUID(),
      reportIntentId: intent.reportIntentId,
      customerId: String(intent.customerId),
      returnedJobId: String(intent.returnedJobId),
      blobSha256,
      schemaSha256: finalClassification.schemaSha256,
      downloadedAt: now
    });

    if (!finalClassification.trusted) {
      await this.repository.updateReportIntent(intent.reportIntentId, {
        status: 'manual_review',
        updatedAt: now,
        lastError: null
      }, String(intent.customerId));
    }

    await this.repository.appendReportEvent({
      eventId: randomUUID(),
      reportIntentId: intent.reportIntentId,
      customerId: String(intent.customerId),
      phase: 'ingest',
      status: finalClassification.trusted ? 'ingested' : 'quarantined',
      operationKey: null,
      requestId: downloaded?.requestId == null ? null : String(downloaded.requestId),
      details: {
        blobSha256,
        byteLength: bytes.length,
        schemaSha256: finalClassification.schemaSha256,
        schemaState: finalClassification.state
      },
      error: null,
      createdAt: now
    });

    return {
      reportIntentId: intent.reportIntentId,
      customerId: String(intent.customerId),
      returnedJobId: String(intent.returnedJobId),
      blobSha256,
      byteLength: bytes.length,
      schemaSha256: finalClassification.schemaSha256,
      schemaState: finalClassification.state,
      trusted: finalClassification.trusted,
      semanticMapping: structuredClone(finalClassification.semanticMapping || {})
    };
  }
}

export const _internal = { READY_STATUSES, reportTypeForIntent, decodeUtf8, principalFrom };
