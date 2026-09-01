import { sha256Json } from './canonical-json.js';
import { ChannelImportError, asChannelImportError } from './errors.js';

function normalizeMode(value) {
  const mode = String(value || 'full').trim().toLowerCase();
  if (!['full', 'incremental', 'single'].includes(mode)) {
    throw new ChannelImportError('CHANNEL_IMPORT_MODE_INVALID', 'mode는 full, incremental, single 중 하나여야 합니다.', {
      details: { mode }
    });
  }
  return mode;
}

function importerFrom(importers, channelId) {
  if (importers instanceof Map) return importers.get(channelId) || null;
  return importers?.[channelId] || null;
}

function requestFingerprint({ channelId, mode, request }) {
  return sha256Json({ channelId, mode, request: request || {} });
}

function asFailure(error) {
  const normalized = asChannelImportError(error, 'CHANNEL_IMPORT_PAGE_FAILED');
  return {
    code: normalized.code,
    message: normalized.message,
    details: normalized.details || null
  };
}

function priorFailures(run) {
  const failures = run?.error?.failures;
  return Array.isArray(failures) ? structuredClone(failures) : [];
}

function checkpointComplete(cursor) {
  return cursor?.complete === true;
}

function hasCheckpoint(cursor) {
  return Boolean(cursor && typeof cursor === 'object' && Object.keys(cursor).length);
}

function removeResolvedPageFailure(run, failures, failedCount) {
  if (!run?.error?.pageFailure) return { failures, failedCount };
  const pageFailure = run.error.pageFailure;
  const reversedIndex = [...failures].reverse().findIndex(item => (
    item?.code === pageFailure.code && item?.message === pageFailure.message
  ));
  if (reversedIndex >= 0) failures.splice(failures.length - 1 - reversedIndex, 1);
  return { failures, failedCount: Math.max(0, failedCount - 1) };
}

export class ChannelImportService {
  constructor({ repository, importers, registrar, idFactory, clock } = {}) {
    if (!repository) throw new Error('ChannelImportService에는 repository가 필요합니다.');
    if (!registrar || typeof registrar.registerPage !== 'function') {
      throw new Error('ChannelImportService에는 ChannelProductRegistrar가 필요합니다.');
    }
    this.repository = repository;
    this.importers = importers || new Map();
    this.registrar = registrar;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  getImporter(channelId) {
    const importer = importerFrom(this.importers, channelId);
    if (!importer || typeof importer.iterate !== 'function' || typeof importer.preview !== 'function') {
      throw new ChannelImportError('CHANNEL_IMPORTER_NOT_READY', `채널 Importer가 준비되지 않았습니다: ${channelId}`, {
        status: 503,
        details: { channelId }
      });
    }
    return importer;
  }

  async preview(channelId) {
    const normalizedChannelId = String(channelId || '').trim().toLowerCase();
    if (!normalizedChannelId) throw new ChannelImportError('CHANNEL_ID_REQUIRED', 'channelId가 필요합니다.');
    const result = await this.getImporter(normalizedChannelId).preview();
    return { channelId: normalizedChannelId, ...result };
  }

  getRun(importRunId) {
    const run = this.repository.getImportRun(String(importRunId || '').trim());
    if (!run) {
      throw new ChannelImportError('CHANNEL_IMPORT_RUN_NOT_FOUND', `가져오기 작업을 찾을 수 없습니다: ${importRunId}`, {
        status: 404
      });
    }
    return run;
  }

  async run({ channelId, mode = 'full', idempotencyKey, request = {} } = {}) {
    const normalizedChannelId = String(channelId || '').trim().toLowerCase();
    if (!normalizedChannelId) throw new ChannelImportError('CHANNEL_ID_REQUIRED', 'channelId가 필요합니다.');
    const normalizedMode = normalizeMode(mode);
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new ChannelImportError('CHANNEL_IMPORT_IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey가 필요합니다.');
    const fingerprint = requestFingerprint({
      channelId: normalizedChannelId,
      mode: normalizedMode,
      request
    });
    const importer = this.getImporter(normalizedChannelId);

    let run = this.repository.findImportRunByIdempotencyKey(key);
    const reused = Boolean(run);
    let resumed = false;
    if (run) {
      if (run.requestHash !== fingerprint || run.channelId !== normalizedChannelId || run.mode !== normalizedMode) {
        throw new ChannelImportError(
          'CHANNEL_IMPORT_IDEMPOTENCY_CONFLICT',
          '같은 idempotencyKey가 다른 채널 가져오기 요청에 사용됐습니다.',
          { status: 409, details: { importRunId: run.importRunId } }
        );
      }
      if (run.status === 'succeeded' || run.status === 'running' || checkpointComplete(run.cursor)) {
        return { ...run, reused: true, resumed: false, missingMarkedCount: 0 };
      }
      resumed = ['partial', 'failed'].includes(run.status);
    } else {
      run = this.repository.createImportRun({
        importRunId: this.idFactory?.(),
        channelId: normalizedChannelId,
        mode: normalizedMode,
        idempotencyKey: key,
        requestHash: fingerprint,
        request
      });
    }

    let remoteCount = run.remoteCount;
    let importedCount = run.importedCount;
    let updatedCount = run.updatedCount;
    let unchangedCount = run.unchangedCount;
    let failedCount = run.failedCount;
    let failures = priorFailures(run);
    if (resumed) {
      ({ failures, failedCount } = removeResolvedPageFailure(run, failures, failedCount));
    }
    let cursor = run.cursor || {};

    run = this.repository.updateImportCheckpoint(run.importRunId, {
      status: 'running',
      failedCount,
      cursor,
      error: { failures }
    });

    try {
      for await (const page of importer.iterate({
        checkpoint: hasCheckpoint(cursor) ? cursor : null
      })) {
        const registration = this.registrar.registerPage({
          importRunId: run.importRunId,
          items: page.items
        });
        importedCount += registration.created;
        updatedCount += registration.updated;
        unchangedCount += registration.unchanged;
        failedCount += registration.failed;
        failures.push(...registration.failures);
        remoteCount = Number(page.remoteCount ?? remoteCount ?? 0);
        cursor = page.nextCheckpoint || { complete: true };
        run = this.repository.updateImportCheckpoint(run.importRunId, {
          status: 'running',
          remoteCount,
          importedCount,
          updatedCount,
          unchangedCount,
          failedCount,
          cursor,
          error: { failures }
        });
      }

      const successfulCount = importedCount + updatedCount + unchangedCount;
      const status = failedCount === 0 ? 'succeeded' : (successfulCount > 0 ? 'partial' : 'failed');
      run = this.repository.finishImportRun(run.importRunId, {
        status,
        remoteCount,
        importedCount,
        updatedCount,
        unchangedCount,
        failedCount,
        cursor: checkpointComplete(cursor) ? cursor : { complete: true },
        error: { failures }
      });
      let missingMarkedCount = 0;
      if (status === 'succeeded' && normalizedMode === 'full') {
        missingMarkedCount = this.repository.markMissingAfterSuccessfulFullImport(
          normalizedChannelId,
          run.importRunId
        );
      }
      return { ...this.getRun(run.importRunId), reused, resumed, missingMarkedCount };
    } catch (error) {
      const pageFailure = asFailure(error);
      failures.push(pageFailure);
      const successfulCount = importedCount + updatedCount + unchangedCount;
      const status = successfulCount > 0 || hasCheckpoint(cursor) ? 'partial' : 'failed';
      run = this.repository.finishImportRun(run.importRunId, {
        status,
        remoteCount,
        importedCount,
        updatedCount,
        unchangedCount,
        failedCount: failedCount + 1,
        cursor,
        error: { failures, pageFailure }
      });
      return { ...this.getRun(run.importRunId), reused, resumed, missingMarkedCount: 0 };
    }
  }
}

export const _internal = {
  normalizeMode,
  importerFrom,
  requestFingerprint,
  asFailure,
  priorFailures,
  checkpointComplete,
  hasCheckpoint,
  removeResolvedPageFailure
};
