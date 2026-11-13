import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { serviceClient, respond, corsHeaders } from '../_shared/booking.ts';
import { sha256Hex } from '../_shared/provider-crypto.ts';

Deno.serve(withSystemRequestLogging('client-card-landing', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_CLIENT_PROFILES_ENABLED') !== 'true') return respond({ code: 'CLIENT_PROFILES_DISABLED' }, 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return respond({ code: 'CARD_NOT_AVAILABLE' }, 404);

  const db = serviceClient();
  const { data: card } = await db.from('mova_client_card_tokens').select('artist_business_id,client_id,customer_account_id')
    .eq('token_hash', await sha256Hex(body.token)).is('revoked_at', null).maybeSingle();
  if (!card) return respond({ code: 'CARD_NOT_AVAILABLE' }, 404);
  const { data: link } = await db.from('mova_client_customer_links').select('id')
    .eq('artist_business_id', card.artist_business_id).eq('client_id', card.client_id)
    .eq('customer_account_id', card.customer_account_id).is('unlinked_at', null).maybeSingle();
  if (!link) return respond({ code: 'CARD_NOT_AVAILABLE' }, 404);

  const [profileResult, accountResult, appointmentResult] = await Promise.all([
    db.from('mova_artist_profiles').select('display_name,handle,specialties,is_published').eq('artist_business_id', card.artist_business_id).eq('is_published', true).maybeSingle(),
    db.from('mova_customer_accounts').select('display_name').eq('id', card.customer_account_id).eq('status', 'active').maybeSingle(),
    db.from('mova_appointments').select('id,service_name_snapshot,starts_at,status,mova_locations(name)')
      .eq('artist_business_id', card.artist_business_id).eq('client_id', card.client_id)
      .in('status', ['confirmed', 'pending_artist', 'pending_payment']).gt('starts_at', new Date().toISOString())
      .order('starts_at').limit(1).maybeSingle(),
  ]);
  if (profileResult.error || !profileResult.data || accountResult.error || !accountResult.data) return respond({ code: 'CARD_NOT_AVAILABLE' }, 404);
  if (appointmentResult.error) return respond({ code: 'CARD_DATA_UNAVAILABLE' }, 503);
  const appointment = appointmentResult.data as unknown as { id: string; service_name_snapshot: string; starts_at: string; status: string; mova_locations: { name: string } | null } | null;
  const {data:serviceRows,error:serviceError}=appointment?await db.from('mova_appointment_services').select('service_name_snapshot').eq('artist_business_id',card.artist_business_id).eq('appointment_id',appointment.id).order('position'):{data:[],error:null};
  if(serviceError)return respond({code:'CARD_DATA_UNAVAILABLE'},503);
  const serviceNames=serviceRows?.map((item)=>item.service_name_snapshot)??(appointment?[appointment.service_name_snapshot]:[]);
  return respond({
    card: { client_name: accountResult.data.display_name, artist_name: profileResult.data.display_name, handle: profileResult.data.handle, specialties: profileResult.data.specialties },
    upcoming: appointment ? { service: serviceNames.join(' + '), starts_at: appointment.starts_at, status: appointment.status, location: appointment.mova_locations?.name ?? '' } : null,
  });
}));
