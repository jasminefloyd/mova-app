import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';

Deno.serve(withSystemRequestLogging('manual-payment-record', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null);
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? body?.idempotency_key;
  if (!body || typeof body.appointment_id !== 'string' || !['cash', 'other', 'salon_collected'].includes(body.method)
    || !Number.isSafeInteger(body.amount_minor) || body.amount_minor <= 0 || !['artist', 'salon'].includes(body.collector)
    || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200
    || (body.method === 'other' && (typeof body.recorded_method_label !== 'string' || !body.recorded_method_label.trim() || body.recorded_method_label.length > 80))) {
    return respond({ code: 'INVALID_REQUEST' }, 422);
  }
  if (body.method === 'salon_collected' && body.collector !== 'salon') return respond({ code: 'INVALID_COLLECTOR' }, 422);
  if (body.method === 'other' && typeof body.recorded_method_label === 'string' && body.recorded_method_label.trim().toLowerCase() === 'zelle' && !await platformSwitchEnabled('zelle')) return respond({ code: 'ZELLE_DISABLED' }, 403);
  if (body.method !== 'other' && body.recorded_method_label != null) return respond({ code: 'INVALID_METHOD_LABEL' }, 422);
  if (body.confirmation_ref != null && (typeof body.confirmation_ref !== 'string' || body.confirmation_ref.length > 120)) return respond({ code: 'INVALID_CONFIRMATION_REF' }, 422);
  const { data, error } = await serviceClient().rpc('mova_payment_record_manual', {
    p_artist_business_id: actor.businessId,
    p_appointment_id: body.appointment_id,
    p_method: body.method,
    p_amount_minor: body.amount_minor,
    p_collector: body.collector,
    p_recorded_method_label: body.method === 'other' ? body.recorded_method_label.trim() : null,
    p_confirmation_ref: body.confirmation_ref?.trim() || null,
    p_idempotency_key: idempotencyKey,
    p_actor_id: actor.user.id,
  });
  if (error) {
    const status = error.code === 'P0002' ? 404 : error.code === '23505' ? 409 : error.code === '22023' ? 422 : 500;
    return respond({ code: error.message || 'PAYMENT_RECORD_FAILED' }, status);
  }
  return respond(data, data?.replayed ? 200 : 201);
}));
