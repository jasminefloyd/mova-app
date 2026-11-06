import {artistClient,corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='status'){
  const [{data:settings},{data:conversations,error},{data:handoffs},{data:knowledge}]=await Promise.all([
   db.from('mova_concierge_settings').select('enabled,channels,permissions,tone,languages,hours,daily_ai_turn_cap,globally_paused').eq('artist_business_id',actor.businessId).maybeSingle(),
   db.from('mova_conversations').select('id,channel,client_id,locale,status,ai_enabled,pause_until,last_message_at,mova_clients(display_name)').eq('artist_business_id',actor.businessId).neq('status','closed').order('last_message_at',{ascending:false}).limit(100),
   db.from('mova_handoffs').select('id,conversation_id,type,status,summary,created_at').eq('artist_business_id',actor.businessId).eq('status','open').order('created_at',{ascending:false}).limit(50),
   db.from('mova_concierge_knowledge').select('id,kind,location_id,question,answer_en,answer_es,status,updated_at').eq('artist_business_id',actor.businessId).neq('status','archived').order('updated_at',{ascending:false}),
  ]);if(error)return respond({code:'CONCIERGE_READ_FAILED'},500);
  return respond({settings:settings??{enabled:false,channels:{instagram:false,sms:false,missed_call:false,web_chat:false},permissions:{answer:true,book_instant:false,request_salon:false,reschedule:false,reply_slot_offers:false},languages:['en-US'],daily_ai_turn_cap:0,globally_paused:true},conversations:conversations??[],handoffs:handoffs??[],knowledge:knowledge??[],aiEnabled:false});
 }
 if(body.action==='save-settings'){
  // Channel wishes may be stored, but approval-gated replies cannot be enabled here.
  const {data,error}=await db.from('mova_concierge_settings').upsert({artist_business_id:actor.businessId,enabled:false,globally_paused:true,channels:body.channels??{},permissions:body.permissions??{},tone:typeof body.tone==='string'?body.tone.slice(0,80):'warm',languages:Array.isArray(body.languages)?body.languages.filter((value:unknown)=>['en-US','es-US'].includes(String(value))):['en-US'],daily_ai_turn_cap:0,updated_at:new Date().toISOString()},{onConflict:'artist_business_id'}).select('enabled,channels,permissions,tone,languages,globally_paused').single();
  return error?respond({code:'CONCIERGE_SETTINGS_SAVE_FAILED'},500):respond({settings:data,enabled:false});
 }
 if(body.action==='unpause'||body.action==='enable-conversation')return respond({code:'APPROVAL_REQUIRED',approval:'A-04/A-25',enabled:false},409);
 if(body.action==='pause'||body.action==='disable-conversation'){
  if(body.action==='pause'){
   const {error}=await db.from('mova_concierge_settings').upsert({artist_business_id:actor.businessId,enabled:false,globally_paused:true,updated_at:new Date().toISOString()},{onConflict:'artist_business_id'});
   return error?respond({code:'CONCIERGE_PAUSE_FAILED'},500):respond({paused:true});
  }
  if(typeof body.conversation_id!=='string')return respond({code:'INVALID_CONVERSATION'},422);
  const {error}=await db.from('mova_conversations').update({ai_enabled:false,pause_until:new Date(Date.now()+24*60*60_000).toISOString()}).eq('artist_business_id',actor.businessId).eq('id',body.conversation_id);
  return error?respond({code:'CONVERSATION_UPDATE_FAILED'},500):respond({ai_enabled:false});
 }
 if(body.action==='save-knowledge'){
  if(!['faq','prep','location_detail','policy'].includes(body.kind)||typeof body.question!=='string'||!body.question.trim()||typeof body.answer_en!=='string'||!body.answer_en.trim()||(body.answer_es!==undefined&&typeof body.answer_es!=='string'))return respond({code:'INVALID_KNOWLEDGE'},422);
  const row={artist_business_id:actor.businessId,kind:body.kind,question:body.question.trim().slice(0,500),answer_en:body.answer_en.trim().slice(0,3000),answer_es:typeof body.answer_es==='string'&&body.answer_es.trim()?body.answer_es.trim().slice(0,3000):null,status:'draft',updated_at:new Date().toISOString()};
  const query=typeof body.id==='string'?db.from('mova_concierge_knowledge').update(row).eq('id',body.id).eq('artist_business_id',actor.businessId):db.from('mova_concierge_knowledge').insert(row);
  const {data,error}=await query.select('id,kind,question,answer_en,answer_es,status,updated_at').single();return error?respond({code:'KNOWLEDGE_SAVE_FAILED'},500):respond({knowledge:data});
 }
 if(body.action==='activate-knowledge'){
  if(typeof body.id!=='string')return respond({code:'INVALID_KNOWLEDGE'},422);
  return respond({code:'HUMAN_REVIEW_REQUIRED',approval:'A-12',active:false},409);
 }
 if(body.action==='conversation'){
  if(typeof body.conversation_id!=='string')return respond({code:'INVALID_CONVERSATION'},422);
  const [{data:messages,error},{data:handoffs},{data:quotes}]=await Promise.all([
   db.from('mova_messages').select('id,direction,origin,channel,purpose,body,status,created_at').eq('artist_business_id',actor.businessId).eq('conversation_id',body.conversation_id).order('created_at'),
   db.from('mova_handoffs').select('id,type,status,summary,created_at').eq('artist_business_id',actor.businessId).eq('conversation_id',body.conversation_id).order('created_at',{ascending:false}),
   db.from('mova_quote_requests').select('id,service_category,details,media,risk_flags,quoted_minor,status,created_at').eq('artist_business_id',actor.businessId).eq('conversation_id',body.conversation_id).order('created_at',{ascending:false}),
  ]);if(error)return respond({code:'CONVERSATION_READ_FAILED'},500);return respond({messages:messages??[],handoffs:handoffs??[],quotes:quotes??[]});
 }
 if(body.action==='human-reply'){
  if(typeof body.conversation_id!=='string'||typeof body.message!=='string'||!body.message.trim()||body.message.length>4000)return respond({code:'INVALID_REPLY'},422);
  const {data:conversation}=await db.from('mova_conversations').select('id,channel').eq('artist_business_id',actor.businessId).eq('id',body.conversation_id).maybeSingle();if(!conversation)return respond({code:'CONVERSATION_NOT_FOUND'},404);
  const key=`artist-reply:${conversation.id}:${crypto.randomUUID()}`;
  const {data,error}=await db.from('mova_messages').insert({artist_business_id:actor.businessId,conversation_id:conversation.id,direction:'outbound',origin:'artist',channel:conversation.channel,purpose:'transactional',body:body.message.trim(),status:'queued',idempotency_key:key}).select('id,status,created_at').single();
  await db.from('mova_conversations').update({ai_enabled:false,pause_until:new Date(Date.now()+24*60*60_000).toISOString(),status:'handled',last_message_at:new Date().toISOString()}).eq('id',conversation.id).eq('artist_business_id',actor.businessId);
  return error?respond({code:'REPLY_SAVE_FAILED'},500):respond({message:data,delivered:false});
 }
 if(body.action==='resolve-handoff'){
  if(typeof body.id!=='string')return respond({code:'INVALID_HANDOFF'},422);
  const {error}=await db.from('mova_handoffs').update({status:'resolved',resolved_at:new Date().toISOString(),resolved_by:actor.user.id}).eq('artist_business_id',actor.businessId).eq('id',body.id).eq('status','open');return error?respond({code:'HANDOFF_RESOLVE_FAILED'},500):respond({resolved:true});
 }
 if(body.action==='update-quote'){
  if(typeof body.id!=='string'||!['quoted','consult_offered','booked','closed'].includes(body.status))return respond({code:'INVALID_QUOTE_UPDATE'},422);
  const amount=body.quoted_minor===undefined?null:Number(body.quoted_minor);if(amount!==null&&(!Number.isSafeInteger(amount)||amount<0))return respond({code:'INVALID_QUOTE_AMOUNT'},422);
  const {error}=await db.from('mova_quote_requests').update({status:body.status,quoted_minor:amount,updated_at:new Date().toISOString()}).eq('artist_business_id',actor.businessId).eq('id',body.id);
  return error?respond({code:'QUOTE_UPDATE_FAILED'},500):respond({updated:true});
 }
 return respond({code:'INVALID_ACTION'},422);
});
