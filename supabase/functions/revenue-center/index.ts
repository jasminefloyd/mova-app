import {artistClient,corsHeaders,respond,serviceClient} from '../_shared/booking.ts';
import {estimateCadence,rebookingWindow} from '../../../packages/domain/src/rebooking.ts';
import {smsProviderFromEnv} from '../_shared/providers/sms/index.ts';
import {growthTextsEnabled,runAutopilot,sendWinback} from '../_shared/autopilot.ts';
const env=(name:string)=>Deno.env.get(name);const outbound=()=>growthTextsEnabled(env)?smsProviderFromEnv(env):null;const site=()=>env('PUBLIC_SITE_URL')??'https://mova-beauty.co';
const day=86400000;
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return respond({code:'METHOD_NOT_ALLOWED'},405);
 const actor=await artistClient(request);if(!actor)return respond({code:'UNAUTHENTICATED'},401);const db=serviceClient();const body=await request.json().catch(()=>({}));
 if(body.action==='refresh-pipeline'){
  const {data:appointments,error}=await db.from('mova_appointments').select('id,client_id,service_id,starts_at,status').eq('artist_business_id',actor.businessId).eq('status','completed').not('client_id','is',null).order('starts_at',{ascending:true}).limit(20000);
  if(error)return respond({code:'PIPELINE_SOURCE_FAILED'},500);
  const groups=new Map<string,string[]>();for(const row of appointments??[]){const key=`${row.client_id}:${row.service_id}`;groups.set(key,[...(groups.get(key)??[]),row.starts_at]);}
  let count=0;for(const [key,visits]of groups){const [clientId,serviceId]=key.split(':');const cadence=estimateCadence(visits);const last=visits.at(-1);if(!last)continue;const window=rebookingWindow(last,cadence);const dueAt=Date.parse(window.dueAt);if(dueAt>Date.now()+30*day)continue;
   const {error:upsertError}=await db.from('mova_growth_opportunities').upsert({artist_business_id:actor.businessId,client_id:clientId,service_id:serviceId,last_visit_at:last,next_due_at:window.dueAt,window_end_at:window.lateAt,confidence:cadence.confidence,evidence:{visit_dates:visits,intervals_days:cadence.intervals,typical_days:cadence.typicalDays},model_version:cadence.modelVersion,status:'due',updated_at:new Date().toISOString()},{onConflict:'artist_business_id,client_id,service_id'});
   if(upsertError)return respond({code:'PIPELINE_REFRESH_FAILED'},500);count++;
  }
  return respond({refreshed:count});
 }
 if(body.action==='status'||body.action==='pipeline'||body.action==='winback'){
  const [{data:opportunities,error},{data:settings},{data:decisions},{data:clients}]=await Promise.all([
   db.from('mova_growth_opportunities').select('id,client_id,service_id,last_visit_at,next_due_at,window_end_at,confidence,status,evidence').eq('artist_business_id',actor.businessId).in('status',['due','contacted','rebooked','no_reply']).order('next_due_at').limit(300),
   db.from('mova_autopilot_settings').select('enabled,slot_texts_autopilot,rules').eq('artist_business_id',actor.businessId).maybeSingle(),
   db.from('mova_autopilot_decisions').select('id,client_id,action,reason_code,created_at,value_minor').eq('artist_business_id',actor.businessId).order('created_at',{ascending:false}).limit(100),
   db.from('mova_clients').select('id,display_name,preferred_locale,marketing_opted_out,last_visit_at,visit_count').eq('artist_business_id',actor.businessId).order('last_visit_at',{ascending:false}).limit(1000),
  ]);
  if(error)return respond({code:'REVENUE_PIPELINE_FAILED'},500);
  const clientMap=new Map((clients??[]).map((client)=>[client.id,client]));
  const rows=(opportunities??[]).map((item)=>({...item,client:clientMap.get(item.client_id)??null}));
  const winback=rows.filter((item)=>{const evidence=item.evidence as {typical_days?:number};const typical=Number(evidence?.typical_days??42);return Date.now()-Date.parse(item.last_visit_at)>=2*typical*day&&item.client&&!item.client.marketing_opted_out;});
  return respond({pipeline:rows,winback,decisions:decisions??[],outboundEnabled:outbound()!==null,settings:settings??{enabled:true,slot_texts_autopilot:true,rules:{new_client_weeks:6,attribution_days:14,per_client_days:14,per_cycle_max:2,daily_cap:10,quiet_start:'09:00',quiet_end:'20:00'}},counts:{due:rows.filter((x)=>x.status==='due').length,contacted:rows.filter((x)=>x.status==='contacted').length,rebooked:rows.filter((x)=>x.status==='rebooked').length,winback:winback.length}});
 }
 if(body.action==='save-rules'||body.action==='set-autopilot'){
  // O11: the stylist's own switches (default ON); sending still needs the platform flag.
  const {data:existing}=await db.from('mova_autopilot_settings').select('enabled,slot_texts_autopilot,rules').eq('artist_business_id',actor.businessId).maybeSingle();
  let rules=existing?.rules??{new_client_weeks:6,attribution_days:14,per_client_days:14,per_cycle_max:2,daily_cap:10,quiet_start:'09:00',quiet_end:'20:00'};
  if(body.action==='save-rules'){
   const next=body.rules;if(!next||typeof next!=='object'||Array.isArray(next)||Object.keys(next).some((key)=>!['new_client_weeks','attribution_days','per_client_days','per_cycle_max','daily_cap','quiet_start','quiet_end'].includes(key)))return respond({code:'INVALID_RULES'},422);
   const n=(v:unknown,min:number,max:number,d:number)=>{const x=Number(v);return Number.isFinite(x)?Math.min(max,Math.max(min,Math.round(x))):d;};
   rules={...rules,daily_cap:n(next.daily_cap,0,50,10),per_client_days:n(next.per_client_days,7,90,14),per_cycle_max:n(next.per_cycle_max??rules.per_cycle_max,1,3,2),attribution_days:n(next.attribution_days??rules.attribution_days,1,60,14),quiet_start:'09:00',quiet_end:'20:00'};
  }
  const enabled=body.action==='set-autopilot'&&typeof body.enabled==='boolean'?body.enabled:(existing?.enabled??true);
  const slots=body.action==='set-autopilot'&&typeof body.slot_texts_autopilot==='boolean'?body.slot_texts_autopilot:(existing?.slot_texts_autopilot??true);
  const {error}=await db.from('mova_autopilot_settings').upsert({artist_business_id:actor.businessId,enabled,slot_texts_autopilot:slots,rules,updated_by:actor.user.id,updated_at:new Date().toISOString()},{onConflict:'artist_business_id'});
  return error?respond({code:'AUTOPILOT_SAVE_FAILED'},500):respond({settings:{enabled,slot_texts_autopilot:slots,rules}});
 }
 if(body.action==='run-autopilot'){
  const provider=outbound();if(!provider)return respond({code:'OUTBOUND_DISABLED',enabled:false},503);
  return respond({run:await runAutopilot(db,provider,actor.businessId,site())});
 }
 if(body.action==='send-winback'){
  if(typeof body.opportunity_id!=='string')return respond({code:'INVALID_OPPORTUNITY'},422);
  const provider=outbound();if(!provider)return respond({code:'OUTBOUND_DISABLED',enabled:false},503);
  const result=await sendWinback(db,provider,actor.businessId,body.opportunity_id,actor.user.id,site());
  if(result.status==='not_found')return respond({code:'OPPORTUNITY_NOT_FOUND'},404);
  if(result.status==='no_template')return respond({code:'WINBACK_TEMPLATE_NOT_APPROVED'},409);
  return respond(result);
 }
 return respond({code:'INVALID_ACTION'},422);
});
