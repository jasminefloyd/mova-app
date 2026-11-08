import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { FakeConciergeModel } from '../_shared/providers/ai/fake.ts';
import type { ConciergeModel } from '../_shared/providers/ai/types.ts';
import { handleTurn, type OpenTime, type TurnKnowledge } from '../_shared/concierge/turn.ts';
import { replies } from '../_shared/concierge/replies.ts';

// Task 5.4: public web chat on the stylist's page. Off unless MOVA_CONCIERGE_WEB_CHAT_ENABLED=true and
// the stylist has the concierge and the web chat channel on. The model vendor waits on O8, so only
// MOVA_CONCIERGE_MODEL=fake is accepted; any other value refuses rather than calling a vendor.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const THREAD_HOURLY_LIMIT = 30;

function model(): ConciergeModel | null {
  return Deno.env.get('MOVA_CONCIERGE_MODEL') === 'fake' ? new FakeConciergeModel() : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_CONCIERGE_WEB_CHAT_ENABLED') !== 'true') return respond({ code: 'CHAT_NOT_AVAILABLE' }, 503);
  const concierge = model();
  if (!concierge) return respond({ code: 'CONCIERGE_PROVIDER_NOT_CONFIGURED' }, 503);
  if (Number(request.headers.get('content-length') ?? '0') > 8192) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const handle = typeof body?.artist_handle === 'string' ? body.artist_handle.toLowerCase() : '';
  const threadId = typeof body?.thread_id === 'string' ? body.thread_id.toLowerCase() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const locale = body?.locale === 'es-US' ? 'es-US' : 'en-US';
  if (!/^[a-z0-9-]{3,30}$/.test(handle) || !UUID.test(threadId) || message.length < 1 || message.length > 1000) return respond({ code: 'INVALID_REQUEST' }, 422);

  const db = serviceClient();
  const { data: profile } = await db.from('mova_artist_profiles').select('artist_business_id,display_name,handle').eq('handle', handle).eq('is_published', true).maybeSingle();
  if (!profile) return respond({ code: 'ARTIST_NOT_AVAILABLE' }, 404);
  const businessId = profile.artist_business_id as string;
  const { data: settings } = await db.from('mova_concierge_settings').select('enabled,channels,permissions,languages,daily_ai_turn_cap,globally_paused').eq('artist_business_id', businessId).maybeSingle();
  const channels = (settings?.channels ?? {}) as Record<string, boolean>;
  if (!settings?.enabled || settings.globally_paused || channels.web_chat !== true) return respond({ code: 'CHAT_NOT_AVAILABLE' }, 503);

  let { data: conversation } = await db.from('mova_conversations').select('id,status,ai_enabled,pause_until').eq('artist_business_id', businessId).eq('channel', 'web_chat').eq('external_thread_id', threadId).maybeSingle();
  if (!conversation) {
    const { data, error } = await db.from('mova_conversations').insert({ artist_business_id: businessId, channel: 'web_chat', external_thread_id: threadId, locale, status: 'handled', ai_enabled: true }).select('id,status,ai_enabled,pause_until').single();
    if (error || !data) return respond({ code: 'CHAT_SAVE_FAILED' }, 500);
    conversation = data;
  }
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await db.from('mova_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id).eq('direction', 'inbound').gte('created_at', hourAgo);
  if ((recent ?? 0) >= THREAD_HOURLY_LIMIT) return respond({ code: 'CHAT_RATE_LIMITED' }, 429);

  const now = new Date();
  const { data: inbound, error: inboundError } = await db.from('mova_messages').insert({
    artist_business_id: businessId, conversation_id: conversation.id, direction: 'inbound', channel: 'web_chat', purpose: 'concierge', origin: 'concierge',
    body: message, status: 'received', idempotency_key: `web_chat:in:${crypto.randomUUID()}`,
  }).select('id').single();
  if (inboundError || !inbound) return respond({ code: 'CHAT_SAVE_FAILED' }, 500);

  const name = (profile.display_name as string).split(/\s+/)[0] ?? profile.display_name;
  const reply = async (text: string, needsYou: boolean) => {
    await db.from('mova_messages').insert({ artist_business_id: businessId, conversation_id: conversation!.id, direction: 'outbound', channel: 'web_chat', purpose: 'concierge', origin: 'concierge', body: text, status: 'delivered', idempotency_key: `web_chat:out:${inbound.id}`, sent_at: now.toISOString(), delivered_at: now.toISOString() });
    await db.from('mova_conversations').update({ last_message_at: now.toISOString(), ...(needsYou ? { status: 'needs_you' } : {}) }).eq('id', conversation!.id);
    return respond({ reply: text, needs_you: needsYou });
  };

  // The stylist took over, paused this thread, or the day's AI turn cap is used: the stylist answers.
  const paused = !conversation.ai_enabled || conversation.status === 'needs_you' || (conversation.pause_until && Date.parse(conversation.pause_until) > now.getTime());
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: turnsToday } = await db.from('mova_concierge_turns').select('id', { count: 'exact', head: true }).eq('artist_business_id', businessId).gte('created_at', dayStart.toISOString());
  if (paused || (turnsToday ?? 0) >= Number(settings.daily_ai_turn_cap ?? 0)) return reply(replies(locale).paused(name), true);

  const [{ data: knowledge }, { data: services }] = await Promise.all([
    db.from('mova_concierge_knowledge').select('id,kind,question,answer_en,answer_es').eq('artist_business_id', businessId).eq('status', 'active'),
    db.from('mova_services').select('id,name,base_price_minor').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
  ]);
  const findTimes = async (serviceId: string): Promise<OpenTime[]> => {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/availability-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ service_id: serviceId, from_date: now.toISOString().slice(0, 10), days: 14 }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(json?.data?.groups)) throw new Error('AVAILABILITY_FAILED');
    return (json.data.groups as Array<{ location_name: string; booking_mode: 'instant' | 'request'; slots: Array<{ starts_at: string; time_zone: string }> }>)
      .flatMap((group) => group.slots.map((slot) => ({ starts_at: slot.starts_at, time_zone: slot.time_zone, location_name: group.location_name, booking_mode: group.booking_mode })))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  };
  const site = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co';
  const started = Date.now();
  const result = await handleTurn(message, {
    stylistName: name, bookUrl: `${site}/a/${profile.handle}/book`, locale,
    languages: ((settings.languages ?? ['en-US']) as string[]).filter((value): value is 'en-US' | 'es-US' => value === 'en-US' || value === 'es-US'),
    permissions: (settings.permissions ?? {}) as Record<string, boolean>,
    knowledge: (knowledge ?? []) as TurnKnowledge[],
    services: (services ?? []).map((row) => ({ id: row.id as string, name: row.name as string, price_minor: row.base_price_minor as number })),
  }, { model: concierge, findTimes });

  const needsYou = result.decision !== 'replied';
  const out = await reply(result.reply, needsYou);
  await db.from('mova_concierge_turns').insert({
    conversation_id: conversation.id, artist_business_id: businessId, inbound_message_id: inbound.id, model: result.model, prompt_version: 'concierge-v1',
    tool_calls: result.toolCalls, decision: result.decision, intent: result.intent, confidence: Math.round(result.confidence * 10000) / 10000, latency_ms: Date.now() - started, cost_micros: 0,
  });
  if (result.handoff) await db.from('mova_handoffs').insert({ artist_business_id: businessId, conversation_id: conversation.id, type: result.handoff.type, summary: result.handoff.summary });
  if (result.quote) await db.from('mova_quote_requests').insert({ artist_business_id: businessId, conversation_id: conversation.id, service_category: result.quote.service_category, details: result.quote.details });
  return out;
});
