import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n, { i18nReady } from '../../i18n';
import { ForecastMethod, isForecastInputs } from './ForecastMethod';

const inputs = { bookedMinor: 486000, remainingHours: [12], fillRates: [0.5], avgTicketPerHourMinor: [9000], openLowMinor: 30000, openHighMinor: 90000, dueClients: 6, rebookConversion: 0.5, averageTicketMinor: 15000, rebookLowMinor: 15000, rebookHighMinor: 45000, usualMonthsMinor: [650000, 700000, 720000] };
const render = (value: unknown) => { const host = document.createElement('div'); act(() => createRoot(host).render(<ForecastMethod inputs={value} />)); return host; };

describe('ForecastMethod (task 5.6)', () => {
  beforeAll(async () => { await i18nReady; });
  it('shows each figure with its arithmetic', async () => {
    await i18n.changeLanguage('en-US');
    const text = render(inputs).textContent ?? '';
    expect(text).toContain('12 open hours × 50% usually filled × $90 per hour = $540');
    expect(text).toContain('6 clients due × 50% usually rebook × $150 average visit');
    expect(text).toContain('$5,850');
    expect(text).toContain('Average of your last three complete months: $6,500, $7,000, $7,200.');
  });
  it('explains in Spanish', async () => {
    await i18n.changeLanguage('es-US');
    try { expect(render(inputs).textContent).toMatch(/12 horas libres × 50\s?% que sueles llenar/); }
    finally { await i18n.changeLanguage('en-US'); }
  });
  it('says when no forecast exists instead of showing numbers', () => {
    expect(isForecastInputs({ bookedMinor: 'x' })).toBe(false);
    expect(render(null).textContent).toContain('Your first estimate appears');
  });
});
