import { SearchAdGatewayRemoteAdapter } from './remote-adapter.js';
import { sanitizeSearchAdRemoteError } from './redaction.js';

export class SafeSearchAdGatewayRemoteAdapter extends SearchAdGatewayRemoteAdapter {
  async read(descriptor, context = {}) {
    try {
      return await super.read(descriptor, context);
    } catch (error) {
      throw sanitizeSearchAdRemoteError(error);
    }
  }

  async mutate(descriptor, context = {}) {
    try {
      return await super.mutate(descriptor, context);
    } catch (error) {
      throw sanitizeSearchAdRemoteError(error);
    }
  }
}
