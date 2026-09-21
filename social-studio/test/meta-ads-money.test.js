import { describe, expect, it } from 'vitest';
import { toMinorUnits, fromMinorUnits } from '../server/meta/ads/money.js';

describe('Meta ads money', () => {
  it('keeps KRW as zero-decimal minor units', () => {
    expect(toMinorUnits(20000, 'KRW')).toBe(20000);
    expect(fromMinorUnits(20000, 'KRW')).toBe(20000);
  });

  it('converts USD to cents without float drift', () => {
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(fromMinorUnits(1999, 'USD')).toBe(19.99);
  });
});
