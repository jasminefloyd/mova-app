// Reduces a Stripe account object to the payout facts the stylist sees on board 16b.
// Only non-secret display fields leave the Edge Function: never the account or bank IDs.
export type PayoutSummary = {
  bank_last4: string | null;
  bank_name: string | null;
  interval: 'manual' | 'daily' | 'weekly' | 'monthly' | null;
  weekly_anchor: string | null;
  monthly_anchor: number | null;
  delay_days: number | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function summarizePayouts(account: unknown): PayoutSummary {
  const root = record(account);
  const externals = record(root?.external_accounts);
  const list = Array.isArray(externals?.data) ? externals.data.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  const bank = list.find((item) => item.default_for_currency === true) ?? list[0] ?? null;
  const last4 = typeof bank?.last4 === 'string' && /^\d{4}$/.test(bank.last4) ? bank.last4 : null;
  const bankName = typeof bank?.bank_name === 'string' ? bank.bank_name.slice(0, 60) : null;
  const schedule = record(record(record(root?.settings)?.payouts)?.schedule);
  const interval = schedule?.interval;
  return {
    bank_last4: last4,
    bank_name: last4 ? bankName : null,
    interval: interval === 'manual' || interval === 'daily' || interval === 'weekly' || interval === 'monthly' ? interval : null,
    weekly_anchor: typeof schedule?.weekly_anchor === 'string' ? schedule.weekly_anchor : null,
    monthly_anchor: typeof schedule?.monthly_anchor === 'number' ? schedule.monthly_anchor : null,
    delay_days: typeof schedule?.delay_days === 'number' ? schedule.delay_days : null,
  };
}
