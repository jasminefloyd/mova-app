import { describe, expect, it } from 'vitest';
import { FakeConciergeModel } from '../providers/ai/fake';
import { EVAL_CASES, EVAL_CONTEXT, EVAL_THRESHOLD } from './eval-set';
import { handleTurn, type OpenTime, type TurnContext } from './turn';

const times: OpenTime[] = [
  { starts_at: '2026-11-10T15:00:00Z', time_zone: 'America/New_York', location_name: 'Rooted Studio', booking_mode: 'instant' },
  { starts_at: '2026-11-11T18:30:00Z', time_zone: 'America/New_York', location_name: 'Rooted Studio', booking_mode: 'instant' },
];
const deps = { model: new FakeConciergeModel(), findTimes: async () => times };
const context = (locale: 'en-US' | 'es-US', patch: Partial<TurnContext> = {}): TurnContext => ({ ...EVAL_CONTEXT, locale, ...patch });

describe('concierge eval set (task 5.4)', () => {
  it(`passes at least ${EVAL_THRESHOLD * 100}% of cases with the fake model, every safety case included`, async () => {
    const results = await Promise.all(EVAL_CASES.map(async (item) => {
      const result = await handleTurn(item.message, context(item.locale), deps);
      const pass = result.decision === item.decision && result.intent === item.intent
        && (!item.contains || result.reply.includes(item.contains)) && (!item.handoff || result.handoff?.type === item.handoff);
      return { item, result, pass };
    }));
    const failed = results.filter((row) => !row.pass).map((row) => `${row.item.id}: ${row.result.decision}/${row.result.intent}/${row.result.handoff?.type ?? '-'} "${row.result.reply}"`);
    expect(results.filter((row) => row.pass).length / results.length, failed.join('\n')).toBeGreaterThanOrEqual(EVAL_THRESHOLD);
    expect(results.filter((row) => row.item.safety && !row.pass).map((row) => row.item.id)).toEqual([]);
    expect(EVAL_CASES.filter((item) => item.locale === 'es-US').length).toBeGreaterThanOrEqual(10);
    // The 90% bar is for live models; the deterministic fake must pass every approved case, so one
    // regression cannot hide under the threshold.
    expect(failed).toEqual([]);
  });
});

describe('handleTurn rules (task 5.4)', () => {
  it('offers real open times with the booking link', async () => {
    const result = await handleTurn('any openings for a silk press?', context('en-US'), deps);
    expect(result.decision).toBe('replied');
    expect(result.offeredTimes).toHaveLength(2);
    expect(result.reply).toContain('Tue, Nov 10, 10:00 AM (Rooted Studio)');
    expect(result.toolCalls).toEqual([{ tool: 'search_availability', allowed: true, reason: 'permitted' }]);
  });
  it('says request times are requests', async () => {
    const result = await handleTurn('openings for a trim?', context('en-US'), { ...deps, findTimes: async () => times.map((t) => ({ ...t, booking_mode: 'request' as const })) });
    expect(result.reply).toContain('available to request');
  });
  it('hands off when availability fails or is empty', async () => {
    expect((await handleTurn('openings for a trim?', context('en-US'), { ...deps, findTimes: async () => { throw new Error('503'); } })).handoff?.type).toBe('tool_error');
    const empty = await handleTurn('openings for a trim?', context('en-US'), { ...deps, findTimes: async () => [] });
    expect(empty).toMatchObject({ decision: 'handoff', handoff: { type: 'exception' } });
  });
  it('hands off when the model fails', async () => {
    const broken = { name: 'broken', classify: () => Promise.reject(new Error('down')) };
    expect((await handleTurn('hello', context('en-US'), { ...deps, model: broken })).handoff?.type).toBe('tool_error');
  });
  it('hands off in a language the stylist has not turned on', async () => {
    expect((await handleTurn('¿Dónde puedo estacionar?', context('es-US', { languages: ['en-US'] }), deps)).handoff?.type).toBe('exception');
  });
  it('blocks an approved answer that quotes a price outside the catalog', async () => {
    const knowledge = [{ id: 'k', kind: 'faq', question: 'Do you charge for parking?', answer_en: 'Parking is $12.', answer_es: 'El estacionamiento cuesta $12.' }];
    const result = await handleTurn('do you charge for parking', context('en-US', { knowledge }), deps);
    expect(result).toMatchObject({ decision: 'blocked', handoff: { type: 'exception' } });
  });
  it('treats quote-only services as quote requests even when asked for a price', async () => {
    const result = await handleTurn('how much is color correction', context('en-US'), deps);
    expect(result).toMatchObject({ decision: 'handoff', handoff: { type: 'quote' }, quote: { service_category: 'Color correction' } });
  });
});
