// Task 5.1: seat filler runtime. The database decides eligibility, ranking and who wins a claim
// (0056); this module sends each wave through the Phase 4 SMS adapter (consent, STOP, quiet hours and
// caps are enforced by its gate) and tells the rest when the spot is taken.
import { sendSms, type SmsDb, type SmsProvider } from './providers/sms/index.ts';

export type OfferLocale = 'en-US' | 'es-US';
export type OfferText = { first: string; when: string; location: string; service: string | null; price: string | null; link: string; stylist: string };

export function offerText(locale: OfferLocale, t: OfferText) {
  const service = t.service ? (locale === 'es-US' ? ` para ${t.service}${t.price ? ` (${t.price})` : ''}` : ` for ${t.service}${t.price ? ` (${t.price})` : ''}`) : '';
  return locale === 'es-US'
    ? `¡Hola ${t.first}! Se abrió un espacio ${t.when} en ${t.location}${service}. La primera persona en reservar se lo queda: ${t.link}. Responde STOP para no recibir más. — ${t.stylist}`
    : `Hi ${t.first}! A spot just opened ${t.when} at ${t.location}${service}. First to book gets it: ${t.link}. Reply STOP to opt out. — ${t.stylist}`;
}

export function takenText(locale: OfferLocale, link: string) {
  return locale === 'es-US' ? `Ese espacio ya se reservó. Aquí tienes otros horarios: ${link}` : `That spot was just taken. Here are other times: ${link}`;
}

export function formatWhen(startsAt: string, timeZone: string, locale: OfferLocale) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(startsAt));
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
export async function claimTokenHash(token: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))); }
export function newClaimToken() { return [...crypto.getRandomValues(new Uint8Array(24))].map((value) => value.toString(16).padStart(2, '0')).join(''); }

// deno-lint-ignore no-explicit-any
type Db = any;
export type WaveOutcome = { wave: number; sent: number; suppressed: number; failed: number };

/** Sends the next wave of a live (or just approved) campaign. */
export async function sendNextWave(db: Db, provider: SmsProvider, slotEventId: string, site: string, now = new Date()): Promise<WaveOutcome | null> {
  const { data: slot } = await db.from('mova_slot_events').select('id,artist_business_id,location_id,service_id,starts_at,status,current_wave,wave_minutes,expires_at,value_minor').eq('id', slotEventId).maybeSingle();
  if (!slot || !['needs_approval', 'live'].includes(slot.status) || Date.parse(slot.expires_at) <= now.getTime()) return null;
  const wave = Number(slot.current_wave) + 1;
  const { data: candidates } = await db.from('mova_slot_candidates').select('id,client_id,mova_clients(display_name,preferred_locale)').eq('slot_event_id', slot.id).eq('wave', wave).eq('status', 'planned').order('rank');
  const [{ data: profile }, { data: location }, { data: service }] = await Promise.all([
    db.from('mova_artist_profiles').select('display_name').eq('artist_business_id', slot.artist_business_id).maybeSingle(),
    db.from('mova_locations').select('name,time_zone').eq('id', slot.location_id).maybeSingle(),
    slot.service_id ? db.from('mova_services').select('name,base_price_minor').eq('id', slot.service_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const outcome: WaveOutcome = { wave, sent: 0, suppressed: 0, failed: 0 };
  for (const candidate of (candidates ?? []) as Array<{ id: string; client_id: string; mova_clients: { display_name: string; preferred_locale: string } | null }>) {
    const locale: OfferLocale = candidate.mova_clients?.preferred_locale === 'es-US' ? 'es-US' : 'en-US';
    const token = newClaimToken();
    await db.from('mova_slot_candidates').update({ claim_token_hash: await claimTokenHash(token) }).eq('id', candidate.id);
    const price = service?.base_price_minor != null ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(service.base_price_minor / 100) : null;
    const body = offerText(locale, {
      first: (candidate.mova_clients?.display_name ?? '').split(/\s+/)[0] || (locale === 'es-US' ? 'hola' : 'there'),
      when: formatWhen(slot.starts_at, location?.time_zone ?? 'America/New_York', locale), location: location?.name ?? '',
      service: service?.name ?? null, price, link: `${site}/slot/${token}`, stylist: String(profile?.display_name ?? '').split(/\s+/)[0] ?? '',
    });
    const sent = await sendSms(db as SmsDb, provider, { artistBusinessId: slot.artist_business_id, clientId: candidate.client_id, purpose: 'offers', origin: 'seat_filler', body, idempotencyKey: `slot:${slot.id}:${candidate.id}`, now });
    if (sent.status === 'sent' || sent.status === 'duplicate') {
      outcome.sent += 1;
      await db.from('mova_slot_candidates').update({ status: 'messaged', ...(sent.status === 'sent' ? { message_id: sent.messageId } : {}) }).eq('id', candidate.id);
    } else {
      if (sent.status === 'suppressed') outcome.suppressed += 1; else outcome.failed += 1;
      await db.from('mova_slot_candidates').update({ status: 'skipped', claim_token_hash: null }).eq('id', candidate.id);
    }
  }
  await db.from('mova_slot_events').update({ status: 'live', current_wave: wave, next_wave_at: new Date(now.getTime() + Number(slot.wave_minutes ?? 20) * 60_000).toISOString(), updated_at: now.toISOString() }).eq('id', slot.id);
  return outcome;
}

/** After a claim: everyone else who was texted gets "just taken" with a link to other times. */
export async function notifyTaken(db: Db, provider: SmsProvider, slotEventId: string, site: string, now = new Date()) {
  const { data: slot } = await db.from('mova_slot_events').select('id,artist_business_id').eq('id', slotEventId).maybeSingle();
  if (!slot) return 0;
  const { data: profile } = await db.from('mova_artist_profiles').select('handle').eq('artist_business_id', slot.artist_business_id).maybeSingle();
  const { data: others } = await db.from('mova_slot_candidates').select('id,client_id,mova_clients(preferred_locale)').eq('slot_event_id', slot.id).eq('status', 'messaged');
  let count = 0;
  for (const other of (others ?? []) as Array<{ id: string; client_id: string; mova_clients: { preferred_locale: string } | null }>) {
    const locale: OfferLocale = other.mova_clients?.preferred_locale === 'es-US' ? 'es-US' : 'en-US';
    const result = await sendSms(db as SmsDb, provider, { artistBusinessId: slot.artist_business_id, clientId: other.client_id, purpose: 'offers', origin: 'seat_filler', body: takenText(locale, `${site}/a/${profile?.handle ?? ''}/book`), idempotencyKey: `slot:${slot.id}:${other.id}:taken`, now });
    await db.from('mova_slot_candidates').update({ status: 'notified_taken', claim_token_hash: null }).eq('id', other.id);
    if (result.status === 'sent') count += 1;
  }
  return count;
}

/** slot.opened → campaign (needs approval). Autopilot sends wave 1 only when the platform flag and the stylist's switch are on. */
export async function consumeSlotOpened(db: Db, provider: SmsProvider | null, outboxEventId: string, env: (name: string) => string | undefined) {
  const { data: slotId } = await db.rpc('mova_slot_open_from_event', { p_outbox_event_id: outboxEventId });
  if (!slotId) return { slotId: null, candidates: 0, sent: null };
  const { data: candidates } = await db.rpc('mova_slot_build_campaign', { p_slot_event_id: slotId });
  const { data: slot } = await db.from('mova_slot_events').select('artist_business_id,status').eq('id', slotId).maybeSingle();
  const { data: features } = slot ? await db.rpc('mova_stylist_features', { p_artist_business_id: slot.artist_business_id }) : { data: null };
  const auto = env('MOVA_SEAT_FILLER_ENABLED') === 'true' && provider && features?.seat_filler_autopilot === true && slot?.status === 'needs_approval';
  const sent = auto ? await sendNextWave(db, provider!, slotId, env('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co') : null;
  return { slotId, candidates: Number(candidates ?? 0), sent };
}
