import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { smsProviderFromEnv } from '../_shared/providers/sms/index.ts';
import { claimTokenHash, notifyTaken } from '../_shared/seat-filler.ts';

// Task 5.1 (board 31d): a texted client views and claims an opened spot. The token in the link is the
// only credential; the database stores its hash and mova_slot_claim (0056) decides who wins.
const TOKEN = /^[0-9a-f]{48}$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await request.json().catch(() => ({}));
  if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return respond({ code: 'INVALID_TOKEN' }, 422);
  const db = serviceClient();
  const hash = await claimTokenHash(body.token);
  const { data: candidate } = await db.from('mova_slot_candidates').select('id,status,slot_event_id,mova_clients(preferred_locale)').eq('claim_token_hash', hash).maybeSingle();
  if (!candidate) return respond({ status: 'invalid' });
  const { data: slot } = await db.from('mova_slot_events').select('id,artist_business_id,starts_at,ends_at,status,expires_at,service_id,location_id').eq('id', candidate.slot_event_id).maybeSingle();
  if (!slot) return respond({ status: 'invalid' });
  const [{ data: profile }, { data: location }, { data: service }] = await Promise.all([
    db.from('mova_artist_profiles').select('display_name,handle').eq('artist_business_id', slot.artist_business_id).maybeSingle(),
    db.from('mova_locations').select('name,time_zone,booking_mode').eq('id', slot.location_id).maybeSingle(),
    slot.service_id ? db.from('mova_services').select('name,base_price_minor').eq('id', slot.service_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const view = {
    stylist: profile?.display_name ?? '', handle: profile?.handle ?? '', starts_at: slot.starts_at, ends_at: slot.ends_at,
    time_zone: location?.time_zone ?? 'America/New_York', location: location?.name ?? '', booking_mode: location?.booking_mode ?? 'instant',
    service: service?.name ?? null, price_minor: service?.base_price_minor ?? null,
  };
  const current = slot.status === 'filled' ? (candidate.status === 'claimed' ? 'claimed' : 'taken')
    : slot.status === 'live' && Date.parse(slot.expires_at) > Date.now() && candidate.status === 'messaged' ? 'open' : 'expired';
  if (body.action !== 'claim') return respond({ status: current, slot: view });
  if (current !== 'open') return respond({ status: current, slot: view });
  const { data: result, error } = await db.rpc('mova_slot_claim', { p_token_hash: hash });
  if (error || !result) return respond({ code: 'CLAIM_FAILED' }, 500);
  if (result.status === 'claimed') {
    const provider = Deno.env.get('MOVA_SEAT_FILLER_ENABLED') === 'true' ? smsProviderFromEnv((name) => Deno.env.get(name)) : null;
    if (provider) await notifyTaken(db, provider, slot.id, Deno.env.get('PUBLIC_SITE_URL') ?? 'https://mova-beauty.co').catch(() => 0);
  }
  return respond({ status: result.status, slot: view, appointment_status: result.appointment_status ?? null, manage_token: result.manage_token ?? null });
});
