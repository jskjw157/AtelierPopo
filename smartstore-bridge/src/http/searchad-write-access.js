import { HttpError } from './errors.js';
import { SEARCHAD_ROLE_RANK } from './searchad-access-control.js';

export function assertSearchAdRole(principal, minimumRole) {
  const required = SEARCHAD_ROLE_RANK[minimumRole];
  const actual = SEARCHAD_ROLE_RANK[principal?.role];
  if (!required || !actual || actual < required) {
    throw new HttpError(403, 'SEARCHAD_ROLE_FORBIDDEN', `SearchAd ${minimumRole} role or higher is required.`);
  }
}

export function assertSearchAdCustomerAccess(principal, customerId) {
  const id = String(customerId || '').trim();
  if (!id || !Array.isArray(principal?.customerIds) || !principal.customerIds.map(String).includes(id)) {
    throw new HttpError(403, 'SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.');
  }
  return id;
}

// Check the persisted owner before returning a plan, its attempts, or its token.
// Repository reads may be asynchronous (PostgreSQL); never inspect a Promise.
export async function requireSearchAdPlanAccess(runtime, planId, principal) {
  assertSearchAdRole(principal, 'reader');
  let plan;
  try {
    plan = await runtime.repository.getPlan(planId);
  } catch (error) {
    if (error?.code !== '22P02') throw error;
  }
  if (!plan || !(principal.customerIds || []).map(String).includes(String(plan.customer_id))) {
    throw new HttpError(404, 'SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.');
  }
  return plan;
}

export function assertSearchAdPlanCustomer(plan, customerId) {
  if (customerId !== undefined && String(customerId).trim() !== String(plan.customer_id)) {
    throw new HttpError(403, 'SEARCHAD_CUSTOMER_SCOPE_MISMATCH', '변경 계획과 요청의 광고계정이 일치하지 않습니다.');
  }
}
