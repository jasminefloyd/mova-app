import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { conciergeModelFromEnv } from '../_shared/providers/ai/live.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';
import { instagramProviderFromEnv } from '../_shared/providers/meta/fake.ts';
import { availabilityLookup, runConcierge } from '../_shared/concierge/pipeline.ts';

// Task 5.5: Instagram direct messages into the concierge. Only the fake provider exists (Meta waits on
// O6) with the O8 model adapter. The Instagram account is matched to a stylist through an active
// mova_sending_identities row (channel 'instagram', address = page id).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!await platformSwitchEnabled('concierge')) return respond({ code: 'CHANNEL_NOT_ENABLED' }, 503);
  if (Deno.env.get('MOVA_INSTAGRAM_CONCIERGE_ENABLED') !== 'true') return respond({ code: 'CHANNEL_NOT_ENABLED' }, 503);
  const provider = instagramProviderFromEnv((name) => Deno.env.get(name));
  const model = conciergeModelFromEnv((name) => Deno.env.get(name));
  if (!provider || !model) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
  if (Number(request.headers.get('content-length') ?? '0') > 8192) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const inbound = await provider.parseInbound(request);
  if (!inbound) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const db = serviceClient();
  const { data: identity } = await db.from('mova_sending_identities').select('artist_business_id').eq('channel', 'instagram').eq('address', inbound.pageId).eq('status', 'active').maybeSingle();
  if (!identity) return respond({ accepted: true, routed: false });
  const outcome = await runConcierge(db, model, availabilityLookup(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''), {
    businessId: identity.artist_business_id, threadId: inbound.senderId, message: inbound.text, locale: /[¿¡ñáéíóú]/i.test(inbound.text) ? 'es-US' : 'en-US',
    inboundProvider: provider.name, inboundProviderMessageId: inbound.messageId, site: Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co',
    channel: {
      name: 'instagram',
      deliver: async (reply) => {
        const sent = await provider.send({ pageId: inbound.pageId, recipientId: inbound.senderId, text: reply.text, idempotencyKey: `instagram:out:${reply.inboundMessageId}` });
        return { persisted: false, status: 'sent', provider: provider.name, providerMessageId: sent.messageId };
      },
    },
  });
  return respond({ accepted: true, routed: true, status: outcome.status });
});
