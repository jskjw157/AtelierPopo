import crypto from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';

export function credentialFingerprintForCustomer(credentialsRegistry, customerId) {
  if (!credentialsRegistry?.resolve) {
    throw new SearchAdWriteError(
      'SEARCHAD_CANARY_CREDENTIALS_REQUIRED',
      'SearchAd credential registry is required for Active Canary.',
      {},
      503
    );
  }
  const resolved = credentialsRegistry.resolve(String(customerId));
  const principalId = String(resolved?.principalId || '').trim();
  const accessLicense = String(resolved?.accessLicense || '').trim();
  const secretKey = String(resolved?.secretKey || '');
  const resolvedCustomerId = String(resolved?.customerId || customerId || '').trim();
  if (!principalId || !accessLicense || !secretKey || !resolvedCustomerId) {
    throw new SearchAdWriteError(
      'SEARCHAD_CANARY_CREDENTIALS_INCOMPLETE',
      'Resolved SearchAd credentials are incomplete for Active Canary fingerprinting.',
      { customerId: resolvedCustomerId || String(customerId || '') },
      503
    );
  }
  return crypto
    .createHash('sha256')
    .update('haar-searchad-canary-credential-v1\0')
    .update(principalId)
    .update('\0')
    .update(accessLicense)
    .update('\0')
    .update(secretKey)
    .update('\0')
    .update(resolvedCustomerId)
    .digest('hex');
}
