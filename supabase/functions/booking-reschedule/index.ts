import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';

Deno.serve(withSystemRequestLogging('booking-reschedule', async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const body=await request.json().catch(()=>null);
  if(typeof body?.token!=='string'||typeof body.new_starts_at!=='string'||Number.isNaN(Date.parse(body.new_starts_at)))return respond({code:'INVALID_REQUEST'},422);
  const hash=await tokenHash(body.token);const db=serviceClient();const {data:booking,error:lookupError}=await db.from('mova_appointments').select('id').eq('manage_token_hash',hash).maybeSingle();
  if(lookupError||!booking)return respond({code:'BOOKING_NOT_FOUND'},404);
  const idempotencyKey=request.headers.get('Idempotency-Key')??`reschedule:${booking.id}:${body.new_starts_at}`;
  const {data,error}=await db.rpc('mova_booking_reschedule',{p_appointment_id:booking.id,p_manage_token_hash:hash,p_new_starts_at:body.new_starts_at,p_idempotency_key:idempotencyKey});
  if(error)return respond({code:error.message||'RESCHEDULE_FAILED'},error.message==='SLOT_TAKEN'?409:422);
  return respond(data);
}));
