import { describe, expect, it } from 'vitest';
import { summarizePayouts } from './payouts';

describe('summarizePayouts (task 3.2)', () => {
  it('reads the default bank and payout schedule without leaking IDs', () => {
    const summary = summarizePayouts({
      id: 'acct_fixture',
      external_accounts: { data: [
        { id: 'ba_other', last4: '1111', bank_name: 'Other Bank', default_for_currency: false },
        { id: 'ba_main', last4: '4821', bank_name: 'STRIPE TEST BANK', default_for_currency: true },
      ] },
      settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'friday', delay_days: 2 } } },
    });
    expect(summary).toEqual({ bank_last4: '4821', bank_name: 'STRIPE TEST BANK', interval: 'weekly', weekly_anchor: 'friday', monthly_anchor: null, delay_days: 2 });
    expect(JSON.stringify(summary)).not.toMatch(/acct_|ba_/);
  });

  it('returns nulls when Stripe does not share bank details', () => {
    expect(summarizePayouts({ settings: { payouts: { schedule: { interval: 'daily' } } } })).toMatchObject({ bank_last4: null, bank_name: null, interval: 'daily' });
    expect(summarizePayouts(null)).toMatchObject({ bank_last4: null, interval: null });
  });

  it('rejects malformed values', () => {
    expect(summarizePayouts({ external_accounts: { data: [{ last4: '12ab' }] }, settings: { payouts: { schedule: { interval: 'hourly' } } } }))
      .toMatchObject({ bank_last4: null, interval: null });
  });
});
