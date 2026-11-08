import { sendSms, type SmsDb, type SmsProvider } from '../providers/sms/index.ts';
import type { ConciergeModel } from '../providers/ai/types.ts';
import { availabilityLookup, runConcierge } from './pipeline.ts';

// Task 5.5: text-message concierge. Runs after STOP/START/HELP handling, only for a known client of the
// stylist who owns the receiving number, and replies through the task 4.4 SMS adapter (sendSms), so
// consent, STOP, quiet hours and caps apply. Off unless MOVA_SMS_CONCIERGE_ENABLED=true.
// deno-lint-ignore no-explicit-any
export async function smsConcierge(db: any, provider: SmsProvider, model: ConciergeModel, inbound: { from: string; to: string; text: string; providerMessageId: string | null }, env: (name: string) => string | undefined) {
  if (env('MOVA_SMS_CONCIERGE_ENABLED') !== 'true') return { routed: 0 };
  const { data: identities } = await db.from('mova_sending_identities').select('artist_business_id').eq('channel', 'sms').eq('address', inbound.to).eq('status', 'active');
  const digits = inbound.from.replace(/\D/g, '');
  let routed = 0;
  for (const identity of (identities ?? []) as Array<{ artist_business_id: string }>) {
    const { data: client } = await db.from('mova_clients').select('id,preferred_locale').eq('artist_business_id', identity.artist_business_id).in('phone_normalized', [inbound.from, `+${digits}`, digits]).limit(1).maybeSingle();
    if (!client) continue;
    await runConcierge(db, model, availabilityLookup(env('SUPABASE_URL') ?? '', env('SUPABASE_SERVICE_ROLE_KEY') ?? ''), {
      businessId: identity.artist_business_id, threadId: `+${digits}`, clientId: client.id, message: inbound.text,
      locale: client.preferred_locale === 'es-US' ? 'es-US' : 'en-US', inboundIdempotencyKey: `sms:concierge-in:${inbound.providerMessageId ?? crypto.randomUUID()}`,
      site: env('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co',
      channel: {
        name: 'sms',
        deliver: async (reply) => {
          const outcome = await sendSms(db as SmsDb, provider, { artistBusinessId: reply.businessId, clientId: client.id, purpose: 'transactional', origin: 'concierge', body: reply.text, idempotencyKey: `sms:out:${reply.inboundMessageId}`, conversationId: reply.conversationId });
          return { persisted: true, status: outcome.status === 'sent' || outcome.status === 'duplicate' ? 'sent' : outcome.status === 'suppressed' ? 'suppressed' : 'failed' };
        },
      },
    });
    routed += 1;
  }
  return { routed };
}
