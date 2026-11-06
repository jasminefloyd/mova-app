import { artistClient,corsHeaders,respond,serviceClient } from '../_shared/booking.ts';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);
 const body=await request.json().catch(()=>({}));if(typeof body.client_id!=='string'||typeof body.purpose!=='string'||typeof body.channel!=='string'||typeof body.idempotency_key!=='string')return respond({code:'INVALID_REQUEST'},422);
 if(!['sms','email'].includes(body.channel))return respond({code:'CHANNEL_UNAVAILABLE'},422);
 const live=body.channel==='sms'?Deno.env.get('MOVA_MESSAGING_LIVE_SMS')==='true':Deno.env.get('MOVA_MESSAGING_LIVE_EMAIL')==='true';
 const provider=body.channel==='sms'?Deno.env.get('MOVA_SMS_PROVIDER'):Deno.env.get('MOVA_EMAIL_PROVIDER');
 if(!live||!provider)return respond({code:'PROVIDER_NOT_CONFIGURED'},503);
 const db=serviceClient();const {data:gate,error}=await db.rpc('mova_can_send',{p_artist_business_id:actor.businessId,p_client_id:body.client_id,p_channel:body.channel,p_purpose:body.purpose,p_now:new Date().toISOString()});
 if(error)return respond({code:'SEND_POLICY_UNAVAILABLE'},503);if(!gate?.allowed)return respond({code:'MESSAGE_SUPPRESSED',reason:gate?.reason??'not_eligible'},409);
 // Provider SDKs are intentionally not guessed or shimmed. A real adapter must be
 // added with the provider decision in ADR-0005; this handler cannot fake delivery.
 return respond({code:'PROVIDER_ADAPTER_UNAVAILABLE'},503);
});
