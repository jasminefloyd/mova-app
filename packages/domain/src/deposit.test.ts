import { describe, expect, it } from 'vitest';
import { depositAmount } from './deposit.js';

describe('depositAmount', () => {
  it.each([
    [15_000, { type: 'percent', basisPoints: 2_500 }, 3_750],
    [9_999, { type: 'percent', basisPoints: 3_333 }, 3_333],
    [1, { type: 'percent', basisPoints: 5_000 }, 1],
    [15_000, { type: 'percent', basisPoints: 10_000 }, 15_000],
    [15_000, { type: 'fixed', amountMinor: 20_000 }, 15_000],
    [15_000, { type: 'fixed', amountMinor: 4_000 }, 4_000],
    [15_000, { type: 'none' }, 0],
  ] as const)('computes %i with policy to %i minor units', (price, policy, expected) => {
    expect(depositAmount(price, policy, 'artist')).toBe(expected);
  });

  it('returns zero when the salon collects payment', () => {
    expect(depositAmount(15_000, { type: 'percent', basisPoints: 5_000 }, 'salon')).toBe(0);
  });

  it('rejects invalid input amounts and rates', () => {
    expect(() => depositAmount(-1, { type: 'none' }, 'artist')).toThrow(RangeError);
    expect(() => depositAmount(100, { type: 'percent', basisPoints: 10_001 }, 'artist')).toThrow(RangeError);
  });
});
