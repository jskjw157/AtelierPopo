import { describe, expect, it } from 'vitest';
import { canonicalize, payloadHash } from '../server/meta/ads/canonical.js';

describe('approval payload canonicalization', () => {
  it('hashes equivalent object key order identically', () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});

it.each([NaN,Infinity,undefined,{a:undefined},{a:NaN},new Date(),[undefined]])('rejects lossy non-JSON approval input %#', value => {
  expect(() => canonicalize(value)).toThrow();
});
it('preserves array order and nested changes in the approval hash', () => {
  expect(payloadHash({a:[1,2]})).not.toBe(payloadHash({a:[2,1]}));
});
