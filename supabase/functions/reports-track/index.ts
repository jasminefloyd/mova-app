import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

const events = new Set(['page_view', 'qr_scan', 'booking_started', 'booking_completed']);
const sources = new Set(['instagram', 'qr', 'google', 'direct', 'other']);

Deno.serve(withSystemRequestLogging('reports-track', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.handle !== 'string' || !/^[a-z0-9-]{2,40}$/.test(body.handle)
    || !events.has(body.event) || !sources.has(body.source) || typeof body.event_key !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(body.event_key)) return respond({ code: 'TRACK_EVENT_INVALID' }, 422);
  const { data, error } = await serviceClient().rpc('mova_track_profile_event', {
    p_handle: body.handle,
    p_event_type: body.event,
    p_source: body.source,
    p_event_key: body.event_key,
  });
  if (error) return respond({ code: 'TRACK_EVENT_FAILED' }, 500);
  return respond({ recorded: data === true });
}));
