import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { decryptProviderSecret } from '../_shared/provider-crypto.ts';

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const secret=Deno.env.get('CRON_SECRET');if(!secret||request.headers.get('Authorization')!==`Bearer ${secret}`)return respond({code:'UNAUTHORIZED'},401);
  const db=serviceClient();const {data:connections,error}=await db.from('mova_google_calendar_connections').select('artist_business_id,calendar_id,refresh_token_encrypted').eq('status','active').limit(100);
  if(error)return respond({code:'CALENDAR_CONNECTIONS_FAILED'},500);
  let synced=0;let failed=0;
  for(const connection of connections??[]){
    try{
      const refresh=await decryptProviderSecret(connection.refresh_token_encrypted);const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')??'',client_secret:Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')??'',refresh_token:refresh,grant_type:'refresh_token'})});
      const tokenBody=await tokenResponse.json();if(!tokenResponse.ok||!tokenBody.access_token){if(tokenBody.error==='invalid_grant')await db.from('mova_google_calendar_connections').update({status:'error'}).eq('artist_business_id',connection.artist_business_id);throw new Error('GOOGLE_REFRESH_FAILED');}
      const {data:settings}=await db.from('mova_calendar_sync_settings').select('location_ids').eq('artist_business_id',connection.artist_business_id).maybeSingle();
      let query=db.from('mova_appointments').select('id,service_name_snapshot,starts_at,ends_at,status,location_id,updated_at').eq('artist_business_id',connection.artist_business_id).in('status',['pending_artist','confirmed','completed','cancelled']).gt('ends_at',new Date(Date.now()-45*86400000).toISOString()).limit(500);
      if(settings?.location_ids?.length)query=query.in('location_id',settings.location_ids);
      const {data:appointments,error}=await query;if(error)throw new Error('APPOINTMENT_READ_FAILED');
      const {data:mappings}=await db.from('mova_external_calendar_events').select('appointment_id,provider_event_id,event_sequence').eq('artist_business_id',connection.artist_business_id);
      const mapped=new Map((mappings??[]).map((row:{appointment_id:string;provider_event_id:string;event_sequence:number})=>[row.appointment_id,row]));
      for(const appointment of appointments??[]){
        const old=mapped.get(appointment.id);const deleted=appointment.status==='cancelled';if(deleted&&!old)continue;const eventId=old?.provider_event_id??`mova${appointment.id.replaceAll('-','')}`;const sequence=Math.max(old?.event_sequence??0,Math.floor(new Date(appointment.updated_at).getTime()/1000));
        const event=deleted?{id:eventId,status:'cancelled',sequence,updated:new Date().toISOString()}:{id:eventId,summary:appointment.service_name_snapshot||'Appointment',start:{dateTime:appointment.starts_at},end:{dateTime:appointment.ends_at},sequence};
        const method=old?'PUT':'POST';const endpoint=old?`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events/${eventId}`:`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events`;
        const response=await fetch(endpoint,{method,headers:{Authorization:`Bearer ${tokenBody.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(event)});
        if(!response.ok&&!(deleted&&response.status===410))throw new Error('GOOGLE_EVENT_WRITE_FAILED');
        const {error:saveError}=await db.from('mova_external_calendar_events').upsert({artist_business_id:connection.artist_business_id,appointment_id:appointment.id,provider_event_id:eventId,provider_calendar_id:connection.calendar_id,event_sequence:sequence,last_synced_at:new Date().toISOString()},{onConflict:'appointment_id'});if(saveError)throw new Error('EVENT_MAPPING_SAVE_FAILED');
        synced++;
      }
    }catch{failed++;}
  }
  return respond({synced,failed});
});
