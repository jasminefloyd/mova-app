import { artistClient, corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const body=await request.json().catch(()=>null);
  if(!body||(!['cancelled','confirmed','declined','no_show','completed'].includes(body.to_status)&&!['accept','decline'].includes(body.reschedule_action)&&!['accept','decline'].includes(body.suggestion_action)&&typeof body.suggested_starts_at!=='string'&&typeof body.artist_reschedule_starts_at!=='string'))return respond({code:'INVALID_REQUEST'},422);
  const db=serviceClient();const actor=await artistClient(request);let hash='';let actorType='guest';let bookingQuery=db.from('mova_appointments').select('id,manage_token_hash,artist_business_id');
  if(typeof body.token==='string'){hash=await tokenHash(body.token);bookingQuery=bookingQuery.eq('manage_token_hash',hash);}
  else if(actor&&typeof body.appointment_id==='string'){actorType='artist';bookingQuery=bookingQuery.eq('id',body.appointment_id).eq('artist_business_id',actor.businessId);}
  else return respond({code:'AUTH_REQUIRED'},401);
  const idempotencyKey=request.headers.get('Idempotency-Key')??`${actorType}:${body.token??body.appointment_id}:${body.to_status??body.reschedule_action??body.suggestion_action??body.suggested_starts_at??body.artist_reschedule_starts_at}`;
  const {data:booking,error:lookupError}=await bookingQuery.maybeSingle();
  if(lookupError||!booking)return respond({code:'BOOKING_NOT_FOUND'},404);
  if(actorType==='artist')hash=booking.manage_token_hash;
  if(typeof body.artist_reschedule_starts_at==='string'){if(actorType!=='artist'||!actor)return respond({code:'ARTIST_MEMBERSHIP_REQUIRED'},403);if(Number.isNaN(Date.parse(body.artist_reschedule_starts_at)))return respond({code:'INVALID_REQUEST'},422);const {data,error}=await db.rpc('mova_booking_reschedule_artist',{p_appointment_id:booking.id,p_artist_business_id:actor.businessId,p_new_starts_at:body.artist_reschedule_starts_at,p_idempotency_key:idempotencyKey,p_actor_id:actor.user.id});if(error)return respond({code:error.message||'ARTIST_RESCHEDULE_FAILED'},error.message==='SLOT_TAKEN'?409:422);return respond(data);}
  if(body.suggested_starts_at){if(actorType!=='artist'||!actor)return respond({code:'ARTIST_MEMBERSHIP_REQUIRED'},403);if(Number.isNaN(Date.parse(body.suggested_starts_at)))return respond({code:'INVALID_REQUEST'},422);const {data,error}=await db.rpc('mova_booking_suggest_time',{p_appointment_id:booking.id,p_artist_business_id:actor.businessId,p_suggested_starts_at:body.suggested_starts_at,p_idempotency_key:idempotencyKey,p_actor_id:actor.user.id});if(error)return respond({code:error.message||'TIME_SUGGESTION_FAILED'},error.message==='SLOT_TAKEN'?409:422);return respond(data);}
  if(body.suggestion_action){if(actorType!=='guest')return respond({code:'BOOKING_TRANSITION_FORBIDDEN'},403);const {data,error}=await db.rpc('mova_booking_suggestion_response',{p_appointment_id:booking.id,p_manage_token_hash:hash,p_action:body.suggestion_action,p_idempotency_key:idempotencyKey});if(error)return respond({code:error.message||'TIME_SUGGESTION_RESPONSE_FAILED'},error.message==='SLOT_TAKEN'?409:422);return respond(data);}
  if(body.reschedule_action){if(actorType!=='artist'||!actor)return respond({code:'ARTIST_MEMBERSHIP_REQUIRED'},403);const {data,error}=await db.rpc('mova_booking_reschedule_review',{p_appointment_id:booking.id,p_action:body.reschedule_action,p_idempotency_key:idempotencyKey,p_actor_id:actor.user.id});if(error)return respond({code:error.message||'RESCHEDULE_REVIEW_FAILED'},error.message==='SLOT_TAKEN'?409:422);return respond(data);}
  if(actorType==='guest'&&body.to_status!=='cancelled')return respond({code:'BOOKING_TRANSITION_FORBIDDEN'},403);
  const {data,error}=await db.rpc('mova_booking_transition',{p_appointment_id:booking.id,p_manage_token_hash:hash,p_to_status:body.to_status,p_actor_type:actorType,p_reason:body.reason??`${actorType}_request`,p_idempotency_key:idempotencyKey,p_actor_id:actorType==='artist'?actor?.user.id:null});
  if(error)return respond({code:error.message||'BOOKING_TRANSITION_FAILED'},error.message==='CANCELLATION_WINDOW_CLOSED'?409:422);
  return respond(data);
});
