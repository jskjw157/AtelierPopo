import { createHash } from 'node:crypto';

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => [key, canonicalValue(value[key])])
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function requestFingerprint(value) {
  return contentHash(value);
}

export function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const output = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(output[key], value)
      : value;
  }
  return output;
}

export function getPath(value, path) {
  if (!path) return value;
  return String(path).split('.').filter(Boolean).reduce((current, segment) => {
    if (current == null) return undefined;
    const index = /^\d+$/.test(segment) ? Number(segment) : segment;
    return current[index];
  }, value);
}

export function setPath(target, path, value) {
  const segments = String(path || '').split('.').filter(Boolean);
  if (!segments.length) return value;
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
  return target;
}

export function materializeBodyFromBefore(before, body = {}, mapping = {}) {
  const output = structuredClone(body || {});
  for (const [targetPath, sourcePath] of Object.entries(mapping || {})) {
    setPath(output, targetPath, structuredClone(getPath(before, sourcePath)));
  }
  return output;
}

export function isSubset(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => isSubset(actual[index], item));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => isSubset(actual[key], value));
  }
  return false;
}
