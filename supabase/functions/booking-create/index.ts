import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';
import { normalizeBookingConsentChoices } from '../_shared/booking-consent.ts';
import { checkCaptcha } from '../_shared/captcha.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders});
  if (request.method !== 'POST') return respond({code:'METHOD_NOT_ALLOWED'},405);
  const body = await request.json().catch(()=>null); const idempotencyKey = request.headers.get('Idempotency-Key') ?? body?.idempotency_key;
  const serviceIds = Array.isArray(body?.service_ids) ? body.service_ids : typeof body?.service_id === 'string' ? [body.service_id] : [];
  if (!body || !idempotencyKey || typeof body.manage_token!=='string' || body.manage_token.length<40 || typeof body.location_id!=='string' || serviceIds.length < 1 || serviceIds.length > 8 || serviceIds.some((id: unknown)=>typeof id!=='string') || new Set(serviceIds).size!==serviceIds.length || typeof body.starts_at!=='string' || typeof body.client_name!=='string' || !['en-US','es-US'].includes(body.client_locale)) return respond({code:'INVALID_REQUEST'},422);
  if (body.alternate_starts_at != null && (typeof body.alternate_starts_at !== 'string' || !Number.isFinite(Date.parse(body.alternate_starts_at)))) return respond({code:'INVALID_ALTERNATE_TIME'},422);
  if (body.client_note != null && (typeof body.client_note !== 'string' || body.client_note.trim().length > 1000)) return respond({code:'INVALID_CLIENT_NOTE'},422);
  if (body.portfolio_item_id != null && (typeof body.portfolio_item_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.portfolio_item_id))) return respond({code:'INVALID_PORTFOLIO_LOOK'},422);
  if (!body.client_email && !body.client_phone) return respond({code:'CONTACT_REQUIRED'},422);
  const captcha = await checkCaptcha(body.captcha_token, (name) => Deno.env.get(name));
  if (!captcha.ok) return respond({ code: captcha.code }, captcha.status);
  const consentChoices=normalizeBookingConsentChoices(body.consents);
  if(!consentChoices)return respond({code:'BOOKING_CONSENTS_INVALID'},422);
  try {
  const manageToken = body.manage_token; const db=serviceClient();
    const stripeTestMode = Deno.env.get('MOVA_STRIPE_TEST_MODE') === 'true';
    if (stripeTestMode && !Deno.env.get('STRIPE_SECRET_KEY')?.startsWith('sk_test_')) return respond({code:'STRIPE_TEST_CONFIGURATION_MISSING'},503);
    const {data,error}=await db.rpc(stripeTestMode?'mova_booking_create_multi_with_consent_checkout':'mova_booking_create_multi_with_consent',{p_location_id:body.location_id,p_service_ids:serviceIds,p_starts_at:body.starts_at,p_client_name:body.client_name,p_client_email:body.client_email??null,p_client_phone:body.client_phone??null,p_client_locale:body.client_locale,p_idempotency_key:idempotencyKey,p_manage_token_hash:await tokenHash(manageToken),p_alternate_starts_at:body.alternate_starts_at??null,p_client_note:body.client_note??null,p_portfolio_item_id:body.portfolio_item_id??null,p_consent_choices:consentChoices});
    if(error) return respond({code:error.message||'BOOKING_CREATE_FAILED'},error.code==='23505'?409:422);
    const origin=(Deno.env.get('PUBLIC_BASE_URL')??'https://mova-beauty.co').replace(/\/$/,'');
    return respond({...data,manage_url:`${origin}/b/${encodeURIComponent(manageToken)}`},data.replayed?200:201);
  } catch { return respond({code:'BOOKING_CREATE_FAILED'},500); }
});
