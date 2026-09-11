import { SearchAdWriteError } from '../write/errors.js';

function normalizeDescriptor(descriptor = {}) {
  const operationKey = String(descriptor.operationKey || '').trim();
  const nested = descriptor.input && typeof descriptor.input === 'object' && !Array.isArray(descriptor.input)
    ? descriptor.input
    : descriptor;
  if (!operationKey) {
    throw new SearchAdWriteError('SEARCHAD_CANARY_OPERATION_REQUIRED', 'Active Canary operationKey is required.', {}, 500);
  }
  return {
    operationKey,
    input: {
      customerId: nested.customerId,
      pathParams: nested.pathParams || {},
      query: nested.query || {},
      body: nested.body ?? nested.json,
      responseType: nested.responseType || 'auto'
    }
  };
}

export class ActiveCanaryGatewayRemoteAdapter {
  constructor({ gateway } = {}) {
    if (!gateway?.get || !gateway?.execute || !gateway?.executeCanary) {
      throw new SearchAdWriteError(
        'SEARCHAD_CANARY_GATEWAY_REQUIRED',
        'Active Canary requires a SearchAd gateway with get/execute/executeCanary.',
        {},
        503
      );
    }
    this.gateway = gateway;
  }

  async read(descriptor) {
    const { operationKey, input } = normalizeDescriptor(descriptor);
    const operation = this.gateway.get(operationKey);
    if (operation.sideEffect) {
      throw new SearchAdWriteError(
        'SEARCHAD_CANARY_READ_OPERATION_REQUIRED',
        'Active Canary read adapter accepts only side-effect-free operations.',
        { operationKey },
        500
      );
    }
    return this.gateway.execute(operationKey, input);
  }

  async mutate(descriptor) {
    const { operationKey, input } = normalizeDescriptor(descriptor);
    const operation = this.gateway.get(operationKey);
    if (!operation.sideEffect) {
      throw new SearchAdWriteError(
        'SEARCHAD_CANARY_MUTATION_OPERATION_REQUIRED',
        'Active Canary mutation adapter accepts only side-effect operations.',
        { operationKey },
        500
      );
    }

    // Caller/recipe-provided confirmation values are deliberately ignored.
    // The pinned manifest is the authority for confirmation requirements.
    const executionInput = {
      ...input,
      confirmation: operation.confirmation || undefined
    };
    if (operation.destructive) {
      const preview = this.gateway.preview(operationKey, executionInput);
      executionInput.secondConfirmation = preview.requiredSecondConfirmation;
    }
    return this.gateway.executeCanary(operationKey, executionInput);
  }
}

export const _internal = { normalizeDescriptor };
