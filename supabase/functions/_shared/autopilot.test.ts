import { describe, expect, it } from 'vitest';
import { FakeSmsProvider } from './providers/sms/fake';
import { runAutopilot, sendWinback } from './autopilot';

// Task 5.2/5.3: a full autopilot run with the fake SMS provider against an in-memory stand-in for
// the database. The SMS gate itself is covered by Phase 4's pgTAP; here it allows everyone.
type Row = Record<string, unknown>;
function stubDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; row: Row }> = [];
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain: Record<string, unknown> = {};
    const filter = (fn: (row: Row) => boolean) => { rows = rows.filter(fn); return chain; };
    Object.assign(chain, {
      select: () => chain, order: () => chain, limit: () => chain, lte: () => chain, gt: () => chain, not: () => chain,
      eq: (column: string, value: unknown) => filter((row) => row[column] === undefined || row[column] === value),
      in: (column: string, values: unknown[]) => filter((row) => row[column] === undefined || values.includes(row[column])),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      insert: (row: Row) => {
        const key = String(row.idempotency_key ?? '');
        const duplicate = table === 'mova_messages' && writes.some((write) => write.table === table && write.op === 'insert' && write.row.idempotency_key === key);
        writes.push({ table, op: 'insert', row });
        const id = `${table}-${writes.length}`;
        const result = { data: duplicate ? null : { id }, error: duplicate ? { message: 'duplicate key 23505' } : null };
        return { select: () => ({ single: async () => result }), then: (resolve: (value: unknown) => unknown) => resolve(result) };
      },
      update: (row: Row) => ({ eq: (_c: string, id: unknown) => { writes.push({ table, op: 'update', row: { ...row, id } }); return Promise.resolve({ error: null }); } }),
    });
    return chain;
  };
  const rpc = async (name: string) => {
    if (name === 'mova_stylist_features') return { data: { rebooking_autopilot: true }, error: null };
    if (name === 'mova_sms_send_gate') return { data: { allowed: true, to: '+12025550100', from: '+15550001111' }, error: null };
    if (name === 'mova_messaging_reserve_spend') return { data: { allowed: true }, error: null };
    if (name === 'mova_autopilot_attribute') return { data: 0, error: null };
    return { data: null, error: { message: 'unexpected rpc' } };
  };
  return { db: { from: builder, rpc }, writes };
}

const now = new Date('2026-11-09T16:00:00Z');
const due = (n: number) => ({ id: `o${n}`, client_id: `c${n}`, service_id: 's1', next_due_at: new Date(now.getTime() - n * 3600_000).toISOString(), window_end_at: '2026-11-30T00:00:00Z', status: 'due' });
const client = (n: number, locale = 'en-US') => ({ id: `c${n}`, display_name: `Client ${n}`, preferred_locale: locale, marketing_opted_out: false, phone_normalized: `+120255500${n}` });
const consent = (n: number) => ({ client_id: `c${n}`, granted: true, changed_at: '2026-10-01T00:00:00Z' });
const fixtures = () => ({
  mova_autopilot_settings: [{ rules: { daily_cap: 3, per_client_days: 14, per_cycle_max: 2 } }],
  mova_growth_opportunities: [1, 2, 3, 4, 5].map(due),
  mova_clients: [client(1), client(2), client(3), client(4, 'es-US'), client(5)],
  mova_client_consents: [1, 2, 3, 4, 5].map(consent),
  mova_autopilot_decisions: [], mova_appointments: [],
  mova_artist_profiles: [{ display_name: 'Ari Monroe', handle: 'ari-monroe' }],
  mova_services: [{ id: 's1', name: 'silk press' }],
  mova_message_templates: [
    { id: 't-en', locale: 'en-US', body: 'Hi {{first_name}}! Time for your {{service}}? {{link}} Reply STOP to opt out.', version: 1 },
    { id: 't-es', locale: 'es-US', body: '¡Hola {{first_name}}! ¿Lista para tu {{service}}? {{link}} Responde STOP.', version: 1 },
  ],
});

describe('runAutopilot (task 5.2)', () => {
  it('sends to at most the daily cap through the fake and logs every decision', async () => {
    const { db, writes } = stubDb(fixtures());
    const sms = new FakeSmsProvider();
    const run = await runAutopilot(db, sms, 'biz', 'https://mova-beauty.co', now);
    expect(run).toMatchObject({ sent: 3, held: 2, skipped: 0, failed: 0 });
    expect(sms.outbox).toHaveLength(3);
    expect(sms.outbox[0]!.body).toBe('Hi Client! Time for your silk press? https://mova-beauty.co/a/ari-monroe/book Reply STOP to opt out.');
    expect(sms.outbox.map((item) => item.body).some((body) => body.startsWith('¡Hola'))).toBe(true);
    const decisions = writes.filter((write) => write.table === 'mova_autopilot_decisions');
    expect(decisions.map((write) => `${write.row.action}:${write.row.reason_code}`).sort()).toEqual(['held:daily_cap_reached', 'held:daily_cap_reached', 'sent:due_in_window', 'sent:due_in_window', 'sent:due_in_window']);
  });
  it('holds everyone when no template is approved, and sends nothing', async () => {
    const tables = fixtures(); tables.mova_message_templates = [];
    const { db } = stubDb(tables); const sms = new FakeSmsProvider();
    expect(await runAutopilot(db, sms, 'biz', 'https://x', now)).toMatchObject({ sent: 0, held: 5 });
    expect(sms.outbox).toHaveLength(0);
  });
  it('does nothing when the stylist turned autopilot off', async () => {
    const { db } = stubDb(fixtures());
    const off = { ...db, rpc: async (name: string) => (name === 'mova_stylist_features' ? { data: { rebooking_autopilot: false }, error: null } : db.rpc(name)) };
    const sms = new FakeSmsProvider();
    expect(await runAutopilot(off, sms, 'biz', 'https://x', now)).toMatchObject({ sent: 0, held: 0, skipped: 0 });
  });
});

describe('sendWinback (task 5.3)', () => {
  it('sends one approved win-back text when the stylist taps', async () => {
    const tables = { ...fixtures(), mova_growth_opportunities: [{ id: 'o9', client_id: 'c9', mova_clients: { display_name: 'Lena Moss', preferred_locale: 'en-US' } }], mova_message_templates: [{ id: 'w', locale: 'en-US', body: 'We miss you, {{first_name}}! {{link}}', version: 1 }] };
    const { db, writes } = stubDb(tables); const sms = new FakeSmsProvider();
    expect(await sendWinback(db, sms, 'biz', 'o9', 'stylist', 'https://mova-beauty.co', now)).toEqual({ status: 'sent' });
    expect(sms.outbox.map((item) => item.body)).toEqual(['We miss you, Lena! https://mova-beauty.co/a/ari-monroe/book']);
    expect(writes.find((write) => write.table === 'mova_autopilot_decisions')?.row).toMatchObject({ action: 'sent', reason_code: 'winback_manual' });
  });
  it('refuses without an approved win-back template', async () => {
    const tables = { ...fixtures(), mova_growth_opportunities: [{ id: 'o9', client_id: 'c9', mova_clients: { display_name: 'Lena', preferred_locale: 'en-US' } }], mova_message_templates: [] };
    const { db } = stubDb(tables);
    expect(await sendWinback(db, new FakeSmsProvider(), 'biz', 'o9', 'stylist', 'https://x', now)).toEqual({ status: 'no_template' });
  });
});
