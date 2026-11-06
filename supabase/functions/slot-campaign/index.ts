import {artistClient,corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='list'){
  const {data,error}=await db.from('mova_slot_events').select('id,location_id,starts_at,ends_at,origin,status,expires_at,value_minor,mova_locations(name),mova_slot_candidates(id,status,wave,rank),mova_slot_campaign_copy(sms_example,taken_message,social_caption,approved_at)').eq('artist_business_id',actor.businessId).order('created_at',{ascending:false}).limit(100);
  return error?respond({code:'SLOT_CAMPAIGNS_READ_FAILED'},500):respond({campaigns:data??[],outboundEnabled:false});
 }
 if(body.action==='approve'){
  if(typeof body.slot_event_id!=='string')return respond({code:'INVALID_SLOT'},422);
  return respond({code:'OUTBOUND_DISABLED',message:'A real messaging provider and required approval are not configured.',enabled:false},503);
 }
 if(body.action==='cancel'){
  if(typeof body.slot_event_id!=='string')return respond({code:'INVALID_SLOT'},422);
  const {error}=await db.from('mova_slot_events').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',body.slot_event_id).eq('artist_business_id',actor.businessId).in('status',['gap_found','drafting','needs_approval','live']);
  return error?respond({code:'SLOT_CANCEL_FAILED'},500):respond({cancelled:true});
 }
 if(body.action==='share'){
  if(typeof body.slot_event_id!=='string'||typeof body.target_hint!=='string')return respond({code:'INVALID_SHARE_EVENT'},422);
  const {data:event}=await db.from('mova_slot_events').select('id').eq('id',body.slot_event_id).eq('artist_business_id',actor.businessId).maybeSingle();if(!event)return respond({code:'SLOT_NOT_FOUND'},404);
  const {error}=await db.from('mova_social_share_events').insert({artist_business_id:actor.businessId,slot_event_id:event.id,target_hint:body.target_hint.slice(0,40)});
  return error?respond({code:'SHARE_EVENT_SAVE_FAILED'},500):respond({recorded:true});
 }
 return respond({code:'INVALID_ACTION'},422);
});
