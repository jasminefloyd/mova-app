import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const actor=await artistClient(request);if(!actor)return respond({code:'AUTH_REQUIRED'},401);
  const body=await request.json().catch(()=>null);const minutes=Number(body?.minutes);
  if(!body||typeof body.appointment_id!=='string'||![5,10,15,20].includes(minutes))return respond({code:'INVALID_REQUEST'},422);
  const db=serviceClient();const {data:current,error}=await db.from('mova_appointments').select('id,artist_business_id,location_id,starts_at,status').eq('id',body.appointment_id).eq('artist_business_id',actor.businessId).maybeSingle();
  if(error||!current||current.status!=='confirmed')return respond({code:'APPOINTMENT_NOT_FOUND'},404);
  const {data:next}=await db.from('mova_appointments').select('id,starts_at,client_locale,location_id').eq('artist_business_id',actor.businessId).eq('status','confirmed').gt('starts_at',current.starts_at).order('starts_at').limit(1).maybeSingle();
  if(!next)return respond({code:'NEXT_APPOINTMENT_NOT_FOUND'},404);
  const {data:location}=await db.from('mova_locations').select('time_zone').eq('id',next.location_id).maybeSingle();
  const zone=location?.time_zone??'UTC';const now=new Date();const sameLocalDay=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)===new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(next.starts_at));
  if(!sameLocalDay)return respond({code:'NEXT_APPOINTMENT_NOT_TODAY'},409);
  const key=request.headers.get('Idempotency-Key')??`running-late:${current.id}:${next.id}:${minutes}`;
  const {data:existing}=await db.from('mova_outbox_events').select('id').eq('idempotency_key',key).maybeSingle();
  if(existing)return respond({message_id:existing.id,status:'queued',client_locale:next.client_locale,replayed:true});
  const {data:outbox,error:insertError}=await db.from('mova_outbox_events').insert({artist_business_id:actor.businessId,aggregate_type:'appointment',aggregate_id:next.id,event_type:'running_late.requested',payload:{current_appointment_id:current.id,minutes,offer_new_time:Boolean(body.offer_new_time),client_locale:next.client_locale,purpose:'appointment_updates',same_day_transactional:true},idempotency_key:key}).select('id').single();
  if(insertError)return respond({code:'RUNNING_LATE_QUEUE_FAILED'},503);
  await db.from('mova_appointments').update({running_late_minutes:minutes}).eq('id',current.id).eq('artist_business_id',actor.businessId);
  return respond({message_id:outbox.id,status:'queued',client_locale:next.client_locale,transport:'pending-messaging-provider'});
});
