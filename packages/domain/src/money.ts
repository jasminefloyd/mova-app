export type MoneyLedgerCategory =
  | 'service_value'
  | 'mova_processed'
  | 'recorded_artist'
  | 'collected_salon'
  | 'mova_platform_fee'
  | 'processor_fee'
  | 'refund';

export type MoneyLedgerEntry = { category: MoneyLedgerCategory; amount_minor: number };
export type PaymentCollector = 'mova_processed' | 'artist' | 'salon';

export type MoneySummary = {
  service_value_minor: number;
  mova_processed_minor: number;
  recorded_by_artist_minor: number;
  collected_by_salon_minor: number;
  mova_platform_fee_minor: number;
  processor_fee_minor: number;
  refunds_minor: number;
  estimated_to_artist_minor: number;
};

export function calculateMovaPlatformFee(amountMinor: number, feeBps: number, collector: PaymentCollector) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError('AMOUNT_MINOR_INVALID');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new RangeError('FEE_BPS_INVALID');
  if (collector !== 'mova_processed' || amountMinor === 0 || feeBps === 0) return 0;
  return Math.floor((amountMinor * feeBps + 5_000) / 10_000);
}

export function summarizeMoney(entries: MoneyLedgerEntry[]): MoneySummary {
  const totals: MoneySummary = {
    service_value_minor: 0,
    mova_processed_minor: 0,
    recorded_by_artist_minor: 0,
    collected_by_salon_minor: 0,
    mova_platform_fee_minor: 0,
    processor_fee_minor: 0,
    refunds_minor: 0,
    estimated_to_artist_minor: 0,
  };
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amount_minor)) throw new RangeError('LEDGER_AMOUNT_INVALID');
    switch (entry.category) {
      case 'service_value': totals.service_value_minor += entry.amount_minor; break;
      case 'mova_processed': totals.mova_processed_minor += entry.amount_minor; break;
      case 'recorded_artist': totals.recorded_by_artist_minor += entry.amount_minor; break;
      case 'collected_salon': totals.collected_by_salon_minor += entry.amount_minor; break;
      case 'mova_platform_fee': totals.mova_platform_fee_minor += entry.amount_minor; break;
      case 'processor_fee': totals.processor_fee_minor += entry.amount_minor; break;
      case 'refund': totals.refunds_minor += entry.amount_minor; break;
    }
  }
  totals.estimated_to_artist_minor = totals.mova_processed_minor
    + totals.recorded_by_artist_minor
    + totals.mova_platform_fee_minor
    + totals.processor_fee_minor
    + totals.refunds_minor;
  return totals;
}

export function calculateAppointmentBalance(serviceValueMinor: number, successfulPaymentsMinor: number, refundsMinor: number) {
  for (const value of [serviceValueMinor, successfulPaymentsMinor, refundsMinor]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('APPOINTMENT_BALANCE_INPUT_INVALID');
  }
  return serviceValueMinor - successfulPaymentsMinor + refundsMinor;
}
