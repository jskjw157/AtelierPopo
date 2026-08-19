export class NaverApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NaverApiError';
    this.status = details.status;
    this.code = details.code;
    this.invalidInputs = details.invalidInputs;
    this.traceId = details.traceId;
    this.body = details.body;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      invalidInputs: this.invalidInputs,
      traceId: this.traceId
    };
  }
}
