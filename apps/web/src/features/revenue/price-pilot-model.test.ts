import { describe, expect, it } from 'vitest';
import { buildPriceEvidence, buildPriceEvidenceDetails, findComparableObservations, type PricePilotObservation } from './price-pilot-model';

const now = Date.parse('2026-11-13T12:00:00Z');
function observation(index: number, price: number, overrides: Partial<PricePilotObservation> = {}): PricePilotObservation {
  return {
    id: `item-${index}`, source_id: `source-${index}`, service_name: `Silk service ${index}`, category: 'Silk press', duration_minutes: 90,
    price_min_minor: price, price_max_minor: price, currency: 'USD', extraction_confidence: 0.9,
    observed_at: '2026-11-01T12:00:00Z', geographic_match: true, geographic_match_scope: 'postal_code_region', mova_price_pilot_sources: { normalized_host: `salon-${index}.example`, submitted_url: `https://salon-${index}.example/menu` }, ...overrides,
  };
}

describe('PricePilot evidence band', () => {
  it('returns the middle half and median from five distinct recent matching menus', () => {
    const rows = [50, 60, 70, 80, 90].map((price, index) => observation(index, price * 100));
    expect(buildPriceEvidence(rows, { name: 'silk', category: 'silk press', durationMinutes: 90, currency: 'USD' }, now)).toEqual({ count: 5, low: 6000, median: 7000, high: 8000 });
  });

  it('withholds a comparison below five independent hosts and ignores duplicate hosts', () => {
    const rows = [50, 60, 70, 80, 90].map((price, index) => observation(index, price * 100));
    rows[4] = observation(4, 9000, { mova_price_pilot_sources: { normalized_host: 'salon-3.example', submitted_url: 'https://salon-3.example/another-menu' } });
    expect(buildPriceEvidence(rows, { name: 'silk', category: 'silk press', durationMinutes: 90, currency: 'USD' }, now)).toBeNull();
  });

  it('excludes mismatched duration, category, currency, low confidence and stale data', () => {
    const rows = [50, 60, 70, 80, 90].map((price, index) => observation(index, price * 100));
    rows[0] = observation(0, 5000, { duration_minutes: 60 });
    rows[1] = observation(1, 6000, { category: 'Color' });
    rows[2] = observation(2, 7000, { currency: 'CAD' });
    rows[3] = observation(3, 8000, { extraction_confidence: 0.6 });
    rows[4] = observation(4, 9000, { observed_at: '2026-08-01T12:00:00Z' });
    expect(buildPriceEvidence(rows, { name: 'silk', category: 'silk press', durationMinutes: 90, currency: 'USD' }, now)).toBeNull();
  });

  it('accepts nearby ZIP matches in the same region', () => {
    const rows = [50, 60, 70, 80, 90].map((price, index) => observation(index, price * 100, { geographic_match_scope: 'nearby_postal_code' }));
    expect(buildPriceEvidence(rows, { name: 'silk', category: 'silk press', durationMinutes: 90, currency: 'USD' }, now)).toEqual({ count: 5, low: 6000, median: 7000, high: 8000 });
  });

  it('allows durations within 15 minutes and rejects larger gaps', () => {
    const near = observation(0, 6000, { duration_minutes: 105 });
    const far = observation(1, 6000, { duration_minutes: 120 });
    const target = { name: 'silk', category: 'silk press', durationMinutes: 90, currency: 'USD' };
    expect(findComparableObservations([near, far], target, now).map((item) => item.id)).toEqual(['item-0']);
  });

  it('compares against the low-end price of each menu', () => {
    const rows = [50, 60, 70, 80, 90].map((price, index) => observation(index, price * 100, { price_max_minor: price * 100 + 2000 }));
    const details = buildPriceEvidenceDetails(rows, { name: 'silk', category: 'silk press', durationMinutes: 90, currency: 'USD', currentPriceMinor: 7000 }, now);
    expect(details?.median).toBe(7000);
    expect(details?.currentPercentile).toBe(60);
  });
});
