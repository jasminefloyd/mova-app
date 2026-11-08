import { describe, expect, it } from 'vitest';
import { fillTemplate, normalizeRules, planAutopilot, type PlannerClient } from './autopilot';

const now = new Date('2026-11-08T15:00:00Z');
const opp = (id: string, client: string, dueDaysAgo = 2, windowDays = 10, status = 'due') => ({ id, client_id: client, next_due_at: new Date(now.getTime() - dueDaysAgo * 86400000).toISOString(), window_end_at: new Date(now.getTime() + windowDays * 86400000).toISOString(), status });
const ok = (id: string, patch: Partial<PlannerClient> = {}): PlannerClient => ({ id, consented: true, opted_out: false, has_phone: true, upcoming_booking: false, ...patch });
const clients = (...list: PlannerClient[]) => new Map(list.map((client) => [client.id, client]));
const empty = { lastSentAt: {}, sentThisCycle: {}, sentToday: 0 };

describe('planAutopilot (task 5.2)', () => {
  it('sends to due clients in their window, earliest first', () => {
    expect(planAutopilot(now, null, [opp('o2', 'b', 1), opp('o1', 'a', 5)], clients(ok('a'), ok('b')), empty).map((d) => `${d.opportunity_id}:${d.action}`)).toEqual(['o1:sent', 'o2:sent']);
  });
  it('ignores clients not yet due or past their window', () => {
    expect(planAutopilot(now, null, [opp('o1', 'a', -3), opp('o2', 'b', 30, -1)], clients(ok('a'), ok('b')), empty)).toEqual([]);
  });
  it('skips with a reason: opted out, no consent, no phone, already booked', () => {
    const decisions = planAutopilot(now, null, [opp('o1', 'a'), opp('o2', 'b'), opp('o3', 'c'), opp('o4', 'd')], clients(ok('a', { opted_out: true }), ok('b', { consented: false }), ok('c', { has_phone: false }), ok('d', { upcoming_booking: true })), empty);
    expect(decisions.map((d) => d.reason)).toEqual(['opted_out', 'no_consent', 'no_phone', 'already_booked']);
    expect(decisions.every((d) => d.action === 'skipped')).toBe(true);
  });
  it('respects the minimum days between messages and the per-cycle maximum', () => {
    const history = { lastSentAt: { a: new Date(now.getTime() - 5 * 86400000).toISOString() }, sentThisCycle: { o2: 2 }, sentToday: 0 };
    expect(planAutopilot(now, { per_client_days: 14, per_cycle_max: 2 }, [opp('o1', 'a'), opp('o2', 'b')], clients(ok('a'), ok('b')), history).map((d) => d.reason)).toEqual(['too_soon', 'cycle_max_reached']);
  });
  it('holds the rest once the daily cap is used, counting what was sent earlier today', () => {
    const many = Array.from({ length: 6 }, (_, i) => opp(`o${i}`, `c${i}`, 6 - i));
    const decisions = planAutopilot(now, { daily_cap: 4 }, many, clients(...many.map((item) => ok(item.client_id))), { ...empty, sentToday: 1 });
    expect(decisions.filter((d) => d.action === 'sent')).toHaveLength(3);
    expect(decisions.filter((d) => d.action === 'held').map((d) => d.reason)).toEqual(['daily_cap_reached', 'daily_cap_reached', 'daily_cap_reached']);
  });
  it('texts a client once even when two services are due', () => {
    expect(planAutopilot(now, null, [opp('o1', 'a', 3), opp('o2', 'a', 2)], clients(ok('a')), empty).map((d) => d.reason)).toEqual(['due_in_window', 'one_message_per_client']);
  });
  it('clamps rules to safe ranges', () => expect(normalizeRules({ daily_cap: 500, per_client_days: 1, per_cycle_max: 'x' })).toEqual({ daily_cap: 50, per_client_days: 7, per_cycle_max: 2 }));
  it('fills templates without leaking unknown placeholders', () => expect(fillTemplate('Hi {{first_name}}! Time for your {{service}}? Book: {{link}} {{unknown}}', { first_name: 'Dana', service: 'silk press', link: 'https://x/b' })).toBe('Hi Dana! Time for your silk press? Book: https://x/b'));
});
