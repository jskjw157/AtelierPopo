import { describe, expect, it } from 'vitest';
import { canonicalize, payloadHash } from '../server/meta/ads/canonical.js';

describe('approval payload canonicalization', () => {
  it('hashes equivalent object key order identically', () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
