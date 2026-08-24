export class NaverApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NaverApiError';
    this.status = details.status;
    this.code = details.code;
    this.invalidInputs = details.invalidInputs;
    this.traceId = details.traceId;
    this.body = details.body;
    this.headers = details.headers;
    this.url = details.url;
    this.method = details.method;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      invalidInputs: this.invalidInputs,
      traceId: this.traceId,
      method: this.method,
      url: this.url
    };
  }
}
