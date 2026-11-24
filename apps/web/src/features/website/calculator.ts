// W4·v2 calculator: commission, booth rental and suite rental, after costs and estimated taxes.
// Pure functions, so the page and the tests share the same arithmetic. Nothing here leaves the browser.

export type Setup = 'commission' | 'booth' | 'suite';
export const SETUPS: Setup[] = ['commission', 'booth', 'suite'];

/** Every field is the raw text of an input, so a half-typed number never breaks the page. */
export type CalculatorInput = {
  setups: Record<Setup, boolean>;
  revenue: string; tips: string;
  hours: string; weeksOff: string;
  split: string; commissionPay: 'w2' | '1099'; backbar: string; tools: string;
  rentPeriod: 'week' | 'month'; boothRent: string; suiteRent: string;
  products: string; cardFees: string; insurance: string; license: string; software: string; education: string; otherCosts: string;
  taxes: boolean; incomeTax: string;
  perks: string;
};

export const DEFAULT_INPUT: CalculatorInput = {
  setups: { commission: true, booth: true, suite: true },
  revenue: '1500', tips: '200',
  hours: '36', weeksOff: '4',
  split: '40', commissionPay: 'w2', backbar: '0', tools: '20',
  rentPeriod: 'week', boothRent: '300', suiteRent: '450',
  products: '120', cardFees: '3', insurance: '10', license: '3', software: '15', education: '15', otherCosts: '0',
  taxes: true, incomeTax: '15',
  perks: '60',
};

export const PAYROLL_TAX = 0.0765;
export const SE_TAX = 0.153;
export const SE_BASE = 0.9235;
const WEEKS_PER_MONTH = 52 / 12;

export type Numbers = {
  revenue: number; tips: number; hours: number; weeksOff: number;
  split: number; commissionPay: 'w2' | '1099'; backbar: number; tools: number;
  boothRent: number; suiteRent: number;
  products: number; cardFees: number; insurance: number; license: number; software: number; education: number; otherCosts: number;
  taxes: boolean; incomeTax: number; perks: number;
};

export type InputProblem = { field: keyof CalculatorInput; kind: 'missing' | 'negative' | 'percent' | 'weeks' | 'hours' };

const NUMBER_FIELDS = ['revenue', 'tips', 'hours', 'weeksOff', 'split', 'backbar', 'tools', 'boothRent', 'suiteRent', 'products',
  'cardFees', 'insurance', 'license', 'software', 'education', 'otherCosts', 'incomeTax', 'perks'] as const;
const PERCENT_FIELDS = new Set<string>(['split', 'cardFees', 'incomeTax']);

/** Reads the inputs. Blank optional costs count as zero; revenue and hours must be filled in. */
export function readInput(input: CalculatorInput): { ok: true; numbers: Numbers } | { ok: false; problem: InputProblem } {
  const values: Record<string, number> = {};
  for (const field of NUMBER_FIELDS) {
    const raw = input[field].trim();
    const required = field === 'revenue' || field === 'hours';
    if (raw === '') {
      if (required) return { ok: false, problem: { field, kind: 'missing' } };
      values[field] = 0;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, problem: { field, kind: 'missing' } };
    if (value < 0) return { ok: false, problem: { field, kind: 'negative' } };
    if (PERCENT_FIELDS.has(field) && value > 100) return { ok: false, problem: { field, kind: 'percent' } };
    values[field] = value;
  }
  if (values.weeksOff! > 51) return { ok: false, problem: { field: 'weeksOff', kind: 'weeks' } };
  if (values.hours! <= 0 || values.hours! > 100) return { ok: false, problem: { field: 'hours', kind: 'hours' } };
  const rent = (value: number) => (input.rentPeriod === 'month' ? value / WEEKS_PER_MONTH : value);
  return {
    ok: true,
    numbers: {
      revenue: values.revenue!, tips: values.tips!, hours: values.hours!, weeksOff: values.weeksOff!,
      split: values.split! / 100, commissionPay: input.commissionPay, backbar: values.backbar!, tools: values.tools!,
      boothRent: rent(values.boothRent!), suiteRent: rent(values.suiteRent!),
      products: values.products!, cardFees: values.cardFees! / 100, insurance: values.insurance!, license: values.license!,
      software: values.software!, education: values.education!, otherCosts: values.otherCosts!,
      taxes: input.taxes, incomeTax: values.incomeTax! / 100, perks: values.perks!,
    },
  };
}

/** One week in one setup. Costs and taxes are positive amounts that were taken out. */
export type Week = {
  setup: Setup;
  revenue: number; tips: number;
  salonCut: number; rent: number; products: number; tools: number; backbar: number; fixedCosts: number; cardFees: number;
  payrollTax: number; selfEmploymentTax: number; incomeTax: number;
  takeHome: number; perks: number;
};

const selfEmployed = (profit: number, n: Numbers) => {
  if (!n.taxes || profit <= 0) return { se: 0, income: 0 };
  const se = profit * SE_BASE * SE_TAX;
  return { se, income: Math.max(0, profit - se / 2) * n.incomeTax };
};

export function week(setup: Setup, n: Numbers): Week {
  const base = { setup, revenue: n.revenue, tips: n.tips, salonCut: 0, rent: 0, products: 0, tools: 0, backbar: 0, fixedCosts: 0, cardFees: 0,
    payrollTax: 0, selfEmploymentTax: 0, incomeTax: 0, takeHome: 0, perks: 0 };
  if (setup === 'commission') {
    const salonCut = n.revenue * n.split;
    const gross = n.revenue - salonCut + n.tips;
    const costs = n.tools + n.backbar;
    if (n.commissionPay === 'w2') {
      // W-2: the salon pays the other half of Social Security and Medicare. Income tax on gross pay.
      const payrollTax = n.taxes ? gross * PAYROLL_TAX : 0;
      const incomeTax = n.taxes ? gross * n.incomeTax : 0;
      return { ...base, salonCut, tools: n.tools, backbar: n.backbar, payrollTax, incomeTax, takeHome: gross - costs - payrollTax - incomeTax, perks: n.perks };
    }
    const profit = gross - costs;
    const tax = selfEmployed(profit, n);
    return { ...base, salonCut, tools: n.tools, backbar: n.backbar, selfEmploymentTax: tax.se, incomeTax: tax.income,
      takeHome: profit - tax.se - tax.income, perks: n.perks };
  }
  const rent = setup === 'booth' ? n.boothRent : n.suiteRent;
  const fixedCosts = n.insurance + n.license + n.software + n.education + n.otherCosts;
  const cardFees = n.revenue * n.cardFees;
  const profit = n.revenue + n.tips - rent - n.products - fixedCosts - cardFees;
  const tax = selfEmployed(profit, n);
  return { ...base, rent, products: n.products, fixedCosts, cardFees, selfEmploymentTax: tax.se, incomeTax: tax.income,
    takeHome: profit - tax.se - tax.income };
}

export const workingWeeks = (n: Numbers) => 52 - n.weeksOff;

export type Verdict =
  | { kind: 'one' }
  | { kind: 'even'; first: Setup; second: Setup }
  | { kind: 'leader'; first: Setup; second: Setup; yearly: number }
  /** Cash leader is an independent setup, but commission wins once the salon's perks are counted. */
  | { kind: 'perks'; cashLeader: Setup; cashYearly: number; perksYearly: number };

/** Under this many dollars a year apart, two setups are called about the same. */
export const EVEN_YEARLY = 250;

export function verdict(weeks: Week[], n: Numbers): Verdict {
  if (weeks.length < 2) return { kind: 'one' };
  const ww = workingWeeks(n);
  const byCash = [...weeks].sort((a, b) => b.takeHome - a.takeHome);
  const [first, second] = byCash as [Week, Week];
  const commission = weeks.find((w) => w.setup === 'commission');
  if (commission && first.setup !== 'commission' && commission.perks > 0) {
    const withPerks = commission.takeHome + commission.perks;
    if (withPerks - first.takeHome >= EVEN_YEARLY / ww) {
      return { kind: 'perks', cashLeader: first.setup, cashYearly: (first.takeHome - commission.takeHome) * ww, perksYearly: (withPerks - first.takeHome) * ww };
    }
  }
  const yearly = (first.takeHome - second.takeHome) * ww;
  if (yearly < EVEN_YEARLY) return { kind: 'even', first: first.setup, second: second.setup };
  return { kind: 'leader', first: first.setup, second: second.setup, yearly };
}

export type BreakEven =
  | { kind: 'revenue'; amount: number; above: Setup; below: Setup }
  | { kind: 'never'; ahead: Setup };

/** Weekly service revenue at which two setups pay the same (perks optional). Searched, since taxes stop at zero profit. */
export function breakEven(a: Setup, b: Setup, n: Numbers, withPerks = false): BreakEven {
  const diff = (revenue: number) => {
    const m = { ...n, revenue };
    const wa = week(a, m); const wb = week(b, m);
    return (wa.takeHome + (withPerks ? wa.perks : 0)) - (wb.takeHome + (withPerks ? wb.perks : 0));
  };
  const max = Math.max(20000, n.revenue * 4);
  const steps = 400;
  let previous = diff(0);
  for (let i = 1; i <= steps; i += 1) {
    const r = (max * i) / steps;
    const current = diff(r);
    if (previous === 0) return { kind: 'revenue', amount: (max * (i - 1)) / steps, above: current >= 0 ? a : b, below: current >= 0 ? b : a };
    if ((previous < 0) !== (current < 0)) {
      let lo = (max * (i - 1)) / steps; let hi = r;
      for (let k = 0; k < 40; k += 1) { const mid = (lo + hi) / 2; if ((diff(mid) < 0) === (previous < 0)) lo = mid; else hi = mid; }
      return { kind: 'revenue', amount: (lo + hi) / 2, above: current > 0 ? a : b, below: current > 0 ? b : a };
    }
    previous = current;
  }
  return { kind: 'never', ahead: previous >= 0 ? a : b };
}

/** The pair the break-even chart compares: commission against the better-paying rental. */
export function breakEvenPair(selected: Setup[], n: Numbers): [Setup, Setup] | null {
  const rentals = selected.filter((s) => s !== 'commission');
  if (!selected.includes('commission') || !rentals.length) return null;
  const best = rentals.sort((x, y) => week(y, n).takeHome - week(x, n).takeHome)[0]!;
  return ['commission', best];
}

/** Weekly take-home for each setup across a range of weekly revenue, for the chart. */
export function series(setups: Setup[], n: Numbers, from: number, to: number, points = 25) {
  return setups.map((setup) => ({
    setup,
    points: Array.from({ length: points }, (_, i) => {
      const revenue = from + ((to - from) * i) / (points - 1);
      return { revenue, takeHome: week(setup, { ...n, revenue }).takeHome };
    }),
  }));
}

/** Rounded to whole dollars, with a true minus sign for losses. */
export function formatDollars(value: number, locale = 'en-US'): string {
  const sign = Math.round(value) < 0 ? '−' : '';
  return `${sign}$${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.abs(Math.round(value)))}`;
}

export function formatHourly(value: number): string {
  const sign = value < 0 ? '−' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}
