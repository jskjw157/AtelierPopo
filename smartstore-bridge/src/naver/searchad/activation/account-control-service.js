import { SearchAdWriteError } from '../write/errors.js';

const ROLE_RANK = Object.freeze({ reader: 1, operator: 2, executor: 3, admin: 4 });

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function normalizePrincipal(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
}

export class SearchAdAccountControlService {
  constructor({ repository, clock = Date.now } = {}) {
    if (!repository?.setAccountSuspended || !repository?.listAccounts) {
      throw new TypeError('account control repository is required');
    }
    this.repository = repository;
    this.clock = clock;
  }

  assertReader(context = {}) {
    const principal = normalizePrincipal(context);
    if ((ROLE_RANK[principal.role] || 0) < ROLE_RANK.reader || !principal.principalId) {
      fail('SEARCHAD_READER_REQUIRED', 'SearchAd Reader role or higher is required.', 403);
    }
    return principal;
  }

  assertAdminForCustomer(customerId, context = {}) {
    const principal = normalizePrincipal(context);
    if (principal.role !== 'admin' || !principal.principalId) {
      fail('SEARCHAD_ADMIN_REQUIRED', 'SearchAd Admin role is required.', 403);
    }
    const id = String(customerId || '').trim();
    if (!id || !principal.customerIds.includes(id)) {
      fail('SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.', 403);
    }
    return { principal, customerId: id };
  }

  async setSuspended(customerId, suspended, context = {}) {
    const checked = this.assertAdminForCustomer(customerId, context);
    return this.repository.setAccountSuspended({
      customerId: checked.customerId,
      suspended: Boolean(suspended),
      actorPrincipalId: checked.principal.principalId,
      requestId: context?.requestId == null ? null : String(context.requestId),
      createdAt: new Date(Number(this.clock())).toISOString()
    });
  }

  suspend(customerId, context = {}) {
    return this.setSuspended(customerId, true, context);
  }

  resume(customerId, context = {}) {
    return this.setSuspended(customerId, false, context);
  }

  async list(context = {}) {
    const principal = this.assertReader(context);
    return this.repository.listAccounts(principal.customerIds);
  }
}

export const _internal = { normalizePrincipal };
