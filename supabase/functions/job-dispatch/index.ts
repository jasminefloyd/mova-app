import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { smsProviderFromEnv } from '../_shared/providers/sms/index.ts';
import { sendNextWave } from '../_shared/seat-filler.ts';

const equal = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('MOVA_JOB_DISPATCH_SECRET');
  if (!secret || !equal(request.headers.get('x-mova-job-secret') ?? '', secret)) return respond({ code: 'UNAUTHENTICATED' }, 401);

  const body = await request.json().catch(() => ({}));
  const limit = Number.isInteger(body?.limit) ? body.limit as number : 100;
  if (limit < 1 || limit > 500) return respond({ code: 'JOB_LIMIT_INVALID' }, 422);

  try {
    const db = serviceClient();
    const { data, error } = await db.rpc('mova_dispatch_outbox_events', { p_limit: limit });
    if (error) return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
    // Task 4.3: reminder emails ~24 hours ahead, as jobs (sent only while the email provider is the fake).
    const { data: reminders, error: reminderError } = await db.rpc('mova_enqueue_appointment_reminders', { p_now: new Date().toISOString() });
    if (reminderError) return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
    // Task 5.1: close ended seat-filler campaigns and send waves that are due (flag MOVA_SEAT_FILLER_ENABLED).
    const { data: expired } = await db.rpc('mova_slot_expire', { p_now: new Date().toISOString() });
    let waves = 0;
    const provider = Deno.env.get('MOVA_SEAT_FILLER_ENABLED') === 'true' ? smsProviderFromEnv((name) => Deno.env.get(name)) : null;
    if (provider) {
      const { data: due } = await db.rpc('mova_slot_due_waves', { p_now: new Date().toISOString() });
      for (const slotId of (due ?? []) as string[]) if (await sendNextWave(db, provider, slotId, Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co')) waves += 1;
    }
    return respond({ enqueued: data, reminders, seat_filler: { expired: expired ?? 0, waves } });
  } catch {
    return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
  }
});
