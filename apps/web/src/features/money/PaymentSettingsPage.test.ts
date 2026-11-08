import { describe, expect, it } from 'vitest';
import { formatFeePercent, stripeState } from './PaymentSettingsPage';

const row = (status: string, charges_enabled = false) => ({ account_type: 'standard', status, charges_enabled, payouts_enabled: false, details_submitted: true });

describe('stripeState', () => {
  it('treats no row, not_connected and disconnected as not set up', () => {
    expect(stripeState(null)).toBe('not_connected');
    expect(stripeState(row('not_connected'))).toBe('not_connected');
    expect(stripeState(row('disconnected'))).toBe('not_connected');
  });
  it('maps pending and restricted directly', () => {
    expect(stripeState(row('pending'))).toBe('pending');
    expect(stripeState(row('restricted', true))).toBe('restricted');
  });
  it('only shows active when charges are enabled', () => {
    expect(stripeState(row('active', true))).toBe('active');
    expect(stripeState(row('active', false))).toBe('pending');
  });
});

describe('formatFeePercent', () => {
  it('formats basis points for each locale', () => {
    expect(formatFeePercent(150, 'en-US')).toBe('1.5%');
    expect(formatFeePercent(150, 'es-US')).toMatch(/^1\.5\s?%$/);
  });
});
