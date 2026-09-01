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

function pickMethod(gateway, names) {
  for (const name of names) {
    if (typeof gateway?.[name] === 'function') return gateway[name].bind(gateway);
  }
  return null;
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

  async read(descriptor, context = {}) {
    const invoke = pickMethod(this.gateway, ['execute', 'executeOperation', 'invoke', 'call']);
    if (!invoke) throw new SearchAdWriteError('SEARCHAD_GATEWAY_EXECUTE_UNAVAILABLE', 'SearchAd gateway 실행 메서드를 찾을 수 없습니다.', {}, 503);
    const result = await invoke(operationInput(descriptor, context));
    return { raw: result, value: unwrapSearchAdRemoteResult(result) };
  }

  async mutate(descriptor, context = {}) {
    const invoke = pickMethod(this.gateway, ['execute', 'executeOperation', 'invoke', 'call']);
    if (!invoke) throw new SearchAdWriteError('SEARCHAD_GATEWAY_EXECUTE_UNAVAILABLE', 'SearchAd gateway 실행 메서드를 찾을 수 없습니다.', {}, 503);
    return invoke(operationInput(descriptor, context));
  }
}
