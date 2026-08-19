export function clone(value) {
  return structuredClone(value);
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base, overlay) {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return clone(overlay);
  }
  const result = clone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) {
      delete result[key];
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

export function findSetupPlaceholders(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSetupPlaceholders(item, `${path}[${index}]`, found));
    return found;
  }
  if (!isPlainObject(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key.includes('SETUP_REQUIRED') || (typeof child === 'string' && child.includes('REPLACE_WITH'))) {
      found.push(childPath);
    }
    findSetupPlaceholders(child, childPath, found);
  }
  return found;
}

export function safeJson(value) {
  return JSON.stringify(value, null, 2);
}
