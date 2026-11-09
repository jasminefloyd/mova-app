// Booth rent vs. commission, per week. Same arithmetic as the W4 board. Nothing here leaves the browser.

export type CalculatorInput = { revenue: string; commissionCut: string; rent: string; expenses: string };

export type CalculatorResult =
  | { status: 'incomplete' | 'negative' | 'commission-range' }
  | {
    status: 'ok';
    commission: number;
    booth: number;
    /** booth minus commission. Positive means booth rental keeps more. */
    difference: number;
    /** Share of the larger amount, used for the bar widths (0 to 100). */
    commissionBar: number;
    boothBar: number;
  };

function parse(value: string): number {
  if (value.trim() === '') return Number.NaN;
  return Number(value);
}

export function calculate(input: CalculatorInput): CalculatorResult {
  const values = [parse(input.revenue), parse(input.commissionCut), parse(input.rent), parse(input.expenses)];
  if (values.some((value) => Number.isNaN(value))) return { status: 'incomplete' };
  if (values.some((value) => value < 0)) return { status: 'negative' };
  const [revenue, cut, rent, expenses] = values as [number, number, number, number];
  if (cut > 100) return { status: 'commission-range' };

  const commission = revenue * (1 - cut / 100) - expenses;
  const booth = revenue - rent - expenses;
  const largest = Math.max(Math.abs(commission), Math.abs(booth), 1);
  const bar = (value: number) => (Math.max(0, value) / largest) * 100;
  return {
    status: 'ok',
    commission,
    booth,
    difference: booth - commission,
    commissionBar: bar(commission),
    boothBar: bar(booth),
  };
}

/** Rounded to whole dollars, with a true minus sign for losses. Locale only changes the digit grouping. */
export function formatDollars(value: number, locale: string): string {
  const sign = value < 0 ? '−' : '';
  return `${sign}$${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.abs(Math.round(value)))}`;
}
