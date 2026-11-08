import { describe, expect, it } from 'vitest';
import { isWaitlistEnabled } from './waitlist-flag.ts';

describe('waitlist launch flag', () => {
  it('remains closed unless explicitly enabled with the exact true value', () => {
    expect(isWaitlistEnabled(undefined)).toBe(false);
    expect(isWaitlistEnabled('')).toBe(false);
    expect(isWaitlistEnabled('false')).toBe(false);
    expect(isWaitlistEnabled('TRUE')).toBe(false);
    expect(isWaitlistEnabled('true')).toBe(true);
  });
});
