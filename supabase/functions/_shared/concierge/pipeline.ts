// Task 5.4/5.5: one concierge pipeline for every channel (web chat, text, Instagram). The channel
// adapter only delivers the reply; everything else — channel switches, the daily AI turn cap,
// pauses and takeovers, the turn itself, handoffs to Needs you, quote requests and the turn log —
// happens here the same way for all channels.
import type { ConciergeModel } from '../providers/ai/types.ts';
import { handleTurn, type OpenTime, type TurnKnowledge, type TurnResult } from './turn.ts';
import { replies, type Locale } from './replies.ts';

export type ConciergeChannelName = 'web_chat' | 'sms' | 'instagram';
export type Delivery = { persisted: boolean; status: 'delivered' | 'sent' | 'suppressed' | 'failed'; provider?: string; providerMessageId?: string };
export type ConciergeChannel = {
  name: ConciergeChannelName;
  /** Delivers the reply. Return persisted=true when the adapter already logged it in mova_messages (SMS does). */
  deliver(reply: { text: string; conversationId: string; inboundMessageId: string; businessId: string; threadId: string; clientId: string | null }): Promise<Delivery>;
};

// deno-lint-ignore no-explicit-any
type Db = any;
export type PipelineInput = {
  businessId: string;
  channel: ConciergeChannel;
  threadId: string;
  message: string;
  locale: Locale;
  clientId?: string | null;
  inboundProvider?: string | null;
  inboundProviderMessageId?: string | null;
  /** Set when the inbound text is already logged elsewhere (SMS logs it in 0042), to avoid a duplicate provider id. */
  inboundIdempotencyKey?: string;
  site: string;
  now?: Date;
};
export type PipelineOutcome =
  | { status: 'not_enabled' | 'rate_limited' | 'failed' }
  | { status: 'replied' | 'needs_you'; reply: string; delivery: Delivery; turn: TurnResult | null };

export const THREAD_HOURLY_LIMIT = 30;

export async function runConcierge(db: Db, model: ConciergeModel, findTimes: (serviceId: string) => Promise<OpenTime[]>, input: PipelineInput): Promise<PipelineOutcome> {
  const now = input.now ?? new Date();
  const channel = input.channel.name;
  const [{ data: settings }, { data: profile }] = await Promise.all([
    db.from('mova_concierge_settings').select('enabled,channels,permissions,languages,daily_ai_turn_cap,globally_paused').eq('artist_business_id', input.businessId).maybeSingle(),
    db.from('mova_artist_profiles').select('display_name,handle').eq('artist_business_id', input.businessId).maybeSingle(),
  ]);
  const channels = (settings?.channels ?? {}) as Record<string, boolean>;
  if (!settings?.enabled || settings.globally_paused || channels[channel] !== true || !profile) return { status: 'not_enabled' };

  let { data: conversation } = await db.from('mova_conversations').select('id,status,ai_enabled,pause_until,client_id').eq('artist_business_id', input.businessId).eq('channel', channel).eq('external_thread_id', input.threadId).maybeSingle();
  if (!conversation) {
    const { data, error } = await db.from('mova_conversations').insert({ artist_business_id: input.businessId, channel, external_thread_id: input.threadId, client_id: input.clientId ?? null, locale: input.locale, status: 'handled', ai_enabled: true }).select('id,status,ai_enabled,pause_until,client_id').single();
    if (error || !data) return { status: 'failed' };
    conversation = data;
  }
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const { count: recent } = await db.from('mova_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id).eq('direction', 'inbound').gte('created_at', hourAgo);
  if ((recent ?? 0) >= THREAD_HOURLY_LIMIT) return { status: 'rate_limited' };

  const messageChannel = channel === 'web_chat' ? 'web_chat' : channel;
  const { data: inbound, error: inboundError } = await db.from('mova_messages').insert({
    artist_business_id: input.businessId, client_id: conversation.client_id ?? null, conversation_id: conversation.id, direction: 'inbound', channel: messageChannel,
    purpose: 'concierge', origin: 'concierge', body: input.message, status: 'received', provider: input.inboundProvider ?? null, provider_message_id: input.inboundProviderMessageId ?? null,
    idempotency_key: input.inboundIdempotencyKey ?? `${channel}:in:${input.inboundProviderMessageId ?? crypto.randomUUID()}`,
  }).select('id').single();
  if (inboundError || !inbound) return { status: 'failed' };

  const name = String(profile.display_name).split(/\s+/)[0] || String(profile.display_name);
  const finish = async (text: string, needsYou: boolean, turn: TurnResult | null): Promise<PipelineOutcome> => {
    const delivery = await input.channel.deliver({ text, conversationId: conversation.id, inboundMessageId: inbound.id, businessId: input.businessId, threadId: input.threadId, clientId: conversation.client_id ?? null }).catch((): Delivery => ({ persisted: false, status: 'failed' }));
    if (!delivery.persisted) {
      await db.from('mova_messages').insert({
        artist_business_id: input.businessId, client_id: conversation.client_id ?? null, conversation_id: conversation.id, direction: 'outbound', channel: messageChannel,
        purpose: 'concierge', origin: 'concierge', body: text, status: delivery.status, provider: delivery.provider ?? null, provider_message_id: delivery.providerMessageId ?? null,
        idempotency_key: `${channel}:out:${inbound.id}`, sent_at: now.toISOString(), ...(delivery.status === 'delivered' ? { delivered_at: now.toISOString() } : {}),
      });
    }
    const stuck = needsYou || delivery.status === 'failed' || delivery.status === 'suppressed';
    await db.from('mova_conversations').update({ last_message_at: now.toISOString(), ...(stuck ? { status: 'needs_you' } : {}) }).eq('id', conversation.id);
    return { status: stuck ? 'needs_you' : 'replied', reply: text, delivery, turn };
  };

  const paused = !conversation.ai_enabled || conversation.status === 'needs_you' || (conversation.pause_until && Date.parse(conversation.pause_until) > now.getTime());
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: turnsToday } = await db.from('mova_concierge_turns').select('id', { count: 'exact', head: true }).eq('artist_business_id', input.businessId).gte('created_at', dayStart.toISOString());
  if (paused || (turnsToday ?? 0) >= Number(settings.daily_ai_turn_cap ?? 0)) return finish(replies(input.locale).paused(name), true, null);
  // O8: platform-wide monthly model spend cap ($25). At or over it, every channel goes to the stylist.
  const { data: spend, error: spendError } = await db.rpc('mova_concierge_month_spend');
  if (spendError || !spend || Number(spend.spent_micros) >= Number(spend.cap_micros)) return finish(replies(input.locale).paused(name), true, null);

  const [{ data: knowledge }, { data: services }] = await Promise.all([
    db.from('mova_concierge_knowledge').select('id,kind,question,answer_en,answer_es').eq('artist_business_id', input.businessId).eq('status', 'active'),
    db.from('mova_services').select('id,name,base_price_minor').eq('artist_business_id', input.businessId).eq('status', 'active').order('name'),
  ]);
  const started = Date.now();
  const result = await handleTurn(input.message, {
    stylistName: name, bookUrl: `${input.site}/a/${profile.handle}/book`, locale: input.locale,
    languages: ((settings.languages ?? ['en-US']) as string[]).filter((value): value is Locale => value === 'en-US' || value === 'es-US'),
    permissions: (settings.permissions ?? {}) as Record<string, boolean>,
    knowledge: (knowledge ?? []) as TurnKnowledge[],
    services: ((services ?? []) as Array<{ id: string; name: string; base_price_minor: number }>).map((row) => ({ id: row.id, name: row.name, price_minor: row.base_price_minor })),
  }, { model, findTimes });
  const outcome = await finish(result.reply, result.decision !== 'replied', result);
  await db.from('mova_concierge_turns').insert({
    conversation_id: conversation.id, artist_business_id: input.businessId, inbound_message_id: inbound.id, model: result.model, prompt_version: 'concierge-v1',
    tool_calls: result.toolCalls, decision: result.decision, intent: result.intent, confidence: Math.round(result.confidence * 10000) / 10000, latency_ms: Date.now() - started, cost_micros: result.costMicros,
  });
  if (result.handoff) await db.from('mova_handoffs').insert({ artist_business_id: input.businessId, conversation_id: conversation.id, type: result.handoff.type, summary: result.handoff.summary });
  if (result.quote) await db.from('mova_quote_requests').insert({ artist_business_id: input.businessId, conversation_id: conversation.id, client_id: conversation.client_id ?? null, service_category: result.quote.service_category, details: result.quote.details });
  return outcome;
}

/** Open times from the availability-search function, called with the service role. */
export function availabilityLookup(supabaseUrl: string, serviceKey: string, now = new Date()) {
  return async (serviceId: string): Promise<OpenTime[]> => {
    const response = await fetch(`${supabaseUrl}/functions/v1/availability-search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ service_id: serviceId, from_date: now.toISOString().slice(0, 10), days: 14 }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(json?.data?.groups)) throw new Error('AVAILABILITY_FAILED');
    return (json.data.groups as Array<{ location_name: string; booking_mode: 'instant' | 'request'; slots: Array<{ starts_at: string; time_zone: string }> }>)
      .flatMap((group) => group.slots.map((slot) => ({ starts_at: slot.starts_at, time_zone: slot.time_zone, location_name: group.location_name, booking_mode: group.booking_mode })))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  };
}
