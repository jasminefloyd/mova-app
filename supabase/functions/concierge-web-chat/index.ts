import {corsHeaders,respond} from '../_shared/booking.ts';
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 // Public chat is gated until A-04/A-25 and a reviewed provider adapter are in place.
 if(Deno.env.get('MOVA_CONCIERGE_WEB_CHAT_ENABLED')!=='true')return respond({code:'CHAT_NOT_AVAILABLE'},503);
 return respond({code:'CONCIERGE_PROVIDER_NOT_CONFIGURED'},503);
});
