import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { smsProviderFromEnv } from '../_shared/providers/sms/index.ts';
import { sendNextWave } from '../_shared/seat-filler.ts';
import { growthTextsEnabled, runAutopilot } from '../_shared/autopilot.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';
import { sendSystemLogAlert } from '../_shared/system-log-alert.ts';

const equal = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

Deno.serve(withSystemRequestLogging('job-dispatch', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('MOVA_JOB_DISPATCH_SECRET');
  if (!secret || !equal(request.headers.get('x-mova-job-secret') ?? '', secret)) return respond({ code: 'UNAUTHENTICATED' }, 401);

  const body = await request.json().catch(() => ({}));
  const limit = Number.isInteger(body?.limit) ? body.limit as number : 100;
  if (limit < 1 || limit > 500) return respond({ code: 'JOB_LIMIT_INVALID' }, 422);

  try {
    const db = serviceClient();
    await db.rpc('mova_system_logs_cleanup');
    const { data: expiredMarketLocations, error: marketLocationCleanupError } = await db.rpc('mova_price_pilot_expire_market_locations');
    if (marketLocationCleanupError) return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
    await sendSystemLogAlert(db, (name) => Deno.env.get(name), request);
    const { data, error } = await db.rpc('mova_dispatch_outbox_events', { p_limit: limit });
    if (error) return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
    // Task 4.3: reminder emails ~24 hours ahead, as jobs (sent only while the email provider is the fake).
    const { data: reminders, error: reminderError } = await db.rpc('mova_enqueue_appointment_reminders', { p_now: new Date().toISOString() });
    if (reminderError) return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
    // Task 5.1: close ended seat-filler campaigns and send waves that are due (flag MOVA_SEAT_FILLER_ENABLED).
    const { data: expired } = await db.rpc('mova_slot_expire', { p_now: new Date().toISOString() });
    let waves = 0;
    const provider = await platformSwitchEnabled('seat_filler') && Deno.env.get('MOVA_SEAT_FILLER_ENABLED') === 'true' ? smsProviderFromEnv((name) => Deno.env.get(name)) : null;
    if (provider) {
      const { data: due } = await db.rpc('mova_slot_due_waves', { p_now: new Date().toISOString() });
      const slotIds = (due ?? []) as string[];
      const { data: dueSlots } = slotIds.length ? await db.from('mova_slot_events').select('id,artist_business_id').in('id', slotIds) : { data: [] };
      for (const slot of (dueSlots ?? []) as Array<{ id: string; artist_business_id: string }>) {
        if (await planFeatureEnabled(slot.artist_business_id, 'seat_filler') && await sendNextWave(db, provider, slot.id, Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co')) waves += 1;
      }
    }
    // Task 5.2: rebooking autopilot for stylists with it on (O11 default ON), behind MOVA_REBOOKING_TEXTS_ENABLED.
    let autopilot = 0;
    const smsForGrowth = await platformSwitchEnabled('autopilot') && growthTextsEnabled((name) => Deno.env.get(name)) ? smsProviderFromEnv((name) => Deno.env.get(name)) : null;
    if (smsForGrowth) {
      const { data: businesses } = await db.from('mova_growth_opportunities').select('artist_business_id').eq('status', 'due').lte('next_due_at', new Date().toISOString()).limit(500);
      for (const businessId of [...new Set(((businesses ?? []) as Array<{ artist_business_id: string }>).map((row) => row.artist_business_id))].slice(0, 50)) {
        if (!await planFeatureEnabled(businessId, 'rebooking_autopilot')) continue;
        const result = await runAutopilot(db, smsForGrowth, businessId, Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co');
        autopilot += result.sent;
      }
    }
    return respond({ enqueued: data, reminders, expired_market_locations: expiredMarketLocations ?? 0, seat_filler: { expired: expired ?? 0, waves }, autopilot });
  } catch {
    return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
  }
}));
