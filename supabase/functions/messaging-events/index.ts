import {corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
import {parseKeyword} from '../_shared/providers/sms/policy.ts';
const enc=new TextEncoder();
async function verify(body:string,signature:string,secret:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(body)));const expected=[...mac].map(byte=>byte.toString(16).padStart(2,'0')).join('');const supplied=signature.replace(/^sha256=/,'').toLowerCase();if(expected.length!==supplied.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;}
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const secret=Deno.env.get('MOVA_MESSAGING_WEBHOOK_SECRET');const raw=await request.text();const signature=request.headers.get('x-mova-webhook-signature')??'';if(!secret||!await verify(raw,signature,secret))return respond({code:'INVALID_WEBHOOK_SIGNATURE'},401);
 const body=JSON.parse(raw) as {type?:string;channel?:string;address?:string;provider?:string;provider_message_id?:string;status?:string;cost_micros?:number};const db=serviceClient();
 if(body.type==='inbound'&&typeof body.address==='string'&&['sms','email'].includes(body.channel??'')){
  const channel=body.channel as 'sms'|'email';
  if(channel==='sms'){
   // Task 4.4: keywords go through the same rules as messaging-inbound-sms (mova_sms_handle_inbound, 0042),
   // keyed on the stylist number the text was sent to.
   const keyword=parseKeyword((body as {text?:string}).text??'');const to=(body as {to?:string}).to;
   if(keyword&&typeof to==='string'){
    const {data,error}=await db.rpc('mova_sms_handle_inbound',{p_to:to,p_from:body.address,p_text:(body as {text?:string}).text??'',p_keyword:keyword,p_provider:body.provider??'webhook',p_provider_message_id:body.provider_message_id??null,p_now:new Date().toISOString()});
    if(error)return respond({code:'SUPPRESSION_SAVE_FAILED'},500);
    const count=Array.isArray((data as {businesses?:unknown[]}|null)?.businesses)?(data as {businesses:unknown[]}).businesses.length:0;
    return respond({accepted:true,action:keyword,businesses:count,replyRequired:true});
   }
  }
 }
 if(body.type==='delivery'&&typeof body.provider==='string'&&typeof body.provider_message_id==='string'&&['sent','delivered','failed'].includes(body.status??'')){
  const fields:Record<string,unknown>={status:body.status};if(body.status==='delivered')fields.delivered_at=new Date().toISOString();if(body.status==='sent')fields.sent_at=new Date().toISOString();if(typeof body.cost_micros==='number'&&Number.isSafeInteger(body.cost_micros)&&body.cost_micros>=0)fields.cost_micros=body.cost_micros;
  fields.provider=body.provider;const {error}=await db.from('mova_messages').update(fields).eq('provider',body.provider).eq('provider_message_id',body.provider_message_id);return error?respond({code:'DELIVERY_RECEIPT_SAVE_FAILED'},500):respond({accepted:true});
 }
 return respond({code:'INVALID_WEBHOOK_EVENT'},422);
});
