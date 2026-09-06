import { SearchAdWriteError } from './errors.js';

function operationInput(descriptor, context = {}) {
  return {
    operationKey: descriptor.operationKey,
    customerId: descriptor.customerId || context.customerId,
    pathParams: descriptor.pathParams || {},
    query: descriptor.query || {},
    body: descriptor.body ?? null,
    confirmation: descriptor.confirmation,
    secondConfirmation: descriptor.secondConfirmation,
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey
  };
}

export function unwrapSearchAdRemoteResult(result) {
  if (result == null) return result;
  if (Object.prototype.hasOwnProperty.call(result, 'body')) return result.body;
  if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
  if (Object.prototype.hasOwnProperty.call(result, 'response')) return result.response;
  return result;
}

export class SearchAdGatewayRemoteAdapter {
  constructor({ gateway }) {
    if (!gateway) throw new SearchAdWriteError('SEARCHAD_GATEWAY_REQUIRED', 'SearchAd gateway가 필요합니다.', {}, 503);
    this.gateway = gateway;
  }

  assertOperation(descriptor, sideEffect) {
    if (typeof this.gateway.get !== 'function' || typeof this.gateway.execute !== 'function') {
      throw new SearchAdWriteError('SEARCHAD_GATEWAY_EXECUTE_UNAVAILABLE', 'SearchAd gateway의 get/execute 계약이 필요합니다.', {}, 503);
    }
    const operation = this.gateway.get(descriptor.operationKey);
    // Use the manifest's effect classification, not HTTP method heuristics:
    // a public POST may be read-only, while a GET must not be assumed safe.
    if (operation.sideEffect !== sideEffect) {
      throw new SearchAdWriteError(
        sideEffect ? 'SEARCHAD_MUTATION_REQUIRED' : 'SEARCHAD_VERIFICATION_READ_REQUIRED',
        sideEffect ? '변경에는 공식 쓰기 operation이 필요합니다.' : '검증에는 부작용이 없는 공식 조회 operation만 사용할 수 있습니다.',
        { operationKey: descriptor.operationKey }
      );
    }
  }

  async read(descriptor, context = {}) {
    this.assertOperation(descriptor, false);
    const result = await this.gateway.execute(descriptor.operationKey, operationInput(descriptor, context));
    return { raw: result, value: unwrapSearchAdRemoteResult(result) };
  }

  async mutate(descriptor, context = {}) {
    this.assertOperation(descriptor, true);
    return this.gateway.execute(descriptor.operationKey, operationInput(descriptor, context));
  }
}
