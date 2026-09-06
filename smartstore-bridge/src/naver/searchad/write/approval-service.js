import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SearchAdWriteError } from './errors.js';

export const SEARCHAD_APPROVAL_CONFIRMATION = 'APPROVE_SEARCHAD_CHANGE';

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export class SearchAdApprovalService {
  constructor({ repository, config, clock = () => Date.now() }) {
    this.repository = repository;
    this.config = config;
    this.clock = clock;
  }

  approve(planId, input = {}) {
    const plan = this.repository.getPlan(planId);
    if (!plan) throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
    if (!['planned', 'approved'].includes(plan.status)) {
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_APPROVABLE', '현재 상태에서는 변경 계획을 승인할 수 없습니다.', { planId, status: plan.status }, 409);
    }
    const nowMs = this.clock();
    if (Date.parse(plan.expires_at) <= nowMs) {
      this.repository.updatePlan(planId, { status: 'expired' }, { expectedStatuses: [plan.status] });
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_EXPIRED', '변경 계획이 만료되었습니다.', { planId }, 409);
    }
    if (String(input.confirmation || '') !== SEARCHAD_APPROVAL_CONFIRMATION) {
      throw new SearchAdWriteError('SEARCHAD_APPROVAL_CONFIRMATION_REQUIRED', `confirmation은 ${SEARCHAD_APPROVAL_CONFIRMATION}이어야 합니다.`, { expected: SEARCHAD_APPROVAL_CONFIRMATION });
    }
    const actor = String(input.actor || '').trim();
    if (!actor) throw new SearchAdWriteError('SEARCHAD_APPROVER_REQUIRED', '승인자 정보가 필요합니다.');
    const rawToken = randomBytes(32).toString('base64url');
    const now = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + this.config.approvalTtlSeconds * 1000).toISOString();
    const approval = this.repository.createApproval({
      approval_id: randomUUID(),
      plan_id: planId,
      actor,
      confirmation: SEARCHAD_APPROVAL_CONFIRMATION,
      token_hash: tokenHash(rawToken),
      created_at: now,
      expires_at: expiresAt
    });
    this.repository.updatePlan(planId, { status: 'approved', approved_at: now }, { expectedStatuses: ['planned', 'approved'] });
    return {
      approvalId: approval.approval_id,
      planId,
      executionToken: rawToken,
      expiresAt,
      oneTime: true
    };
  }

  claim(planId, rawToken) {
    if (!rawToken) throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_REQUIRED', '1회용 실행 토큰이 필요합니다.', {}, 403);
    return this.repository.claimApproval({
      planId,
      tokenHash: tokenHash(rawToken),
      now: new Date(this.clock()).toISOString()
    });
  }
}
