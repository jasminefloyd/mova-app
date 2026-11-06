import {corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
const enc=new TextEncoder();
async function verify(body:string,signature:string,secret:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(body)));const expected=[...mac].map(byte=>byte.toString(16).padStart(2,'0')).join('');const supplied=signature.replace(/^sha256=/,'').toLowerCase();if(expected.length!==supplied.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;}
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const secret=Deno.env.get('MOVA_MESSAGING_WEBHOOK_SECRET');const raw=await request.text();const signature=request.headers.get('x-mova-webhook-signature')??'';if(!secret||!await verify(raw,signature,secret))return respond({code:'INVALID_WEBHOOK_SIGNATURE'},401);
 const body=JSON.parse(raw) as {type?:string;channel?:string;address?:string;provider?:string;provider_message_id?:string;status?:string;cost_micros?:number};const db=serviceClient();
 if(body.type==='inbound'&&typeof body.address==='string'&&['sms','email'].includes(body.channel??'')){
  const channel=body.channel as 'sms'|'email';let normalized=channel==='sms'?body.address.replace(/\D/g,''):body.address.trim().toLowerCase();if(channel==='sms'&&normalized.length===10)normalized=`1${normalized}`;const addressHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(normalized)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(channel==='sms'){
   const content=(body as {text?:string}).text?.trim().toUpperCase()??'';
   if(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(content)){
    const {data:identities}=await db.from('mova_sending_identities').select('artist_business_id').eq('channel','sms').eq('address',body.address).eq('status','active');const businessIds=[...new Set((identities??[]).map(row=>row.artist_business_id))];
    for(const artistBusinessId of businessIds){const {error}=await db.from('mova_suppressions').insert({artist_business_id:artistBusinessId,channel,address_hash:addressHash,reason:'stop'});if(error&&error.code!=='23505')return respond({code:'SUPPRESSION_SAVE_FAILED'},500);}
    return respond({accepted:true,action:'stop',suppressed_businesses:businessIds.length});
   }
   if(['HELP','INFO'].includes(content))return respond({accepted:true,action:'help',replyRequired:true,copyKey:'messaging.helpReply'});
  }
 }
 if(body.type==='delivery'&&typeof body.provider==='string'&&typeof body.provider_message_id==='string'&&['sent','delivered','failed'].includes(body.status??'')){
  const fields:Record<string,unknown>={status:body.status};if(body.status==='delivered')fields.delivered_at=new Date().toISOString();if(body.status==='sent')fields.sent_at=new Date().toISOString();if(typeof body.cost_micros==='number'&&Number.isSafeInteger(body.cost_micros)&&body.cost_micros>=0)fields.cost_micros=body.cost_micros;
  fields.provider=body.provider;const {error}=await db.from('mova_messages').update(fields).eq('provider',body.provider).eq('provider_message_id',body.provider_message_id);return error?respond({code:'DELIVERY_RECEIPT_SAVE_FAILED'},500):respond({accepted:true});
 }
 return respond({code:'INVALID_WEBHOOK_EVENT'},422);
});
