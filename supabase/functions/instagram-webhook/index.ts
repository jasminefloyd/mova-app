import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { conciergeModelFromEnv } from '../_shared/providers/ai/live.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';
import { metaMessagingProviderFromEnv } from '../_shared/providers/meta/live.ts';
import { decryptProviderSecret } from '../_shared/provider-crypto.ts';
import { loggedProviderFetch } from '../_shared/system-log.ts';
import { availabilityLookup, runConcierge } from '../_shared/concierge/pipeline.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';

// Task 5.5 + Connections › Meta (CN5): Instagram DMs and Facebook Page messages into the concierge, with
// the O8 model adapter. The account a message was sent to is matched to a stylist through an active
// mova_sending_identities row (channel 'instagram' = Instagram account id, 'messenger' = Page id), set by
// meta-connect. Live Meta needs MOVA_META_PROVIDER=meta (owner decision O6); GET answers Meta's
// webhook verification with MOVA_META_VERIFY_TOKEN.
Deno.serve(withSystemRequestLogging('instagram-webhook', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const verify = Deno.env.get('MOVA_META_VERIFY_TOKEN');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (!verify || url.searchParams.get('hub.mode') !== 'subscribe' || url.searchParams.get('hub.verify_token') !== verify || !/^[0-9A-Za-z_-]{1,128}$/.test(challenge)) return respond({ code: 'WEBHOOK_VERIFY_FAILED' }, 403);
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!await platformSwitchEnabled('concierge')) return respond({ code: 'CHANNEL_NOT_ENABLED' }, 503);
  if (Deno.env.get('MOVA_INSTAGRAM_CONCIERGE_ENABLED') !== 'true') return respond({ code: 'CHANNEL_NOT_ENABLED' }, 503);
  const provider = metaMessagingProviderFromEnv((name) => Deno.env.get(name), loggedProviderFetch(request, 'meta'));
  const model = conciergeModelFromEnv((name) => Deno.env.get(name));
  if (!provider || !model) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
  if (Number(request.headers.get('content-length') ?? '0') > 65536) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const inbound = await provider.parseInbound(request);
  if (!inbound) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const db = serviceClient();
  const { data: identity } = await db.from('mova_sending_identities').select('artist_business_id').eq('channel', inbound.channel).eq('address', inbound.pageId).eq('status', 'active').maybeSingle();
  if (!identity) return respond({ accepted: true, routed: false });
  // Replies always go out through the stylist's Facebook Page token (live Meta only).
  const { data: meta } = await db.from('mova_meta_connections').select('status,page_id,page_token_encrypted').eq('artist_business_id', identity.artist_business_id).maybeSingle();
  if (provider.live && meta?.status !== 'active') return respond({ accepted: true, routed: false });
  if (meta?.status === 'active') await db.from('mova_meta_connections').update({ last_message_at: new Date().toISOString() }).eq('artist_business_id', identity.artist_business_id);
  const pageToken = provider.live && meta ? await decryptProviderSecret(meta.page_token_encrypted) : undefined;
  if (!await planFeatureEnabled(identity.artist_business_id, 'concierge_instagram')) return respond({ accepted: true, routed: false });
  const outcome = await runConcierge(db, model, availabilityLookup(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''), {
    businessId: identity.artist_business_id, threadId: inbound.senderId, message: inbound.text, locale: /[¿¡ñáéíóú]/i.test(inbound.text) ? 'es-US' : 'en-US',
    inboundProvider: provider.name, inboundProviderMessageId: inbound.messageId, site: Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co',
    channel: {
      name: inbound.channel,
      deliver: async (reply) => {
        const sent = await provider.send({ pageId: meta?.page_id ?? inbound.pageId, recipientId: inbound.senderId, text: reply.text, idempotencyKey: `${inbound.channel}:out:${reply.inboundMessageId}`, accessToken: pageToken, channel: inbound.channel });
        return { persisted: false, status: 'sent', provider: provider.name, providerMessageId: sent.messageId };
      },
    },
  });
  return respond({ accepted: true, routed: true, status: outcome.status });
}));
