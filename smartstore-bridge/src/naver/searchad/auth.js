import crypto from 'node:crypto';

function normalizeMethod(method) {
  const value = String(method || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(value)) {
    const error = new Error('SearchAd HTTP method is invalid.');
    error.code = 'SEARCHAD_INVALID_METHOD';
    throw error;
  }
  return value;
}

export function normalizeSearchAdUri(uri) {
  const text = String(uri || '').trim();
  if (!text) {
    const error = new Error('SearchAd URI is required.');
    error.code = 'SEARCHAD_URI_REQUIRED';
    throw error;
  }
  let pathname;
  try {
    pathname = new URL(text, 'https://api.searchad.naver.com').pathname;
  } catch {
    pathname = text.split('?')[0].split('#')[0];
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, '/');
  return pathname || '/';
}

export function createSearchAdSignature({ secretKey, timestamp, method, uri }) {
  const secret = String(secretKey || '');
  if (!secret) {
    const error = new Error('SearchAd secret key is required.');
    error.code = 'SEARCHAD_SECRET_REQUIRED';
    throw error;
  }
  const ts = String(timestamp ?? '').trim();
  if (!/^\d{10,17}$/.test(ts)) {
    const error = new Error('SearchAd timestamp must be epoch milliseconds.');
    error.code = 'SEARCHAD_INVALID_TIMESTAMP';
    throw error;
  }
  const normalizedMethod = normalizeMethod(method);
  const normalizedUri = normalizeSearchAdUri(uri);
  const message = `${ts}.${normalizedMethod}.${normalizedUri}`;
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('base64');
}

export function buildSearchAdHeaders({ accessLicense, secretKey, customerId, timestamp, method, uri }) {
  const apiKey = String(accessLicense || '').trim();
  const customer = String(customerId || '').trim();
  if (!apiKey) {
    const error = new Error('SearchAd Access License is required.');
    error.code = 'SEARCHAD_ACCESS_LICENSE_REQUIRED';
    throw error;
  }
  if (!/^\d{1,30}$/.test(customer)) {
    const error = new Error('SearchAd customerId must contain 1-30 digits.');
    error.code = 'SEARCHAD_INVALID_CUSTOMER_ID';
    throw error;
  }
  const ts = String(timestamp);
  return {
    'X-Timestamp': ts,
    'X-API-KEY': apiKey,
    'X-Customer': customer,
    'X-Signature': createSearchAdSignature({ secretKey, timestamp: ts, method, uri })
  };
}

export function maskSearchAdCustomerId(customerId) {
  const text = String(customerId || '');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(text.length - 4)}${text.slice(-4)}`;
}

export function maskSearchAdSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}${'*'.repeat(Math.max(4, text.length - 7))}${text.slice(-4)}`;
}

export class SearchAdCredentialsRegistry {
  constructor(topology) {
    const principals = Array.isArray(topology?.principals) ? topology.principals : [];
    const customers = Array.isArray(topology?.customers) ? topology.customers : [];
    const grants = Array.isArray(topology?.grants) ? topology.grants : [];
    this.principals = new Map(principals.map(item => [item.principalId, { ...item }]));
    this.customers = new Map(customers.map(item => [String(item.customerId), { ...item, customerId: String(item.customerId) }]));
    this.grantsByCustomer = new Map();
    for (const grant of grants) {
      const customerId = String(grant.customerId);
      if (this.grantsByCustomer.has(customerId)) {
        const error = new Error(`Multiple SearchAd principals are granted to customer ${maskSearchAdCustomerId(customerId)}.`);
        error.code = 'SEARCHAD_AMBIGUOUS_CUSTOMER_GRANT';
        throw error;
      }
      const principal = this.principals.get(grant.principalId);
      const customer = this.customers.get(customerId);
      if (!principal || !customer) {
        const error = new Error('SearchAd grant references an unknown principal or customer.');
        error.code = 'SEARCHAD_INVALID_GRANT_TOPOLOGY';
        throw error;
      }
      this.grantsByCustomer.set(customerId, { grant: { ...grant }, principal, customer });
    }
  }

  resolve(customerId) {
    const id = String(customerId || '').trim();
    const resolved = this.grantsByCustomer.get(id);
    if (!resolved) {
      const error = new Error(`No SearchAd credential grant for customer ${maskSearchAdCustomerId(id)}.`);
      error.code = 'SEARCHAD_CUSTOMER_NOT_GRANTED';
      error.status = 403;
      throw error;
    }
    if (resolved.principal.status !== 'active' || resolved.customer.status !== 'active') {
      const error = new Error('SearchAd principal or customer is not active.');
      error.code = 'SEARCHAD_CREDENTIAL_INACTIVE';
      error.status = 403;
      throw error;
    }
    return {
      principalId: resolved.principal.principalId,
      accessLicense: resolved.principal.accessLicense,
      secretKey: resolved.principal.secretKey,
      customerId: resolved.customer.customerId,
      role: resolved.grant.role,
      accountName: resolved.customer.accountName || null
    };
  }

  listCustomers() {
    return [...this.grantsByCustomer.values()].map(item => ({
      principalId: item.principal.principalId,
      customerId: item.customer.customerId,
      customerIdMasked: maskSearchAdCustomerId(item.customer.customerId),
      accountName: item.customer.accountName || null,
      role: item.grant.role,
      status: item.customer.status
    }));
  }

  status() {
    return {
      principalCount: this.principals.size,
      customerCount: this.customers.size,
      grantCount: this.grantsByCustomer.size,
      customers: this.listCustomers()
    };
  }
}

export const _internal = { normalizeMethod };
