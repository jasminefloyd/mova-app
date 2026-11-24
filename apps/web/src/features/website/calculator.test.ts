import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, breakEven, breakEvenPair, formatDollars, formatHourly, readInput, verdict, week, workingWeeks, type CalculatorInput, type Numbers } from './calculator';

// W4·v2a/v2b: the worked week on the boards. $1,500 services, $200 tips, 36 hours, 48 working weeks.
const numbers = (input: Partial<CalculatorInput> = {}): Numbers => {
  const read = readInput({ ...DEFAULT_INPUT, ...input });
  if (!read.ok) throw new Error(`unexpected problem ${JSON.stringify(read.problem)}`);
  return read.numbers;
};

describe('calculator v2', () => {
  it('matches the board week for all three setups', () => {
    const n = numbers();
    const c = week('commission', n); const b = week('booth', n); const s = week('suite', n);
    expect(c.salonCut).toBe(600);
    expect(c.payrollTax).toBeCloseTo(84.15, 2);
    expect(c.incomeTax).toBeCloseTo(165, 2);
    expect(c.takeHome).toBeCloseTo(830.85, 2);
    expect(b.cardFees).toBe(45);
    expect(b.fixedCosts).toBe(43);
    expect(b.selfEmploymentTax).toBeCloseTo(168.42, 2);
    expect(b.incomeTax).toBeCloseTo(166.17, 2);
    expect(b.takeHome).toBeCloseTo(857.41, 2);
    expect(s.takeHome).toBeCloseTo(749.51, 2);
    expect(workingWeeks(n)).toBe(48);
    expect(Math.round(b.takeHome * 48)).toBe(41156);
    expect((b.takeHome / 36).toFixed(2)).toBe('23.82');
  });

  it('says perks decide it when booth wins on cash but commission wins with perks', () => {
    const n = numbers();
    const v = verdict([week('commission', n), week('booth', n), week('suite', n)], n);
    expect(v.kind).toBe('perks');
    if (v.kind !== 'perks') return;
    expect(v.cashLeader).toBe('booth');
    expect(Math.round(v.cashYearly)).toBe(1275);
    expect(Math.round(v.perksYearly)).toBe(1605);
  });

  it('names the leader, or calls a near tie even', () => {
    const n = numbers({ perks: '0' });
    expect(verdict([week('commission', n), week('booth', n)], n)).toMatchObject({ kind: 'leader', first: 'booth', second: 'commission' });
    expect(verdict([week('booth', n)], n)).toEqual({ kind: 'one' });
    const close = numbers({ perks: '0', boothRent: '336' });
    expect(verdict([week('commission', close), week('booth', close)], close).kind).toBe('even');
  });

  it('finds the break-even revenue, with and without perks', () => {
    const n = numbers();
    const plain = breakEven('commission', 'booth', n);
    expect(plain.kind).toBe('revenue');
    if (plain.kind === 'revenue') { expect(Math.round(plain.amount)).toBe(1386); expect(plain.above).toBe('booth'); }
    const perks = breakEven('commission', 'booth', n, true);
    if (perks.kind === 'revenue') expect(Math.round(perks.amount)).toBe(1643);
    expect(breakEvenPair(['commission', 'booth', 'suite'], n)).toEqual(['commission', 'booth']);
    expect(breakEvenPair(['booth', 'suite'], n)).toBeNull();
  });

  it('handles a 1099 commission stylist, monthly rent and taxes switched off', () => {
    const contractor = week('commission', numbers({ commissionPay: '1099' }));
    expect(contractor.payrollTax).toBe(0);
    expect(contractor.selfEmploymentTax).toBeCloseTo((1100 - 20) * 0.9235 * 0.153, 2);
    const monthly = numbers({ rentPeriod: 'month', boothRent: '1300' });
    expect(monthly.boothRent).toBeCloseTo(300, 5);
    const untaxed = week('booth', numbers({ taxes: false }));
    expect(untaxed.takeHome).toBe(1192);
  });

  it('never taxes a loss', () => {
    const loss = week('suite', numbers({ revenue: '200', tips: '0' }));
    expect(loss.selfEmploymentTax).toBe(0);
    expect(loss.incomeTax).toBe(0);
    expect(loss.takeHome).toBeLessThan(0);
  });

  it('explains bad input', () => {
    expect(readInput({ ...DEFAULT_INPUT, revenue: '' })).toEqual({ ok: false, problem: { field: 'revenue', kind: 'missing' } });
    expect(readInput({ ...DEFAULT_INPUT, boothRent: '-5' })).toEqual({ ok: false, problem: { field: 'boothRent', kind: 'negative' } });
    expect(readInput({ ...DEFAULT_INPUT, split: '150' })).toEqual({ ok: false, problem: { field: 'split', kind: 'percent' } });
    expect(readInput({ ...DEFAULT_INPUT, weeksOff: '60' })).toEqual({ ok: false, problem: { field: 'weeksOff', kind: 'weeks' } });
    expect(readInput({ ...DEFAULT_INPUT, hours: '0' })).toEqual({ ok: false, problem: { field: 'hours', kind: 'hours' } });
    expect(readInput({ ...DEFAULT_INPUT, education: '' }).ok).toBe(true);
  });

  it('formats money', () => {
    expect(formatDollars(41155.6)).toBe('$41,156');
    expect(formatDollars(-20)).toBe('−$20');
    expect(formatHourly(23.8169)).toBe('$23.82');
  });
});
