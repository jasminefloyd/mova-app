import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = serviceClient();
  if (body.action === 'get') {
    const { data, error } = await db.from('mova_payment_method_settings').select('cash_enabled,other_enabled').eq('artist_business_id', actor.businessId).maybeSingle();
    if (error) return respond({ code: 'PAYMENT_SETTINGS_READ_FAILED' }, 500);
    return respond(data ?? { cash_enabled: true, other_enabled: true });
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
});
