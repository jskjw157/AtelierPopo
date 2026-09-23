import { createHash } from 'node:crypto';

export function canonicalize(value) {
  const seen = new Set();
  function visit(item) {
    if (item === null || ['string','boolean'].includes(typeof item)) return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || seen.has(item)) throw new TypeError('승인 내용은 유효한 JSON이어야 합니다.');
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      result = Array.from(item, visit);
    } else {
      if (![Object.prototype,null].includes(Object.getPrototypeOf(item))) throw new TypeError('승인 내용에 특수 객체를 넣을 수 없습니다.');
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError('승인 내용에 Symbol 키를 넣을 수 없습니다.');
      result = Object.fromEntries(Object.keys(item).sort().map(key => [key,visit(item[key])]));
    }
    seen.delete(item);
    return result;
  }
  return JSON.stringify(visit(value));
}
export function payloadHash(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}
