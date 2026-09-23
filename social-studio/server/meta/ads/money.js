// Budget inputs must be exact. Do not guess an offset for an unknown currency.
const EXPONENTS = Object.freeze({ KRW: 0, JPY: 0, USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, SGD: 2, HKD: 2 });
export function currencyExponent(currency) {
  const code = String(currency || '').toUpperCase();
  if (!Object.hasOwn(EXPONENTS, code)) throw new RangeError('지원 여부가 확인되지 않은 광고 통화입니다.');
  return EXPONENTS[code];
}
export function toMinorUnits(amount, currency) {
  if (!['string','number'].includes(typeof amount)) throw new TypeError('예산은 숫자로 입력해 주세요.');
  const raw = String(amount).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new TypeError('예산은 0 이상의 십진수여야 합니다.');
  const exponent = currencyExponent(currency);
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) throw new RangeError('통화에서 지원하는 소수 자릿수를 초과했습니다.');
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.slice(0,exponent).padEnd(exponent,'0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('예산이 안전한 숫자 범위를 초과했습니다.');
  return Number(minor);
}
export function fromMinorUnits(value, currency) {
  if (!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value))) throw new TypeError('저장된 금액이 올바르지 않습니다.');
  const minor = Number(value);
  if (!Number.isSafeInteger(minor)) throw new RangeError('저장된 금액이 안전한 숫자 범위를 초과했습니다.');
  return minor / 10 ** currencyExponent(currency);
}
