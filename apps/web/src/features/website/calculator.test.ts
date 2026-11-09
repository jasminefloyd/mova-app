import { describe, expect, it } from 'vitest';
import { calculate, formatDollars } from './calculator';

const base = { revenue: '1500', commissionCut: '40', rent: '300', expenses: '150' };

describe('booth rent vs commission calculator', () => {
  it('matches the board example: 1500 revenue, 40% cut, 300 rent, 150 expenses', () => {
    const result = calculate(base);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.commission).toBeCloseTo(1500 * 0.6 - 150);
    expect(result.booth).toBe(1500 - 300 - 150);
    expect(result.difference).toBeCloseTo(1050 - 750);
    expect(result.commissionBar).toBeCloseTo((750 / 1050) * 100);
    expect(result.boothBar).toBe(100);
  });

  it('reports incomplete input when any field is blank or not a number', () => {
    expect(calculate({ ...base, rent: '' })).toEqual({ status: 'incomplete' });
    expect(calculate({ ...base, revenue: 'abc' })).toEqual({ status: 'incomplete' });
  });

  it('rejects negative numbers and a commission above 100%', () => {
    expect(calculate({ ...base, expenses: '-1' })).toEqual({ status: 'negative' });
    expect(calculate({ ...base, commissionCut: '101' })).toEqual({ status: 'commission-range' });
  });

  it('keeps bars at zero for a negative result instead of drawing backwards', () => {
    const result = calculate({ revenue: '100', commissionCut: '50', rent: '500', expenses: '0' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.boothBar).toBe(0);
  });

  it('formats whole dollars with a true minus sign for losses', () => {
    expect(formatDollars(1234.6, 'en-US')).toBe('$1,235');
    expect(formatDollars(-80, 'en-US')).toBe('−$80');
  });
});
