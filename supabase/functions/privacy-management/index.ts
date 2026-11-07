import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || body.action !== 'request_delete') return respond({ code: 'ACTION_INVALID' }, 422);
  const { data, error } = await serviceClient().rpc('mova_privacy_request_create', { p_actor_id: actor.user.id, p_scope: 'artist_account', p_type: 'delete', p_artist_business_id: actor.businessId });
  if (error) return respond({ code: error.message || 'PRIVACY_REQUEST_FAILED' }, 422);
  return respond({ request_id: data.id, status: data.status, deletion_executed: false });
});
