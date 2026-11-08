import {artistClient,corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
import {smsProviderFromEnv} from '../_shared/providers/sms/index.ts';
import {sendNextWave} from '../_shared/seat-filler.ts';
// Task 5.1: sending needs the platform flag MOVA_SEAT_FILLER_ENABLED and an SMS provider (fake until O4/O5 go live).
const outbound=()=>Deno.env.get('MOVA_SEAT_FILLER_ENABLED')==='true'?smsProviderFromEnv((name)=>Deno.env.get(name)):null;
const site=()=>Deno.env.get('PUBLIC_SITE_URL')??'https://mova-beauty.co';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='home-needs'){
  const now=new Date().toISOString();
  const {data,error}=await db.from('mova_slot_events').select('id,location_id,starts_at').eq('artist_business_id',actor.businessId).eq('status','needs_approval').gte('starts_at',now).gte('expires_at',now).order('starts_at').limit(5);
  return error?respond({code:'SLOT_NEEDS_READ_FAILED'},500):respond({slots:data??[]});
 }
 if(body.action==='list'){
  const {data,error}=await db.from('mova_slot_events').select('id,location_id,starts_at,ends_at,origin,status,expires_at,value_minor,mova_locations(name),mova_slot_candidates(id,status,wave,rank,reasons,claimed_at,mova_clients(display_name)),current_wave,wave_minutes,next_wave_at,filled_at,service_id,mova_slot_campaign_copy(sms_example,taken_message,social_caption,approved_at)').eq('artist_business_id',actor.businessId).order('created_at',{ascending:false}).limit(100);
  if(error)return respond({code:'SLOT_CAMPAIGNS_READ_FAILED'},500);
  // slot_events.service_id (0056) has no foreign key; attach service names here.
  const ids=[...new Set((data??[]).map((row:{service_id:string|null})=>row.service_id).filter(Boolean))] as string[];
  const {data:services}=ids.length?await db.from('mova_services').select('id,name,base_price_minor').in('id',ids):{data:[]};
  const byId=new Map((services??[]).map((row:{id:string})=>[row.id,row]));
  return respond({campaigns:(data??[]).map((row:{service_id:string|null})=>({...row,mova_services:row.service_id?byId.get(row.service_id)??null:null})),outboundEnabled:outbound()!==null});
 }
 if(body.action==='approve'||body.action==='send-next-wave'){
  if(typeof body.slot_event_id!=='string')return respond({code:'INVALID_SLOT'},422);
  const provider=outbound();if(!provider)return respond({code:'OUTBOUND_DISABLED',enabled:false},503);
  const {data:slot}=await db.from('mova_slot_events').select('id,status').eq('id',body.slot_event_id).eq('artist_business_id',actor.businessId).maybeSingle();
  if(!slot)return respond({code:'SLOT_NOT_FOUND'},404);
  if(body.action==='approve'&&slot.status!=='needs_approval')return respond({code:'SLOT_NOT_AWAITING_APPROVAL'},409);
  if(body.action==='send-next-wave'&&slot.status!=='live')return respond({code:'SLOT_NOT_LIVE'},409);
  if(body.action==='approve')await db.from('mova_slot_campaign_copy').update({approved_by:actor.user.id,approved_at:new Date().toISOString()}).eq('slot_event_id',slot.id);
  const outcome=await sendNextWave(db,provider,slot.id,site());
  return outcome?respond({sent:outcome}):respond({code:'SLOT_NOT_SENDABLE'},409);
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
