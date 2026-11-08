import { describe, expect, it } from 'vitest';
import { claimTokenHash, formatWhen, newClaimToken, offerText, takenText } from './seat-filler';

describe('seat filler texts (task 5.1)', () => {
  const t = { first: 'Jordan', when: formatWhen('2026-11-13T15:00:00Z', 'America/New_York', 'en-US'), location: 'Studio 9', service: 'Silk press', price: '$150', link: 'https://mova-beauty.co/slot/abc', stylist: 'Ari' };
  it('matches board 31b in English with the opt-out line', () => {
    expect(offerText('en-US', t)).toBe('Hi Jordan! A spot just opened Fri, Nov 13, 10:00 AM at Studio 9 for Silk press ($150). First to book gets it: https://mova-beauty.co/slot/abc. Reply STOP to opt out. — Ari');
  });
  it('speaks Spanish and keeps STOP', () => {
    const text = offerText('es-US', { ...t, when: formatWhen('2026-11-13T15:00:00Z', 'America/New_York', 'es-US') });
    expect(text).toContain('Se abrió un espacio');
    expect(text).toContain('Responde STOP');
  });
  it('fits in two SMS segments', () => expect(offerText('en-US', { ...t, location: 'Rooted Beauty Studio Suite 12', service: 'Knotless braids, mid-back' }).length).toBeLessThanOrEqual(306));
  it('tells the rest the spot was taken', () => expect(takenText('en-US', 'https://x/a/ari/book')).toBe('That spot was just taken. Here are other times: https://x/a/ari/book'));
  it('makes unguessable tokens and stores only their hash', async () => {
    const token = newClaimToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(await claimTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await claimTokenHash(token)).not.toContain(token);
  });
});
