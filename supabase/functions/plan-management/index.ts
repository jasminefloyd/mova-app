import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  if (body.action === 'change') return respond({ code: 'PLAN_SELECTION_NOT_APPROVED', approval: ['A-01', 'A-26'], changed: false }, 409);
  if (body.action && body.action !== 'get') return respond({ code: 'ACTION_INVALID' }, 422);
  const { data, error } = await serviceClient().rpc('mova_plan_entitlement_summary', { p_artist_business_id: actor.businessId });
  if (error) return respond({ code: 'PLAN_SUMMARY_UNAVAILABLE' }, 500);
  return respond(data);
});
