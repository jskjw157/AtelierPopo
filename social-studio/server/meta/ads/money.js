const ZERO_DECIMAL_CURRENCIES = new Set(['KRW', 'JPY']);

export function currencyExponent(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(String(currency || '').toUpperCase()) ? 0 : 2;
}

function decimalToMinorString(amount, exponent) {
  const raw = String(amount).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new TypeError('Amount must be a decimal number.');
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = (fraction + '0'.repeat(exponent + 1));
  const kept = exponent ? padded.slice(0, exponent) : '';
  const nextDigit = Number(padded[exponent] || '0');
  let minor = BigInt(whole) * (10n ** BigInt(exponent)) + BigInt(kept || '0');
  if (nextDigit >= 5) minor += 1n;
  if (negative) minor *= -1n;
  const number = Number(minor);
  if (!Number.isSafeInteger(number)) throw new RangeError('Amount exceeds safe integer range.');
  return number;
}

export function toMinorUnits(amount, currency) {
  if (amount == null || amount === '') throw new TypeError('Amount is required.');
  return decimalToMinorString(amount, currencyExponent(currency));
}

export function fromMinorUnits(amountMinor, currency) {
  const minor = Number(amountMinor);
  if (!Number.isSafeInteger(minor)) throw new TypeError('Minor amount must be a safe integer.');
  const exponent = currencyExponent(currency);
  if (!exponent) return minor;
  return minor / (10 ** exponent);
}
