import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { sha256Hex } from '../_shared/provider-crypto.ts';
Deno.serve(withSystemRequestLogging('scan-landing', async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
  const body=await request.json().catch(()=>({}));if(typeof body.handle!=='string'||typeof body.scan_session!=='string'||!/^[0-9a-f]{64}$/.test(body.scan_session))return respond({code:'INVALID_REQUEST'},422);
  const db=serviceClient();const {data:profile}=await db.from('mova_artist_profiles').select('artist_business_id').eq('handle',body.handle.toLowerCase()).eq('is_published',true).maybeSingle();
  if(!profile)return respond({code:'ARTIST_NOT_AVAILABLE'},404);
  const {error}=await db.from('mova_artist_qr_scans').upsert({artist_business_id:profile.artist_business_id,scan_session_hash:await sha256Hex(body.scan_session)},{onConflict:'artist_business_id,scan_session_hash',ignoreDuplicates:true});
  return error?respond({code:'SCAN_TRACKING_FAILED'},500):respond({recorded:true});
}));
