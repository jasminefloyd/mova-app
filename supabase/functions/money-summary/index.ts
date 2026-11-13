import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

Deno.serve(withSystemRequestLogging('money-summary', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const month = typeof body.month === 'string' ? body.month : new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return respond({ code: 'INVALID_MONTH' }, 422);
  const { data, error } = await serviceClient().rpc('mova_money_month_summary', {
    p_artist_business_id: actor.businessId,
    p_month: `${month}-01`,
  });
  if (error) return respond({ code: error.message || 'MONEY_SUMMARY_FAILED' }, 500);
  return respond(data);
}));
