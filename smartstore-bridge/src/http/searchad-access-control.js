import crypto from 'node:crypto';
import { HttpError } from './errors.js';
import { extractBearerToken } from './security.js';

export const SEARCHAD_ROLE_RANK = Object.freeze({
  reader: 1,
  operator: 2,
  executor: 3,
  admin: 4
});

const ROLES = Object.freeze(Object.keys(SEARCHAD_ROLE_RANK));

function configError(message, details = {}) {
  const error = new HttpError(500, 'SEARCHAD_HTTP_ACCESS_CONFIG_INVALID', message, details);
  throw error;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    const padded = Buffer.alloc(a.length);
    crypto.timingSafeEqual(a, padded);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function parseCustomers(value, label) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const items = raw.split(',').map(item => item.trim()).filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const customerId of items) {
    if (customerId === '*' || !/^\d{1,30}$/.test(customerId)) {
      configError(`${label} must contain explicit numeric SearchAd Customer IDs only.`, { label });
    }
    if (!seen.has(customerId)) {
      seen.add(customerId);
      unique.push(customerId);
    }
  }
  return unique;
}

function roleEnvPrefix(role) {
  return `ATELIER_SEARCHAD_${role.toUpperCase()}`;
}

export function loadSearchAdHttpAccessControl(env = process.env) {
  const minLengthRaw = String(env.ATELIER_SEARCHAD_HTTP_API_KEY_MIN_LENGTH || '32').trim();
  if (!/^\d+$/.test(minLengthRaw)) configError('ATELIER_SEARCHAD_HTTP_API_KEY_MIN_LENGTH must be an integer.');
  const minLength = Number(minLengthRaw);
  if (!Number.isSafeInteger(minLength) || minLength < 16 || minLength > 128) {
    configError('ATELIER_SEARCHAD_HTTP_API_KEY_MIN_LENGTH must be between 16 and 128.');
  }

  const entries = [];
  const keyFingerprints = new Set();
  for (const role of ROLES) {
    const prefix = roleEnvPrefix(role);
    const apiKey = String(env[`${prefix}_API_KEY`] || '').trim();
    const customersRaw = String(env[`${prefix}_CUSTOMERS`] || '').trim();
    const principalIdRaw = String(env[`${prefix}_PRINCIPAL_ID`] || '').trim();

    if (!apiKey && !customersRaw && !principalIdRaw) continue;
    if (!apiKey) configError(`${prefix}_API_KEY is required when the SearchAd ${role} principal is configured.`);
    if (apiKey.length < minLength) configError(`${prefix}_API_KEY is shorter than the configured minimum length.`);

    const customerIds = parseCustomers(customersRaw, `${prefix}_CUSTOMERS`);
    if (!customerIds.length) configError(`${prefix}_CUSTOMERS must contain at least one explicit Customer ID.`);

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    if (keyFingerprints.has(keyHash)) {
      configError('The same SearchAd HTTP API key cannot be assigned to multiple roles.');
    }
    keyFingerprints.add(keyHash);

    entries.push({
      apiKey,
      principal: {
        principalId: principalIdRaw || `searchad-${role}`,
        role,
        customerIds
      },
      tokenFingerprint: keyHash.slice(0, 16)
    });
  }

  return new SearchAdHttpAccessControl({ entries, minLength });
}

export class SearchAdHttpAccessControl {
  constructor({ entries = [], minLength = 32 } = {}) {
    this.entries = entries.map(entry => ({
      apiKey: String(entry.apiKey),
      principal: {
        principalId: String(entry.principal.principalId),
        role: String(entry.principal.role),
        customerIds: [...entry.principal.customerIds].map(String)
      },
      tokenFingerprint: String(entry.tokenFingerprint || fingerprint(entry.apiKey))
    }));
    this.minLength = minLength;
  }

  status() {
    return {
      configured: this.entries.length > 0,
      principalCount: this.entries.length,
      roles: this.entries.map(entry => entry.principal.role),
      minimumKeyLength: this.minLength
    };
  }

  authenticateRequest(req, { minimumRole = 'reader' } = {}) {
    const required = String(minimumRole || '').toLowerCase();
    if (!Object.hasOwn(SEARCHAD_ROLE_RANK, required)) {
      configError(`Unknown SearchAd minimum role: ${required}`);
    }
    if (!this.entries.length) {
      throw new HttpError(503, 'SEARCHAD_HTTP_AUTH_NOT_CONFIGURED', 'SearchAd role authentication is not configured.');
    }
    const token = extractBearerToken(req?.headers?.authorization);
    if (!token) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authorization: Bearer API_KEY header is required.');
    }
    const entry = this.entries.find(candidate => constantTimeEquals(token, candidate.apiKey));
    if (!entry) throw new HttpError(401, 'UNAUTHORIZED', 'SearchAd API key is invalid.');
    if (SEARCHAD_ROLE_RANK[entry.principal.role] < SEARCHAD_ROLE_RANK[required]) {
      throw new HttpError(403, 'SEARCHAD_ROLE_FORBIDDEN', `SearchAd ${required} role or higher is required.`);
    }
    return {
      principal: {
        principalId: entry.principal.principalId,
        role: entry.principal.role,
        customerIds: [...entry.principal.customerIds]
      },
      tokenFingerprint: entry.tokenFingerprint
    };
  }

  assertCustomer(principal, customerId) {
    const id = String(customerId || '').trim();
    const allowed = Array.isArray(principal?.customerIds)
      && principal.customerIds.map(String).includes(id);
    if (!allowed) {
      throw new HttpError(403, 'SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.');
    }
    return id;
  }
}

export const _internal = { constantTimeEquals, parseCustomers, fingerprint };
