import { artistClient,corsHeaders,respond,serviceClient } from '../_shared/booking.ts';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='list'){
  const {data,error}=await db.from('mova_notification_inbox').select('id,event_type,title_key,body_key,payload,read_at,created_at').eq('artist_business_id',actor.businessId).eq('user_id',actor.user.id).order('created_at',{ascending:false}).limit(50);
  if(error)return respond({code:'INBOX_READ_FAILED'},500);return respond({items:data??[]});
 }
 if(body.action==='read'){
  if(typeof body.id!=='string')return respond({code:'INVALID_NOTIFICATION'},422);
  const {error}=await db.from('mova_notification_inbox').update({read_at:new Date().toISOString()}).eq('artist_business_id',actor.businessId).eq('user_id',actor.user.id).eq('id',body.id);
  return error?respond({code:'INBOX_UPDATE_FAILED'},500):respond({read:true});
 }
 return respond({code:'INVALID_ACTION'},422);
});
