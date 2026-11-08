// Task 5.2 / 5.3: rebooking autopilot runner and manual win-back. Planning is pure
// (packages/domain/src/autopilot.ts); sending goes through the Phase 4 SMS adapter, which re-checks
// consent, STOP, quiet hours, the per-client daily cap and the platform spend cap. Every decision,
// including skips and holds, is logged once per day on Activity (36).
import { fillTemplate, normalizeRules, planAutopilot, type PlannerClient } from '../../../packages/domain/src/autopilot.ts';
import { sendSms, type SmsDb, type SmsProvider } from './providers/sms/index.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
type Locale = 'en-US' | 'es-US';

/** Platform switch for rebooking reminders and win-back texts; off until SMS is live. */
export function growthTextsEnabled(env: (name: string) => string | undefined) { return env('MOVA_REBOOKING_TEXTS_ENABLED') === 'true'; }

async function approvedTemplates(db: Db, businessId: string, type: string) {
  const { data } = await db.from('mova_message_templates').select('locale,body,version,id').eq('artist_business_id', businessId).eq('type', type).eq('status', 'approved').order('version', { ascending: false });
  const byLocale = new Map<string, { id: string; body: string }>();
  for (const row of (data ?? []) as Array<{ locale: string; body: string; id: string }>) if (!byLocale.has(row.locale)) byLocale.set(row.locale, { id: row.id, body: row.body });
  return byLocale;
}

async function consentMap(db: Db, businessId: string, purpose: string) {
  const { data } = await db.from('mova_client_consents').select('client_id,granted,changed_at').eq('artist_business_id', businessId).eq('purpose', purpose).eq('channel', 'sms').order('changed_at', { ascending: false });
  const latest = new Map<string, boolean>();
  for (const row of (data ?? []) as Array<{ client_id: string; granted: boolean }>) if (!latest.has(row.client_id)) latest.set(row.client_id, row.granted);
  return latest;
}

const dayKey = (now: Date) => now.toISOString().slice(0, 10);

export type AutopilotRun = { sent: number; skipped: number; held: number; failed: number; attributed: number };

export async function runAutopilot(db: Db, provider: SmsProvider, businessId: string, site: string, now = new Date()): Promise<AutopilotRun> {
  const run: AutopilotRun = { sent: 0, skipped: 0, held: 0, failed: 0, attributed: 0 };
  const { data: features } = await db.rpc('mova_stylist_features', { p_artist_business_id: businessId });
  if (features?.rebooking_autopilot !== true) return run;
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const [{ data: settings }, { data: opportunities }, { data: clients }, { data: sentRows }, { data: upcoming }, { data: profile }, consents, templates] = await Promise.all([
    db.from('mova_autopilot_settings').select('rules').eq('artist_business_id', businessId).maybeSingle(),
    db.from('mova_growth_opportunities').select('id,client_id,service_id,next_due_at,window_end_at,status').eq('artist_business_id', businessId).in('status', ['due', 'contacted']),
    db.from('mova_clients').select('id,display_name,preferred_locale,marketing_opted_out,phone_normalized').eq('artist_business_id', businessId),
    db.from('mova_autopilot_decisions').select('client_id,opportunity_id,created_at').eq('artist_business_id', businessId).eq('action', 'sent').not('opportunity_id', 'is', null).order('created_at', { ascending: false }).limit(5000),
    db.from('mova_appointments').select('client_id').eq('artist_business_id', businessId).in('status', ['confirmed', 'pending_artist', 'pending_payment']).gt('starts_at', now.toISOString()),
    db.from('mova_artist_profiles').select('display_name,handle').eq('artist_business_id', businessId).maybeSingle(),
    consentMap(db, businessId, 'rebooking_reminders'),
    approvedTemplates(db, businessId, 'rebooking_reminder'),
  ]);
  // mova_growth_opportunities.service_id has no foreign key, so service names are looked up separately.
  const serviceIds = [...new Set(((opportunities ?? []) as Array<{ service_id: string }>).map((row) => row.service_id))];
  const { data: services } = serviceIds.length ? await db.from('mova_services').select('id,name').in('id', serviceIds) : { data: [] };
  const serviceNames = new Map(((services ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const booked = new Set(((upcoming ?? []) as Array<{ client_id: string | null }>).map((row) => row.client_id));
  const clientRows = new Map(((clients ?? []) as Array<{ id: string; display_name: string; preferred_locale: string; marketing_opted_out: boolean; phone_normalized: string | null }>).map((row) => [row.id, row]));
  const planner = new Map<string, PlannerClient>([...clientRows.values()].map((row) => [row.id, { id: row.id, consented: consents.get(row.id) === true, opted_out: row.marketing_opted_out, has_phone: Boolean(row.phone_normalized), upcoming_booking: booked.has(row.id) }]));
  const lastSentAt: Record<string, string> = {}; const sentThisCycle: Record<string, number> = {}; let sentToday = 0;
  for (const row of (sentRows ?? []) as Array<{ client_id: string; opportunity_id: string; created_at: string }>) {
    lastSentAt[row.client_id] ??= row.created_at;
    sentThisCycle[row.opportunity_id] = (sentThisCycle[row.opportunity_id] ?? 0) + 1;
    if (Date.parse(row.created_at) >= dayStart.getTime()) sentToday += 1;
  }
  const opportunityRows = new Map(((opportunities ?? []) as Array<{ id: string; client_id: string; service_id: string; next_due_at: string; window_end_at: string; status: string }>).map((row) => [row.id, row]));
  const decisions = planAutopilot(now, normalizeRules(settings?.rules ?? null), [...opportunityRows.values()], planner, { lastSentAt, sentThisCycle, sentToday });
  const log = (decision: { opportunity_id: string; client_id: string }, action: string, reason: string, extra: Record<string, unknown> = {}) =>
    db.from('mova_autopilot_decisions').insert({ artist_business_id: businessId, client_id: decision.client_id, opportunity_id: decision.opportunity_id, action, reason_code: reason, idempotency_key: `autopilot:${decision.opportunity_id}:${dayKey(now)}:${action === 'sent' ? 'sent' : reason}`, ...extra });

  for (const decision of decisions) {
    if (decision.action !== 'sent') { await log(decision, decision.action, decision.reason); if (decision.action === 'held') run.held += 1; else run.skipped += 1; continue; }
    const client = clientRows.get(decision.client_id)!;
    const locale: Locale = client.preferred_locale === 'es-US' ? 'es-US' : 'en-US';
    const template = templates.get(locale);
    if (!template) { await log(decision, 'held', 'no_approved_template'); run.held += 1; continue; }
    const opportunity = opportunityRows.get(decision.opportunity_id)!;
    const body = fillTemplate(template.body, { first_name: client.display_name.split(/\s+/)[0] ?? '', service: serviceNames.get(opportunity.service_id) ?? '', link: `${site}/a/${profile?.handle ?? ''}/book`, stylist: String(profile?.display_name ?? '').split(/\s+/)[0] ?? '' });
    const outcome = await sendSms(db as SmsDb, provider, { artistBusinessId: businessId, clientId: client.id, purpose: 'rebooking_reminders', origin: 'autopilot', body, templateId: template.id, idempotencyKey: `autopilot:${decision.opportunity_id}:${dayKey(now)}`, now });
    // Already attempted today (same idempotency key): nothing new to send or log.
    if (outcome.status === 'duplicate') continue;
    if (outcome.status === 'sent') {
      await log(decision, 'sent', decision.reason, { message_id: outcome.messageId });
      await db.from('mova_growth_opportunities').update({ status: 'contacted', updated_at: now.toISOString() }).eq('id', decision.opportunity_id);
      run.sent += 1;
    } else if (outcome.status === 'suppressed') { await log(decision, 'skipped', `sms_${outcome.reason}`.slice(0, 60)); run.skipped += 1; }
    else { await log(decision, 'failed', 'sms_failed'); run.failed += 1; }
  }
  const { data: attributed } = await db.rpc('mova_autopilot_attribute', { p_artist_business_id: businessId, p_now: now.toISOString() });
  run.attributed = Number(attributed ?? 0);
  return run;
}

export type WinbackOutcome = { status: 'sent' | 'suppressed' | 'no_template' | 'not_found' | 'failed'; reason?: string };

/** Task 5.3: the stylist taps Send for one lapsed client. Same adapter and consent checks; never automatic. */
export async function sendWinback(db: Db, provider: SmsProvider, businessId: string, opportunityId: string, actorId: string, site: string, now = new Date()): Promise<WinbackOutcome> {
  const { data: opportunity } = await db.from('mova_growth_opportunities').select('id,client_id,mova_clients(display_name,preferred_locale)').eq('id', opportunityId).eq('artist_business_id', businessId).maybeSingle();
  if (!opportunity) return { status: 'not_found' };
  const client = opportunity.mova_clients as { display_name: string; preferred_locale: string } | null;
  const locale: Locale = client?.preferred_locale === 'es-US' ? 'es-US' : 'en-US';
  const template = (await approvedTemplates(db, businessId, 'win_back')).get(locale);
  if (!template) return { status: 'no_template' };
  const { data: profile } = await db.from('mova_artist_profiles').select('display_name,handle').eq('artist_business_id', businessId).maybeSingle();
  const body = fillTemplate(template.body, { first_name: (client?.display_name ?? '').split(/\s+/)[0] ?? '', link: `${site}/a/${profile?.handle ?? ''}/book`, stylist: String(profile?.display_name ?? '').split(/\s+/)[0] ?? '' });
  const outcome = await sendSms(db as SmsDb, provider, { artistBusinessId: businessId, clientId: opportunity.client_id, purpose: 'offers', origin: 'artist', body, templateId: template.id, idempotencyKey: `winback:${opportunityId}:${dayKey(now)}`, now });
  if (outcome.status === 'duplicate') return { status: 'sent' };
  const action = outcome.status === 'sent' ? 'sent' : outcome.status === 'suppressed' ? 'skipped' : 'failed';
  await db.from('mova_autopilot_decisions').insert({ artist_business_id: businessId, client_id: opportunity.client_id, opportunity_id: opportunityId, action, reason_code: outcome.status === 'suppressed' ? `winback_${outcome.reason}`.slice(0, 60) : 'winback_manual', idempotency_key: `winback:${opportunityId}:${dayKey(now)}:${action}`, ...(outcome.status === 'sent' ? { message_id: outcome.messageId } : {}) });
  if (action === 'sent') await db.from('mova_growth_opportunities').update({ status: 'contacted', updated_at: now.toISOString() }).eq('id', opportunityId);
  void actorId;
  return outcome.status === 'sent' ? { status: 'sent' } : outcome.status === 'suppressed' ? { status: 'suppressed', reason: outcome.reason } : { status: 'failed' };
}
