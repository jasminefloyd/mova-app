import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond } from '../_shared/booking.ts';

const hex=(bytes:Uint8Array)=>[...bytes].map((value)=>value.toString(16).padStart(2,'0')).join('');
async function encryptDoorCode(value:string){
  const keyHex=Deno.env.get('MOVA_DOOR_CODE_KEK_HEX');
  if(!keyHex||!/^[0-9a-f]{64}$/i.test(keyHex))throw new Error('DOOR_CODE_KEY_MISSING');
  const keyBytes=new Uint8Array(keyHex.match(/.{2}/g)!.map((part)=>parseInt(part,16)));
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  return hex(new Uint8Array([...iv,...new Uint8Array(ciphertext)]));
}

Deno.serve(withSystemRequestLogging('location-save', async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const actor=await artistClient(request);if(!actor)return respond({code:'AUTH_REQUIRED'},401);
  const body=await request.json().catch(()=>null);
  if(!body||typeof body.artist_business_id!=='string'||typeof body.name!=='string'||!['suite','booth','commission_salon','mobile','home_studio'].includes(body.location_type)||!['instant','request'].includes(body.booking_mode)||!['mova','external'].includes(body.calendar_ownership)||!['artist','salon'].includes(body.payment_collector)||typeof body.time_zone!=='string'||!Array.isArray(body.hours)||!Array.isArray(body.exceptions))return respond({code:'INVALID_REQUEST'},422);
  if(body.artist_business_id!==actor.businessId)return respond({code:'ARTIST_BUSINESS_SCOPE_MISMATCH'},403);
  if(body.calendar_ownership==='external'&&body.booking_mode!=='request')return respond({code:'EXTERNAL_CALENDAR_REQUIRES_REQUEST_MODE'},422);
  let doorCodeHex='';
  try{if(typeof body.door_code==='string'&&body.door_code.trim())doorCodeHex=await encryptDoorCode(body.door_code.trim());}catch(error){return respond({code:error instanceof Error?error.message:'DOOR_CODE_ENCRYPTION_FAILED'},503);}
  const {data,error}=await actor.client.rpc('mova_save_location',{p_artist_business_id:actor.businessId,p_location_id:body.location_id??null,p_name:body.name,p_location_type:body.location_type,p_booking_mode:body.booking_mode,p_calendar_ownership:body.calendar_ownership,p_payment_collector:body.payment_collector,p_time_zone:body.time_zone,p_address:body.address??{},p_display_color_index:body.display_color_index??0,p_hours:body.hours,p_policies:{...body.policies,client_details:body.client_details??{},door_code_encrypted_hex:doorCodeHex},p_exceptions:body.exceptions});
  if(error)return respond({code:error.message||'LOCATION_SAVE_FAILED'},422);
  return respond({id:data});
}));
