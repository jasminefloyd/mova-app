import { withSystemRequestLogging } from '../_shared/system-log.ts';
import {artistClient,corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
import {platformSwitchEnabled} from '../_shared/platform-switch.ts';
import {planFeatureEnabled} from '../_shared/plan-feature.ts';
Deno.serve(withSystemRequestLogging('concierge-artist', async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);if(!await platformSwitchEnabled('concierge'))return respond({code:'CONCIERGE_FEATURE_DISABLED'},403);if(!await planFeatureEnabled(actor.businessId,'concierge'))return respond({code:'PLAN_FEATURE_NOT_INCLUDED',feature:'concierge'},403);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='home-needs'){
  const {data,error}=await db.from('mova_quote_requests').select('id,conversation_id,service_category,created_at').eq('artist_business_id',actor.businessId).eq('status','open').order('created_at',{ascending:false}).limit(5);
  return error?respond({code:'QUOTE_NEEDS_READ_FAILED'},500):respond({quotes:data??[]});
 }
 if(body.action==='status'){
  const [{data:settings},{data:conversations,error},{data:handoffs},{data:knowledge},{data:smsIdentity,error:smsIdentityError}]=await Promise.all([
   db.from('mova_concierge_settings').select('enabled,channels,permissions,tone,languages,hours,daily_ai_turn_cap,globally_paused').eq('artist_business_id',actor.businessId).maybeSingle(),
   db.from('mova_conversations').select('id,channel,client_id,locale,status,ai_enabled,pause_until,last_message_at,mova_clients(display_name)').eq('artist_business_id',actor.businessId).neq('status','closed').order('last_message_at',{ascending:false}).limit(100),
   db.from('mova_handoffs').select('id,conversation_id,type,status,summary,created_at').eq('artist_business_id',actor.businessId).eq('status','open').order('created_at',{ascending:false}).limit(50),
   db.from('mova_concierge_knowledge').select('id,kind,location_id,question,answer_en,answer_es,status,updated_at').eq('artist_business_id',actor.businessId).neq('status','archived').order('updated_at',{ascending:false}),
   db.from('mova_sending_identities').select('address').eq('artist_business_id',actor.businessId).eq('channel','sms').eq('status','active').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  ]);if(error||smsIdentityError)return respond({code:'CONCIERGE_READ_FAILED'},500);
  const conversationIds=(conversations??[]).map((row)=>row.id);let latestMessages=new Map<string,{body:string;direction:string}>();
  if(conversationIds.length){const{data:messages,error:messageError}=await db.from('mova_messages').select('conversation_id,body,direction').eq('artist_business_id',actor.businessId).in('conversation_id',conversationIds).order('created_at',{ascending:false}).limit(500);if(messageError)return respond({code:'CONCIERGE_MESSAGES_READ_FAILED'},500);for(const message of messages??[])if(message.conversation_id&&!latestMessages.has(message.conversation_id))latestMessages.set(message.conversation_id,{body:message.body,direction:message.direction});}
  const since24h=new Date(Date.now()-24*60*60_000).toISOString();const since30d=new Date(Date.now()-30*24*60*60_000).toISOString();
  const [handled,bookings,messages]=await Promise.all([
   db.from('mova_conversations').select('id',{count:'exact',head:true}).eq('artist_business_id',actor.businessId).eq('status','handled').gte('last_message_at',since24h),
   db.from('mova_appointments').select('id',{count:'exact',head:true}).eq('artist_business_id',actor.businessId).eq('source','concierge').gte('created_at',since30d).in('status',['pending_payment','pending_artist','confirmed','completed']),
   db.from('mova_messages').select('conversation_id,direction,origin,created_at').eq('artist_business_id',actor.businessId).gte('created_at',since30d).order('created_at',{ascending:false}).limit(5000),
  ]);
  if(handled.error||bookings.error||messages.error)return respond({code:'CONCIERGE_METRICS_READ_FAILED'},500);
  const waiting=new Map<string,number>();const replySeconds:number[]=[];
  for(const row of [...(messages.data??[])].reverse()){const time=Date.parse(row.created_at);if(row.direction==='inbound')waiting.set(row.conversation_id,time);else if(row.direction==='outbound'&&['artist','concierge'].includes(row.origin)){const start=waiting.get(row.conversation_id);if(start!==undefined&&time>=start){replySeconds.push((time-start)/1000);waiting.delete(row.conversation_id);}}}
  const metrics={handled_24h:handled.count??0,booked_30d:bookings.count??0,average_reply_seconds:replySeconds.length?Math.round(replySeconds.reduce((sum,value)=>sum+value,0)/replySeconds.length):null};
  return respond({settings:settings??{enabled:false,channels:{instagram:false,sms:false,missed_call:false,web_chat:false},permissions:{answer:true,book_instant:false,request_salon:false,reschedule:false,reply_slot_offers:false},languages:['en-US'],daily_ai_turn_cap:0,globally_paused:true},conversations:(conversations??[]).map((row)=>({...row,last_message_preview:latestMessages.get(row.id)?.body??null,last_message_direction:latestMessages.get(row.id)?.direction??null})),handoffs:handoffs??[],knowledge:knowledge??[],sms_number:smsIdentity?.address??null,metrics,aiEnabled:false});
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
   db.from('mova_quote_requests').select('id,appointment_id,service_category,details,media,risk_flags,quoted_minor,status,created_at').eq('artist_business_id',actor.businessId).eq('conversation_id',body.conversation_id).order('created_at',{ascending:false}),
  ]);if(error)return respond({code:'CONVERSATION_READ_FAILED'},500);
  // Linked quotes carry their appointment's AID number so the thread can link to it (screen 41).
  const linkedIds=(quotes??[]).map((quote)=>quote.appointment_id).filter((id):id is string=>typeof id==='string');
  const {data:linked}=linkedIds.length?await db.from('mova_appointments').select('id,appointment_number').eq('artist_business_id',actor.businessId).in('id',linkedIds):{data:[] as Array<{id:string;appointment_number:number}>};
  const numbers=new Map((linked??[]).map((row)=>[row.id,row.appointment_number]));
  return respond({messages:messages??[],handoffs:handoffs??[],quotes:(quotes??[]).map((quote)=>({...quote,appointment_number:quote.appointment_id?numbers.get(quote.appointment_id)??null:null}))});
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
  let appointmentId:string|undefined;
  if(body.status==='booked'){
   if(typeof body.appointment_id!=='string')return respond({code:'APPOINTMENT_REQUIRED'},422);
   const [{data:quote,error:quoteError},{data:appointment,error:appointmentError}]=await Promise.all([
    db.from('mova_quote_requests').select('id,client_id').eq('artist_business_id',actor.businessId).eq('id',body.id).maybeSingle(),
    db.from('mova_appointments').select('id,client_id,status').eq('artist_business_id',actor.businessId).eq('id',body.appointment_id).maybeSingle(),
   ]);
   if(quoteError||appointmentError)return respond({code:'QUOTE_LINK_VALIDATION_FAILED'},500);
   if(!quote)return respond({code:'QUOTE_NOT_FOUND'},404);
   if(!appointment||!['pending_artist','confirmed','completed'].includes(appointment.status)|| (quote.client_id&&quote.client_id!==appointment.client_id))return respond({code:'APPOINTMENT_NOT_LINKABLE'},422);
   appointmentId=appointment.id;
  }
  const amount=body.quoted_minor===undefined?null:Number(body.quoted_minor);if(amount!==null&&(!Number.isSafeInteger(amount)||amount<0))return respond({code:'INVALID_QUOTE_AMOUNT'},422);
  const {error}=await db.from('mova_quote_requests').update({status:body.status,quoted_minor:amount,...(appointmentId?{appointment_id:appointmentId}:{}),updated_at:new Date().toISOString()}).eq('artist_business_id',actor.businessId).eq('id',body.id);
  return error?respond({code:'QUOTE_UPDATE_FAILED'},500):respond({updated:true});
 }
 if(body.action==='quote-detail'){
  if(typeof body.id!=='string')return respond({code:'INVALID_QUOTE'},422);
  const {data:quote,error:quoteError}=await db.from('mova_quote_requests').select('id,conversation_id,client_id,appointment_id,service_category,details,media,risk_flags,quoted_minor,status,created_at').eq('artist_business_id',actor.businessId).eq('id',body.id).maybeSingle();
  if(quoteError)return respond({code:'QUOTE_READ_FAILED'},500);if(!quote)return respond({code:'QUOTE_NOT_FOUND'},404);
  const [{data:conversation,error:conversationError},{data:client,error:clientError}]=await Promise.all([
   db.from('mova_conversations').select('channel,locale').eq('artist_business_id',actor.businessId).eq('id',quote.conversation_id).maybeSingle(),
   quote.client_id?db.from('mova_clients').select('display_name').eq('artist_business_id',actor.businessId).eq('id',quote.client_id).maybeSingle():Promise.resolve({data:null,error:null}),
  ]);
  if(conversationError||clientError)return respond({code:'QUOTE_CONTEXT_READ_FAILED'},500);if(!conversation)return respond({code:'CONVERSATION_NOT_FOUND'},404);
  const {data:appointment,error:appointmentError}=quote.appointment_id?await db.from('mova_appointments').select('appointment_number').eq('artist_business_id',actor.businessId).eq('id',quote.appointment_id).maybeSingle():{data:null,error:null};
  if(appointmentError)return respond({code:'QUOTE_APPOINTMENT_READ_FAILED'},500);
  return respond({quote:{id:quote.id,conversation_id:quote.conversation_id,appointment_id:quote.appointment_id,appointment_number:appointment?.appointment_number??null,service_category:quote.service_category,details:quote.details,media_count:Array.isArray(quote.media)?quote.media.length:0,risk_flags:Array.isArray(quote.risk_flags)?quote.risk_flags:[],quoted_minor:quote.quoted_minor,status:quote.status,created_at:quote.created_at,client_name:client?.display_name??null,channel:conversation.channel,locale:conversation.locale}});
 }
 if(body.action==='save-quote-estimate'){
  if(typeof body.id!=='string'||!Number.isSafeInteger(body.quoted_minor)||Number(body.quoted_minor)<=0)return respond({code:'INVALID_QUOTE_AMOUNT'},422);
  const {data,error}=await db.from('mova_quote_requests').update({quoted_minor:Number(body.quoted_minor),updated_at:new Date().toISOString()}).eq('artist_business_id',actor.businessId).eq('id',body.id).eq('status','open').select('id').maybeSingle();
  if(error)return respond({code:'QUOTE_ESTIMATE_SAVE_FAILED'},500);if(!data)return respond({code:'QUOTE_NOT_OPEN'},409);
  return respond({saved:true,message_sent:false});
 }
 return respond({code:'INVALID_ACTION'},422);
}));
