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

it.each([['0.5','KRW'], ['1.001','USD'], ['1','ZZZ'], ['-1','USD'], [true,'USD'], ['', 'USD'], ['9007199254740992','KRW']])('rejects ambiguous or invalid budget %s %s', (amount,currency) => {
  expect(() => toMinorUnits(amount,currency)).toThrow();
});
it.each([null, '', true, '1.1', '9007199254740992'])('rejects invalid stored minor units %s', value => {
  expect(() => fromMinorUnits(value,'USD')).toThrow();
});
