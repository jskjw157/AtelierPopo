import { createHash } from 'node:crypto';

import { SearchAdWriteError } from '../write/errors.js';

function fail(message, details = {}) {
  throw new SearchAdWriteError(
    'SEARCHAD_REPORT_SCHEMA_INVALID',
    message,
    details,
    400
  );
}

function validateOrderedColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    fail('SearchAd report schema columns must be a non-empty ordered array.');
  }
  const seen = new Set();
  const normalized = columns.map((value, index) => {
    if (typeof value !== 'string' || !value || value.trim() !== value) {
      fail('SearchAd report schema column names must be exact non-empty strings.', { index });
    }
    if (seen.has(value)) {
      fail('SearchAd report schema column names must be unique.', { column: value });
    }
    seen.add(value);
    return value;
  });
  return normalized;
}

export function fingerprintOrderedColumns(columns) {
  const ordered = validateOrderedColumns(columns);
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export function classifyReportSchema({ reportKind, reportType, columns, knownSchemas = [] } = {}) {
  const kind = String(reportKind || '').trim();
  const type = String(reportType || '').trim();
  if (!kind || !type) fail('SearchAd report kind and type are required.');
  if (!Array.isArray(knownSchemas)) fail('Known SearchAd report schemas must be an array.');

  const orderedColumns = validateOrderedColumns(columns);
  const schemaSha256 = fingerprintOrderedColumns(orderedColumns);
  const matching = knownSchemas.find(schema => (
    String(schema?.schemaSha256 || '') === schemaSha256 &&
    String(schema?.reportKind || '') === kind &&
    String(schema?.reportType || '') === type
  ));

  if (matching?.state === 'known') {
    return {
      schemaSha256,
      reportKind: kind,
      reportType: type,
      orderedColumns,
      state: 'known',
      trusted: true,
      semanticMapping: structuredClone(matching.semanticMapping || {}),
      quarantineReason: null
    };
  }

  return {
    schemaSha256,
    reportKind: kind,
    reportType: type,
    orderedColumns,
    state: 'quarantined',
    trusted: false,
    semanticMapping: {},
    quarantineReason: matching?.state === 'quarantined'
      ? String(matching.quarantineReason || 'manual_review')
      : 'unknown_schema'
  };
}

export const _internal = { validateOrderedColumns };
