// Task 5.2: the rebooking autopilot planner. Pure: given due clients, consent and the stylist's rules,
// decide who gets a reminder now and why everyone else does not. The runner sends through the SMS
// adapter (which re-checks consent, STOP, quiet hours and the platform cap) and logs every decision.
export type AutopilotRules = { daily_cap: number; per_client_days: number; per_cycle_max: number };
export type PlannerOpportunity = { id: string; client_id: string; next_due_at: string; window_end_at: string; status: string };
export type PlannerClient = { id: string; consented: boolean; opted_out: boolean; has_phone: boolean; upcoming_booking: boolean };
export type PlannerHistory = { lastSentAt: Record<string, string | undefined>; sentThisCycle: Record<string, number | undefined>; sentToday: number };
export type PlannerDecision = { opportunity_id: string; client_id: string; action: 'sent' | 'skipped' | 'held'; reason: string };

const DAY = 86_400_000;
export const DEFAULT_RULES: AutopilotRules = { daily_cap: 10, per_client_days: 14, per_cycle_max: 2 };

export function normalizeRules(raw: Partial<Record<keyof AutopilotRules, unknown>> | null | undefined): AutopilotRules {
  const pick = (value: unknown, fallback: number, min: number, max: number) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };
  return { daily_cap: pick(raw?.daily_cap, DEFAULT_RULES.daily_cap, 0, 50), per_client_days: pick(raw?.per_client_days, DEFAULT_RULES.per_client_days, 7, 90), per_cycle_max: pick(raw?.per_cycle_max, DEFAULT_RULES.per_cycle_max, 1, 3) };
}

/** Earliest-due first. Only clients inside their rebooking window are considered at all. */
export function planAutopilot(now: Date, rulesInput: Partial<AutopilotRules> | null, opportunities: PlannerOpportunity[], clients: Map<string, PlannerClient>, history: PlannerHistory): PlannerDecision[] {
  const rules = normalizeRules(rulesInput);
  const t = now.getTime();
  let budget = Math.max(0, rules.daily_cap - history.sentToday);
  const decisions: PlannerDecision[] = [];
  const seen = new Set<string>();
  const due = opportunities
    .filter((item) => (item.status === 'due' || item.status === 'contacted') && Date.parse(item.next_due_at) <= t && Date.parse(item.window_end_at) >= t)
    .sort((a, b) => Date.parse(a.next_due_at) - Date.parse(b.next_due_at) || a.id.localeCompare(b.id));
  for (const item of due) {
    const base = { opportunity_id: item.id, client_id: item.client_id };
    const client = clients.get(item.client_id);
    const last = history.lastSentAt[item.client_id];
    let reason: string | null = null;
    if (!client) reason = 'client_missing';
    else if (client.opted_out) reason = 'opted_out';
    else if (!client.consented) reason = 'no_consent';
    else if (!client.has_phone) reason = 'no_phone';
    else if (client.upcoming_booking) reason = 'already_booked';
    else if (seen.has(item.client_id)) reason = 'one_message_per_client';
    else if (last && t - Date.parse(last) < rules.per_client_days * DAY) reason = 'too_soon';
    else if ((history.sentThisCycle[item.id] ?? 0) >= rules.per_cycle_max) reason = 'cycle_max_reached';
    if (reason) { decisions.push({ ...base, action: 'skipped', reason }); continue; }
    if (budget <= 0) { decisions.push({ ...base, action: 'held', reason: 'daily_cap_reached' }); continue; }
    budget -= 1; seen.add(item.client_id);
    decisions.push({ ...base, action: 'sent', reason: 'due_in_window' });
  }
  return decisions;
}

/** Fills an approved template; unknown placeholders are left out rather than sent raw. */
export function fillTemplate(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, (_, a: string | undefined, b: string | undefined) => values[(a ?? b)!] ?? '').replace(/\s{2,}/g, ' ').trim();
}
