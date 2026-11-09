import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { conciergeModelFromEnv } from '../_shared/providers/ai/live.ts';
import { availabilityLookup, runConcierge } from '../_shared/concierge/pipeline.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';

// Task 5.4: public web chat on the stylist's page. Off unless MOVA_CONCIERGE_WEB_CHAT_ENABLED=true and
// the stylist has the concierge and the web chat channel on. The model vendor waits on O8, so only
// MOVA_CONCIERGE_MODEL=fake is accepted; any other value refuses rather than calling a vendor.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_CONCIERGE_WEB_CHAT_ENABLED') !== 'true') return respond({ code: 'CHAT_NOT_AVAILABLE' }, 503);
  const model = conciergeModelFromEnv((name) => Deno.env.get(name));
  if (!model) return respond({ code: 'CONCIERGE_PROVIDER_NOT_CONFIGURED' }, 503);
  if (Number(request.headers.get('content-length') ?? '0') > 8192) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const handle = typeof body?.artist_handle === 'string' ? body.artist_handle.toLowerCase() : '';
  const threadId = typeof body?.thread_id === 'string' ? body.thread_id.toLowerCase() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const locale = body?.locale === 'es-US' ? 'es-US' : 'en-US';
  if (!/^[a-z0-9-]{3,30}$/.test(handle) || !UUID.test(threadId) || message.length < 1 || message.length > 1000) return respond({ code: 'INVALID_REQUEST' }, 422);

  const db = serviceClient();
  if (!await platformSwitchEnabled('concierge')) return respond({ code: 'CHAT_NOT_AVAILABLE' }, 503);
  const { data: profile } = await db.from('mova_artist_profiles').select('artist_business_id').eq('handle', handle).eq('is_published', true).maybeSingle();
  if (!profile) return respond({ code: 'ARTIST_NOT_AVAILABLE' }, 404);
  const outcome = await runConcierge(db, model, availabilityLookup(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''), {
    businessId: profile.artist_business_id, threadId, message, locale, site: Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co',
    // The client reads the reply from this response, so delivery is immediate.
    channel: { name: 'web_chat', deliver: () => Promise.resolve({ persisted: false, status: 'delivered' }) },
  });
  if (outcome.status === 'not_enabled') return respond({ code: 'CHAT_NOT_AVAILABLE' }, 503);
  if (outcome.status === 'rate_limited') return respond({ code: 'CHAT_RATE_LIMITED' }, 429);
  if (outcome.status === 'failed') return respond({ code: 'CHAT_SAVE_FAILED' }, 500);
  if (!('reply' in outcome)) return respond({ code: 'CHAT_SAVE_FAILED' }, 500);
  return respond({ reply: outcome.reply, needs_you: outcome.status === 'needs_you' });
});
