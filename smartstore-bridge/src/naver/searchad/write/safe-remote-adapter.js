import { SearchAdGatewayRemoteAdapter } from './remote-adapter.js';
import { sanitizeSearchAdRemoteError } from './redaction.js';

export class SafeSearchAdGatewayRemoteAdapter extends SearchAdGatewayRemoteAdapter {
  constructor(options) { super(options); this.readAdapter=options.readGateway ? new SearchAdGatewayRemoteAdapter({gateway:options.readGateway}) : null; }
  async read(descriptor, context = {}) {
    try {
      return await (this.readAdapter ? this.readAdapter.read(descriptor,context) : super.read(descriptor, context));
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
