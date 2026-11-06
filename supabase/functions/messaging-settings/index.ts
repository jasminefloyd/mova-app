import { artistClient,corsHeaders,respond,serviceClient } from '../_shared/booking.ts';

Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='status'){
  const [{data:identity},{data:preferences},{data:templates,error}]=await Promise.all([
   db.from('mova_sending_identities').select('channel,registration_status,status,provider').eq('artist_business_id',actor.businessId),
   db.from('mova_notification_preferences').select('preferences').eq('artist_business_id',actor.businessId).eq('user_id',actor.user.id).maybeSingle(),
   db.from('mova_message_templates').select('id,type,locale,body,version,status,source,updated_at').eq('artist_business_id',actor.businessId).order('type').order('locale').order('version',{ascending:false}),
  ]);if(error)return respond({code:'MESSAGING_SETTINGS_READ_FAILED'},500);
  return respond({identities:identity??[],preferences:preferences?.preferences??{in_app:true,email:true,push:false},templates:templates??[],live:{sms:false,email:false,push:false}});
 }
 if(body.action==='preferences'){
  const prefs=body.preferences;if(!prefs||typeof prefs!=='object'||Array.isArray(prefs)||Object.keys(prefs).some((key)=>!['in_app','email','push'].includes(key))||Object.values(prefs).some((value)=>typeof value!=='boolean'))return respond({code:'INVALID_PREFERENCES'},422);
  if(prefs.push===true)return respond({code:'PUSH_NOT_CONFIGURED'},409);
  const {error}=await db.from('mova_notification_preferences').upsert({artist_business_id:actor.businessId,user_id:actor.user.id,preferences:prefs,updated_at:new Date().toISOString()},{onConflict:'artist_business_id,user_id'});
  return error?respond({code:'MESSAGING_SETTINGS_SAVE_FAILED'},500):respond({preferences:prefs});
 }
 if(body.action==='save-template'){
  const {type,locale,body:templateBody}=body;if(!['rebooking_reminder','slot_offer','slot_taken','win_back','review_request','running_late','transactional_confirmation','transactional_change','transactional_request_outcome'].includes(type)||!['en-US','es-US'].includes(locale)||typeof templateBody!=='string'||templateBody.trim().length<1||templateBody.length>2000)return respond({code:'INVALID_TEMPLATE'},422);
  const {data,error}=await db.rpc('mova_save_message_template_version',{p_artist_business_id:actor.businessId,p_type:type,p_locale:locale,p_body:templateBody.trim()});
  return error?respond({code:'TEMPLATE_SAVE_FAILED'},500):respond({template:data,previousVersionPaused:true});
 }
 if(body.action==='approve-template'){
  if(typeof body.id!=='string')return respond({code:'INVALID_TEMPLATE'},422);
  const {data:target}=await db.from('mova_message_templates').select('locale').eq('id',body.id).eq('artist_business_id',actor.businessId).maybeSingle();if(target?.locale==='es-US')return respond({code:'HUMAN_REVIEW_REQUIRED',approval:'A-12'},409);
  const {data,error}=await db.from('mova_message_templates').update({status:'approved',approved_by:actor.user.id,approved_at:new Date().toISOString()}).eq('id',body.id).eq('artist_business_id',actor.businessId).eq('status','needs_approval').select('id,status,approved_at').maybeSingle();
  if(error||!data)return respond({code:'TEMPLATE_APPROVAL_FAILED'},409);return respond({template:data});
 }
 return respond({code:'INVALID_ACTION'},422);
});
