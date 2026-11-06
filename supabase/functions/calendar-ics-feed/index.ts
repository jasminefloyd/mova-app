import { serviceClient } from '../_shared/booking.ts';
import { sha256Hex } from '../_shared/provider-crypto.ts';
import { buildIcsFeed } from '../_shared/ics.ts';

const response=(body:string,status=200)=>new Response(body,{status,headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-store','Content-Disposition':'attachment; filename="mova-calendar.ics"','X-Content-Type-Options':'nosniff'}});
Deno.serve(async(request)=>{
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  const token=new URL(request.url).pathname.split('/').filter(Boolean).at(-1)??'';
  if(!/^[A-Za-z0-9_-]{40,}$/.test(token))return new Response('Not found',{status:404});
  const db=serviceClient();const hash=await sha256Hex(token);const {data:feed}=await db.from('mova_calendar_feed_tokens').select('id,artist_business_id').eq('token_hash',hash).is('revoked_at',null).maybeSingle();
  if(!feed)return new Response('Not found',{status:404});
  await db.from('mova_calendar_feed_tokens').update({last_used_at:new Date().toISOString()}).eq('id',feed.id);
  const {data:settings}=await db.from('mova_calendar_sync_settings').select('location_ids').eq('artist_business_id',feed.artist_business_id).maybeSingle();
  let query=db.from('mova_appointments').select('id,service_name_snapshot,starts_at,ends_at,status,location_id,updated_at').eq('artist_business_id',feed.artist_business_id).in('status',['pending_artist','confirmed','completed','cancelled']).order('starts_at').limit(1000);
  if(settings?.location_ids?.length)query=query.in('location_id',settings.location_ids);
  const {data:appointments,error}=await query;if(error)return new Response('Calendar temporarily unavailable',{status:503});
  const {data:mappings}=await db.from('mova_external_calendar_events').select('appointment_id,event_sequence').eq('artist_business_id',feed.artist_business_id);
  const sequence=new Map((mappings??[]).map((item:{appointment_id:string;event_sequence:number})=>[item.appointment_id,item.event_sequence]));
  const now=new Date().toISOString();const events=(appointments??[]).map((appointment:{id:string;service_name_snapshot:string;starts_at:string;ends_at:string;status:string;updated_at:string})=>({id:appointment.id,summary:appointment.service_name_snapshot,startsAt:appointment.starts_at,endsAt:appointment.ends_at,updatedAt:appointment.updated_at,status:appointment.status,sequence:Math.max(sequence.get(appointment.id)??0,Math.floor(new Date(appointment.updated_at).getTime()/1000))}));
  return response(buildIcsFeed(events,now));
});
