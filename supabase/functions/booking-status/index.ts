import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';

function escapeIcs(value: string) { return value.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;'); }
function toIcs(booking: Record<string,unknown>, location: Record<string,unknown>) {
  const stamp=(value:string)=>new Date(value).toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Mova//Booking//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${booking.id}@mova-beauty.co`,`DTSTAMP:${stamp(new Date().toISOString())}`,`DTSTART:${stamp(String(booking.starts_at))}`,`DTEND:${stamp(String(booking.ends_at))}`,`SUMMARY:${escapeIcs(String(booking.service_name_snapshot))}`,`LOCATION:${escapeIcs(String(location.name))}`,`STATUS:${booking.status==='cancelled'?'CANCELLED':'CONFIRMED'}`,'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
async function decryptDoorCode(value:string){const keyHex=Deno.env.get('MOVA_DOOR_CODE_KEK_HEX');if(!keyHex||!/^[0-9a-f]{64}$/i.test(keyHex))return null;const raw=value.startsWith('\\x')?value.slice(2):value;const bytes=new Uint8Array(raw.match(/.{2}/g)?.map((part)=>parseInt(part,16))??[]);if(bytes.length<29)return null;const keyBytes=new Uint8Array(keyHex.match(/.{2}/g)!.map((part)=>parseInt(part,16)));const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['decrypt']);try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12)));}catch{return null;}}
Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(!['POST','GET'].includes(request.method))return respond({code:'METHOD_NOT_ALLOWED'},405);
  const body=request.method==='POST'?await request.json().catch(()=>null):null;const token=body?.token??new URL(request.url).searchParams.get('token');
  if(typeof token!=='string'||token.length<30)return respond({code:'BOOKING_NOT_FOUND'},404);
  const db=serviceClient();const {data:booking,error}=await db.from('mova_appointments').select('id,artist_business_id,client_name,status,starts_at,ends_at,service_id,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_locale,request_expires_at,cancelled_at,location_id,reschedule_requested_starts_at,reschedule_requested_ends_at,artist_suggested_starts_at,artist_suggested_ends_at').eq('manage_token_hash',await tokenHash(token)).maybeSingle();
  if(error||!booking)return respond({code:'BOOKING_NOT_FOUND'},404);
  const [{data:location},{data:artist},{data:services}]=await Promise.all([
    db.from('mova_locations').select('name,time_zone,booking_mode,calendar_ownership').eq('id',booking.location_id).maybeSingle(),
    db.from('mova_artist_profiles').select('display_name,handle').eq('artist_business_id',booking.artist_business_id).maybeSingle(),
    db.from('mova_appointment_services').select('service_id,service_name_snapshot,position').eq('artist_business_id',booking.artist_business_id).eq('appointment_id',booking.id).order('position'),
  ]);
  const serviceRows=services??[{service_id:booking.service_id,service_name_snapshot:booking.service_name_snapshot,position:1}];
  const serviceNames=serviceRows.map((service)=>service.service_name_snapshot);
  if(new URL(request.url).searchParams.get('format')==='ics') return new Response(toIcs({...booking,service_name_snapshot:serviceNames.join(' + ')},location??{}),{headers:{...corsHeaders,'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="mova-appointment.ics"'}});
  let clientDetails=null;let doorCode:string|null=null;const {data:policy}=await db.from('mova_location_policies').select('cancellation_window_minutes,client_details,door_code_encrypted').eq('location_id',booking.location_id).maybeSingle();
  if(booking.status==='confirmed'){clientDetails=policy?.client_details??null;if(policy?.door_code_encrypted)doorCode=await decryptDoorCode(policy.door_code_encrypted);}
  return respond({booking:{...booking,service_ids:serviceRows.map((service)=>service.service_id),service_names:serviceNames,location,artist,cancellation_window_minutes:policy?.cancellation_window_minutes??1440,client_details:clientDetails,door_code:doorCode,client_email:undefined,client_phone:undefined}});
});
