import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { handleInboundSms, smsProviderFromEnv, type SmsDb } from '../_shared/providers/sms/index.ts';
import { conciergeModelFromEnv } from '../_shared/providers/ai/live.ts';
import { smsConcierge } from '../_shared/concierge/sms-channel.ts';

// Task 4.4: inbound SMS webhook. The provider adapter verifies the signature and parses the payload;
// STOP/START/HELP are applied in mova_sms_handle_inbound (0042). Only the fake provider exists today.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Number(request.headers.get('content-length') ?? '0') > 8192) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const provider = smsProviderFromEnv((name) => Deno.env.get(name));
  if (!provider) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
  const inbound = await provider.parseInbound(request);
  if (!inbound) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  try {
    const db = serviceClient();
    const outcome = await handleInboundSms(db as unknown as SmsDb, provider, inbound);
    // Task 5.5: a non-keyword text from a known client can go to the concierge (flag, default off).
    const model = conciergeModelFromEnv((name) => Deno.env.get(name));
    const concierge = outcome.keyword || !model ? { routed: 0 } : await smsConcierge(db, provider, model, inbound, (name) => Deno.env.get(name)).catch(() => ({ routed: 0 }));
    return respond({ accepted: true, ...outcome, concierge_routed: concierge.routed });
  } catch {
    return respond({ code: 'INBOUND_SAVE_FAILED' }, 500);
  }
});
