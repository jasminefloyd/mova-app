import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

Deno.serve(withSystemRequestLogging('payment-settings', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = serviceClient();
  if (body.action === 'get') {
    const [settings, fee, salons] = await Promise.all([
      db.from('mova_payment_method_settings').select('cash_enabled,other_enabled').eq('artist_business_id', actor.businessId).maybeSingle(),
      // O10: the fee follows the stylist's plan (0058); falls back to the platform rate.
      db.rpc('mova_business_fee', { p_artist_business_id: actor.businessId, p_at: new Date().toISOString() }).maybeSingle<{ fee_bps: number }>(),
      db.from('mova_locations').select('name').eq('artist_business_id', actor.businessId).eq('payment_collector', 'salon').eq('is_active', true).order('name'),
    ]);
    if (settings.error || fee.error || salons.error) return respond({ code: 'PAYMENT_SETTINGS_READ_FAILED' }, 500);
    return respond({
      ...(settings.data ?? { cash_enabled: true, other_enabled: true }),
      // Zelle stays hidden until owner decision A-16 turns it on (migration 0027).
      zelle_available: false,
      platform_fee_bps: fee.data?.fee_bps ?? null,
      salon_locations: (salons.data ?? []).map((row: { name: string }) => row.name),
    });
  }
  if (body.action !== 'save' || typeof body.cash_enabled !== 'boolean' || typeof body.other_enabled !== 'boolean') {
    return respond({ code: 'INVALID_REQUEST' }, 422);
  }
  const { data, error } = await db.from('mova_payment_method_settings').upsert({
    artist_business_id: actor.businessId,
    cash_enabled: body.cash_enabled,
    zelle_recorded_enabled: false,
    other_enabled: body.other_enabled,
    updated_by: actor.user.id,
  }, { onConflict: 'artist_business_id' }).select('cash_enabled,other_enabled').single();
  if (error) return respond({ code: 'PAYMENT_SETTINGS_SAVE_FAILED' }, 500);
  return respond(data);
}));
