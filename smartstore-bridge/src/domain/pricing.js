import { parseWon } from './queensilver.js';

export function roundWithEnding(value, unit = 1000, ending = 900) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`유효하지 않은 가격: ${value}`);
  const normalizedUnit = Math.max(1, Math.trunc(unit));
  const normalizedEnding = Math.max(0, Math.trunc(ending));
  const bucket = Math.ceil((value - normalizedEnding) / normalizedUnit);
  return Math.max(normalizedEnding, bucket * normalizedUnit + normalizedEnding);
}

export function calculateSalePrice(sourcePriceDisplay, config = {}) {
  const sourceNetPrice = parseWon(sourcePriceDisplay);
  if (config.mode === 'manual') {
    throw new Error('pricing.mode가 manual입니다. 상품별 판매가 입력 기능을 추가하거나 markup 모드로 변경하세요.');
  }
  if (config.mode !== 'markup') throw new Error(`지원하지 않는 가격 모드: ${config.mode}`);

  const vatMultiplier = config.sourcePriceIncludesVat ? 1 : 1 + Number(config.vatRate ?? 0.1);
  const grossSourcePrice = sourceNetPrice * vatMultiplier;
  const raw = grossSourcePrice * Number(config.multiplier ?? 1) + Number(config.flatFee ?? 0);
  const rounded = roundWithEnding(raw, Number(config.roundUnit ?? 1000), Number(config.ending ?? 900));
  const salePrice = Math.max(Number(config.minimumPrice ?? 0), rounded);

  return {
    sourceNetPrice,
    grossSourcePrice: Math.round(grossSourcePrice),
    rawPrice: Math.round(raw),
    salePrice: Math.round(salePrice)
  };
}
