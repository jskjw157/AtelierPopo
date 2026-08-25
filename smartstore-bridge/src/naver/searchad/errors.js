export class SearchAdError extends Error {
  constructor(message, {
    code = 'SEARCHAD_ERROR',
    status = 500,
    details = null,
    retryable = false,
    requestId = null,
    upstreamStatus = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SearchAdError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryable = retryable;
    this.requestId = requestId;
    this.upstreamStatus = upstreamStatus;
  }
}

export function searchAdErrorFromResponse({ response, data, requestId }) {
  const upstreamCode = data?.code || data?.errorCode || data?.error?.code || null;
  const upstreamMessage = data?.message || data?.errorMessage || data?.error?.message || response.statusText || 'SearchAd API request failed.';
  const retryable = [429, 502, 503, 504].includes(response.status);
  return new SearchAdError(String(upstreamMessage), {
    code: upstreamCode ? `SEARCHAD_UPSTREAM_${String(upstreamCode).replace(/[^A-Za-z0-9_]+/g, '_').toUpperCase()}` : 'SEARCHAD_UPSTREAM_ERROR',
    status: response.status >= 500 ? 502 : response.status,
    upstreamStatus: response.status,
    requestId,
    retryable,
    details: {
      upstreamCode,
      upstreamStatus: response.status,
      invalidInputs: data?.invalidInputs || data?.errors || null
    }
  });
}

export function redactSearchAdObject(value) {
  const secretKeys = /(secret|signature|authorization|api[-_]?key|access[-_]?license|authtoken|downloadurl)/i;
  function visit(input) {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== 'object') return input;
    const output = {};
    for (const [key, item] of Object.entries(input)) {
      output[key] = secretKeys.test(key) ? '[REDACTED]' : visit(item);
    }
    return output;
  }
  return visit(value);
}
