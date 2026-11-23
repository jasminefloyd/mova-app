import { describe, expect, it } from 'vitest';
import { barPosition, buildEvidence, distanceMiles, findComparables, monthlyImpact, roundTo5, sameService, suggest, type Observation, type SourceInfo } from './price-pilot-model';
import { areaCodes, parseBls, seriesId } from './bls-wage';
import { addressLine, parseCensus } from './census-geo';
import { normalizeRows, pickMenuUrl } from './price-pilot-menus';

const NOW = Date.parse('2026-11-23T15:00:00Z');
const day = (n: number) => new Date(NOW - n * 86400000).toISOString();
// The PP5 board: six salons for a 90-minute silk press.
const menus: Array<[string, number, number]> = [['Midtown Roots Salon', 108, 1.2], ['Luxe Salon Atlanta', 120, 2.4], ['Crown Studio', 112, 3.1], ['The Silk Room', 105, 3.8], ['Weathered Hair Co.', 140, 4.2], ['Pressed by K', 100, 4.6]];
const sources = new Map<string, SourceInfo>(menus.map(([name, , miles], i) => [`s${i}`, { id: `s${i}`, name, distance_miles: miles, checked_at: day(i + 1) }]));
const obs = (i: number, name: string, dollars: number, extra: Partial<Observation> = {}): Observation => ({
  source_id: `s${i}`, service_name: name, category: null, duration_minutes: 90, price_min_minor: dollars * 100, price_max_minor: dollars * 100,
  currency: 'USD', extraction_confidence: 0.95, observed_at: day(i + 1), ...extra,
});
const target = { name: 'Silk press', category: 'Styling', duration_minutes: 90 };

describe('PricePilot model (PP1–PP6)', () => {
  it('matches the same kind of service by its words', () => {
    expect(sameService('Silk Press', 'Silk press')).toBe(true);
    expect(sameService('Silk press w/ trim', 'Silk press')).toBe(true);
    expect(sameService('Knotless braids (medium)', 'Knotless braid')).toBe(true);
    expect(sameService('Loc retwist', 'Silk press')).toBe(false);
  });

  it('builds the PP2 board numbers: $105–$120 range, $110 median, raise from $95', () => {
    const comparables = findComparables(menus.map(([name, price], i) => obs(i, i % 2 ? 'Silk Press' : 'Silk press + blowout', price)), sources, target, NOW);
    expect(comparables).toHaveLength(6);
    const evidence = buildEvidence(comparables, target, 9500, 18, NOW);
    expect([evidence.range_low, evidence.median, evidence.range_high]).toEqual([10500, 11000, 12000]);
    expect(evidence.below_count).toBe(6);
    expect(evidence.confidence).toBe('high');
    expect(suggest(evidence, 9500)).toEqual({ action: 'raise', suggested_minor: 11000, above_range: false });
  });

  it('holds inside or above the range and never suggests lowering', () => {
    const comparables = findComparables(menus.map(([, price], i) => obs(i, 'Silk press', price)), sources, target, NOW);
    expect(suggest(buildEvidence(comparables, target, 11000, 18, NOW), 11000).action).toBe('hold');
    const high = suggest(buildEvidence(comparables, target, 16000, 18, NOW), 16000);
    expect(high).toEqual({ action: 'hold', suggested_minor: 16000, above_range: true });
  });

  it('needs 5 menus before suggesting (PP6)', () => {
    const comparables = findComparables([obs(0, 'Silk press', 108), obs(1, 'Silk press', 120)], sources, target, NOW);
    const evidence = buildEvidence(comparables, target, 12000, 0, NOW);
    expect(evidence.count).toBe(2);
    expect(suggest(evidence, 12000).action).toBe('needs_data');
  });

  it('skips unclear, stale, other-length and other-currency readings, and keeps one price per salon', () => {
    const rows = [
      obs(0, 'Silk press', 108), obs(0, 'Silk press deluxe', 150),
      obs(1, 'Silk press', 120, { extraction_confidence: 0.5 }),
      obs(2, 'Silk press', 112, { observed_at: day(60) }),
      obs(3, 'Silk press', 105, { duration_minutes: 30 }),
      obs(4, 'Silk press', 140, { currency: 'CAD' }),
      obs(5, 'Silk press', 100, { duration_minutes: null }),
    ];
    const comparables = findComparables(rows, sources, target, NOW);
    expect(comparables.map((c) => [c.name, c.price_minor])).toEqual([['Midtown Roots Salon', 10800], ['Pressed by K', 10000]]);
  });

  it('estimates the monthly change from 90 days of bookings', () => {
    expect(monthlyImpact(18, 9500, 11000)).toEqual({ per_month: 6, now_minor: 57000, then_minor: 66000, change_minor: 9000 });
  });

  it('rounds and places values on the bar', () => {
    expect(roundTo5(10625)).toBe(10500);
    expect(barPosition(9500, 8000, 14000)).toBe(25);
    expect(barPosition(5, 5, 5)).toBe(50);
    expect(distanceMiles({ lat: 33.749, lng: -84.388 }, { lat: 33.749, lng: -84.388 })).toBe(0);
  });
});

describe('PricePilot providers', () => {
  it('builds BLS OEWS series IDs for a metro and a state', () => {
    expect(areaCodes('12060', '13')).toEqual([{ type: 'M', code: '0012060' }, { type: 'S', code: '1300000' }]);
    expect(seriesId('M', '0012060')).toBe('OEUM001206000000039501208');
    const parsed = parseBls({ Results: { series: [{ seriesID: 'OEUM001206000000039501208', data: [{ year: '2024', value: '19.40' }, { year: '2023', value: '18.10' }] }, { seriesID: 'X', data: [{ year: '2024', value: '-' }] }] } });
    expect(parsed.get('OEUM001206000000039501208')).toEqual({ value: 19.4, year: 2024 });
    expect(parsed.has('X')).toBe(false);
  });

  it('reads Census geocoder coordinates, metro and state', () => {
    expect(addressLine({ street: '9 Peachtree St', city: 'Atlanta', state: 'GA', postal_code: '30303' })).toBe('9 Peachtree St, Atlanta, GA 30303');
    expect(addressLine({})).toBeNull();
    const place = parseCensus({ result: { addressMatches: [{ coordinates: { x: -84.39, y: 33.75 }, geographies: { 'Metropolitan Statistical Areas': [{ CBSA: '12060' }], States: [{ STATE: '13' }] } }] } });
    expect(place).toEqual({ lat: 33.75, lng: -84.39, cbsa: '12060', stateFips: '13' });
    expect(parseCensus({ result: { addressMatches: [] } })).toBeNull();
  });

  it('picks a salon price page from its site links', () => {
    const site = new URL('https://crown.example');
    expect(pickMenuUrl(['https://crown.example/blog/press', 'https://crown.example/services', 'https://crown.example/pricing', 'https://other.example/prices'], site)?.pathname).toBe('/pricing');
    expect(pickMenuUrl(['https://crown.example/about'], site)).toBeNull();
  });

  it('keeps only priced menu lines', () => {
    const rows = normalizeRows([{ name: 'Silk press', price_min: 110, price_max: null, confidence: 0.9, pricing_basis: 'fixed' }, { name: 'Consult', price_min: 0 }, { name: '', price_min: 50 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ service_name: 'Silk press', price_min_minor: 11000, price_max_minor: 11000, currency: 'USD' });
  });
});
