import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { productUpdatePayloadFromChannelResponse } from '../../domain/product-update.js';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function asProductNo(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{1,30}$/.test(text)) throw new DetailContentError('INVALID_PRODUCT_NO', `${label} 형식이 올바르지 않습니다.`, 400);
  return text;
}

function normalizeHtml(value) {
  const html = String(value ?? '');
  if (!html.trim()) throw new DetailContentError('DETAIL_CONTENT_REQUIRED', 'detailContent HTML이 비어 있습니다.', 400);
  if (Buffer.byteLength(html, 'utf8') > 5 * 1024 * 1024) {
    throw new DetailContentError('DETAIL_CONTENT_TOO_LARGE', 'detailContent는 최대 5MB까지 허용됩니다.', 413);
  }
  return html;
}

export class DetailContentError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'DetailContentError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class DetailContentService {
  constructor({ productsApi, backupDir, logger } = {}) {
    if (!productsApi) throw new Error('DetailContentService에는 productsApi가 필요합니다.');
    this.productsApi = productsApi;
    this.backupDir = path.resolve(backupDir || './work/commerce-backups');
    this.logger = logger;
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  async previewChannelUpdate(channelProductNo, detailContent) {
    const channelNo = asProductNo(channelProductNo, 'channelProductNo');
    const nextHtml = normalizeHtml(detailContent);
    const remote = await this.productsApi.getChannelProduct(channelNo);
    const payload = productUpdatePayloadFromChannelResponse(remote);
    const originProductNo = String(remote.originProduct?.originProductNo || remote.originProductNo || '');
    const currentHtml = String(remote.originProduct?.detailContent || '');
    payload.originProduct.detailContent = nextHtml;
    return {
      channelProductNo: channelNo,
      originProductNo: originProductNo || null,
      current: { length: currentHtml.length, sha256: sha256(currentHtml) },
      next: { length: nextHtml.length, sha256: sha256(nextHtml) },
      changed: sha256(currentHtml) !== sha256(nextHtml),
      payload
    };
  }

  createBackup({ channelProductNo, originProductNo, remote, payload }) {
    const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${channelProductNo}_${randomUUID()}`;
    const filePath = path.join(this.backupDir, `${backupId}.json`);
    const record = {
      backupId,
      createdAt: new Date().toISOString(),
      channelProductNo: String(channelProductNo),
      originProductNo: originProductNo ? String(originProductNo) : null,
      currentDetailContentSha256: sha256(remote?.originProduct?.detailContent || ''),
      remote,
      updatePayload: payload
    };
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { backupId, filePath };
  }

  loadBackup(backupId) {
    const safe = String(backupId || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(safe)) throw new DetailContentError('INVALID_BACKUP_ID', 'backupId 형식이 올바르지 않습니다.', 400);
    const filePath = path.join(this.backupDir, `${safe}.json`);
    if (!fs.existsSync(filePath)) throw new DetailContentError('BACKUP_NOT_FOUND', `상세페이지 백업을 찾을 수 없습니다: ${safe}`, 404);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  async updateChannelDetail(channelProductNo, detailContent) {
    const preview = await this.previewChannelUpdate(channelProductNo, detailContent);
    if (!preview.changed) return { status: 'unchanged', preview };
    const remote = await this.productsApi.getChannelProduct(preview.channelProductNo);
    const backup = this.createBackup({
      channelProductNo: preview.channelProductNo,
      originProductNo: preview.originProductNo,
      remote,
      payload: preview.payload
    });
    const response = await this.productsApi.updateChannelProduct(preview.channelProductNo, preview.payload);
    const verified = await this.productsApi.getChannelProduct(preview.channelProductNo);
    const actualHtml = String(verified.originProduct?.detailContent || '');
    const expectedHash = preview.next.sha256;
    const actualHash = sha256(actualHtml);
    if (actualHash !== expectedHash) {
      throw new DetailContentError('DETAIL_CONTENT_VERIFY_FAILED', '네이버 상품 재조회 결과 상세페이지 해시가 일치하지 않습니다.', 502, {
        expectedHash,
        actualHash,
        backupId: backup.backupId
      });
    }
    this.logger?.info?.('Naver detail content updated', {
      channelProductNo: preview.channelProductNo,
      originProductNo: preview.originProductNo,
      backupId: backup.backupId,
      detailContentSha256: actualHash
    });
    return {
      status: 'updated',
      channelProductNo: preview.channelProductNo,
      originProductNo: preview.originProductNo,
      backupId: backup.backupId,
      detailContentSha256: actualHash,
      response
    };
  }

  async rollbackChannelDetail(backupId) {
    const backup = this.loadBackup(backupId);
    const channelProductNo = asProductNo(backup.channelProductNo, 'channelProductNo');
    const current = await this.productsApi.getChannelProduct(channelProductNo);
    const payload = productUpdatePayloadFromChannelResponse(current);
    const previousHtml = String(backup.remote?.originProduct?.detailContent || '');
    payload.originProduct.detailContent = previousHtml;
    const response = await this.productsApi.updateChannelProduct(channelProductNo, payload);
    const verified = await this.productsApi.getChannelProduct(channelProductNo);
    const actualHash = sha256(verified.originProduct?.detailContent || '');
    const expectedHash = sha256(previousHtml);
    if (actualHash !== expectedHash) {
      throw new DetailContentError('DETAIL_ROLLBACK_VERIFY_FAILED', '상세페이지 롤백 재조회 검증에 실패했습니다.', 502, { expectedHash, actualHash, backupId });
    }
    return { status: 'rolled_back', backupId, channelProductNo, detailContentSha256: actualHash, response };
  }
}
