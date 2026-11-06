import { describe, expect, it } from 'vitest';
import { calculateAppointmentBalance, calculateMovaPlatformFee, summarizeMoney } from './money.js';

describe('money ledger rules', () => {
  it('rounds a 1.5% fee half up on processed payments only', () => {
    expect(calculateMovaPlatformFee(10_000, 150, 'mova_processed')).toBe(150);
    expect(calculateMovaPlatformFee(100, 150, 'mova_processed')).toBe(2);
    expect(calculateMovaPlatformFee(10_000, 150, 'artist')).toBe(0);
    expect(calculateMovaPlatformFee(10_000, 150, 'salon')).toBe(0);
  });

  it('reconciles gross service value, collection, fees, refunds and estimated earnings', () => {
    expect(summarizeMoney([
      { category: 'service_value', amount_minor: 25_000 },
      { category: 'mova_processed', amount_minor: 10_000 },
      { category: 'recorded_artist', amount_minor: 5_000 },
      { category: 'collected_salon', amount_minor: 10_000 },
      { category: 'mova_platform_fee', amount_minor: -150 },
      { category: 'processor_fee', amount_minor: -320 },
      { category: 'refund', amount_minor: -1_000 },
    ])).toEqual({
      service_value_minor: 25_000,
      mova_processed_minor: 10_000,
      recorded_by_artist_minor: 5_000,
      collected_by_salon_minor: 10_000,
      mova_platform_fee_minor: -150,
      processor_fee_minor: -320,
      refunds_minor: -1_000,
      estimated_to_artist_minor: 13_530,
    });
  });

  it('reopens balance for refunded amounts without exceeding the gross value', () => {
    expect(calculateAppointmentBalance(15_000, 4_000, 0)).toBe(11_000);
    expect(calculateAppointmentBalance(15_000, 15_000, 4_000)).toBe(4_000);
  });
});
