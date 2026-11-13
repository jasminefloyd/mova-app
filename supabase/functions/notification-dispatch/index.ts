import { withSystemRequestLogging } from '../_shared/system-log.ts';
import {corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
import {resolveInAppNotificationPreference} from '../_shared/notification-preferences.ts';
const equal=(a:string,b:string)=>{if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
const copyKeys=(type:string)=>type.startsWith('appointment.')?{title:'notifications.appointment.title',body:'notifications.appointment.body'}:type==='slot.opened'?{title:'notifications.slotOpened.title',body:'notifications.slotOpened.body'}:type.startsWith('payment.')?{title:'notifications.payment.title',body:'notifications.payment.body'}:{title:'notifications.update.title',body:'notifications.update.body'};
Deno.serve(withSystemRequestLogging('notification-dispatch', async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const secret=Deno.env.get('MOVA_NOTIFICATION_DISPATCH_SECRET');if(!secret||!equal(request.headers.get('x-mova-dispatch-secret')??'',secret))return respond({code:'UNAUTHENTICATED'},401);
 const db=serviceClient();const {data:events,error}=await db.from('mova_outbox_events').select('id,artist_business_id,event_type,payload,idempotency_key').is('delivered_at',null).order('occurred_at').limit(100);
 if(error)return respond({code:'OUTBOX_READ_FAILED'},500);let delivered=0;
 for(const event of events??[]){if(!event.artist_business_id)continue;const {data:members,error:memberError}=await db.from('mova_artist_memberships').select('user_id').eq('artist_business_id',event.artist_business_id).eq('status','active');if(memberError)return respond({code:'MEMBERSHIP_READ_FAILED'},500);
  const payload={source_event_id:event.id};const keys=copyKeys(event.event_type);for(const member of members??[]){const {data:preferences,error:preferenceError}=await db.from('mova_notification_preferences').select('preferences').eq('artist_business_id',event.artist_business_id).eq('user_id',member.user_id).maybeSingle();const preference=resolveInAppNotificationPreference({data:preferences,error:preferenceError});if(!preference.ok)return respond({code:'NOTIFICATION_PREFERENCES_READ_FAILED'},500);if(!preference.enabled)continue;
   const {error:insertError}=await db.from('mova_notification_inbox').upsert({artist_business_id:event.artist_business_id,user_id:member.user_id,event_type:event.event_type,title_key:keys.title,body_key:keys.body,payload},{onConflict:'artist_business_id,user_id,event_type,payload'});if(insertError)return respond({code:'INBOX_WRITE_FAILED'},500);
  }
  const {error:updateError}=await db.from('mova_outbox_events').update({delivered_at:new Date().toISOString()}).eq('id',event.id).is('delivered_at',null);if(updateError)return respond({code:'OUTBOX_ACK_FAILED'},500);delivered++;
 }
 return respond({delivered});
}));
