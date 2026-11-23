import type { ReactNode } from 'react';
import { PlanGate } from '../billing/PlanGate';
import { usePlan } from '../billing/PlanProvider';
import { ForecastMethod } from './ForecastMethod';
import { SlotCampaigns } from './SlotCampaigns';
import './revenue-board.css';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Link,useNavigate} from 'react-router';
import {useTranslation} from 'react-i18next';
import {Button,Card,EmptyState,ErrorState,Icon,ScreenHeader,TextField,Toggle,type IconName} from '../../components';
import {operatorUrl} from '../../app/operator-url';
import { conciergeEnabled, isConciergeReviewBusiness, rebookingAutopilotEnabled, seatFillerEnabled } from '../../lib/env';
import {useArtistBusiness} from '../settings/useArtistBusiness';

type RevenueData={pipeline:Array<{id:string;client_id:string;service_id:string;last_visit_at:string;next_due_at:string;window_end_at:string;confidence:string;status:string;client:{display_name:string;preferred_locale:string;visit_count:number;marketing_opted_out:boolean}|null}>;winback:Array<{id:string;status?:string;client:{display_name:string;preferred_locale:string}|null;last_visit_at:string}>;decisions:Array<{id:string;action:string;reason_code:string;created_at:string;value_minor:number|null}>;settings:{enabled:boolean;slot_texts_autopilot:boolean;rules:Record<string,number|string>};counts:{due:number;contacted:number;rebooked:number;winback:number};outboundEnabled:boolean};
async function invoke<T>(client:ReturnType<typeof useArtistBusiness>['client'],businessId:string|null,name:string,payload:Record<string,unknown>):Promise<T>{if(!client||!businessId)throw new Error('IDENTITY_MISSING');const{data,error}=await client.functions.invoke<{data?:T}>(name,{body:payload,headers:{'x-mova-artist-business-id':businessId}});if(error)throw error;return (data?.data??data) as T;}
function useRevenueData(){const{client,businessId,loading:identityLoading}=useArtistBusiness();const[data,setData]=useState<RevenueData|null>(null);const[forecast,setForecast]=useState<Record<string,unknown>|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState(false);const load=useCallback(async()=>{if(!client||!businessId)return;setLoading(true);setError(false);try{const[r,f]=await Promise.all([invoke<RevenueData>(client,businessId,'revenue-center',{action:'status'}),invoke<{forecast?:Record<string,unknown>|null}>(client,businessId,'forecast-summary',{})]);setData(r);setForecast(f.forecast??null);}catch{setError(true);}finally{setLoading(false);}},[client,businessId]);useEffect(()=>{void load();},[load]);return{client,businessId,data,forecast,loading:loading||identityLoading,error,load};}
type RevenueTile = {
  path: string;
  icon: IconName;
  title: string;
  detail?: string;
  variant?: 'wide' | 'muted';
};

/** Board 14: month-end forecast and the stylist's growth tools. */
export function RevenueHomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { businessId, data, forecast, loading, error, load } = useRevenueData();
  const locale = i18n.resolvedLanguage;
  const currency = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (minor: number) => currency.format(minor / 100);
  const f = forecast as { booked_minor?: number; likely_minor?: number; usual_minor?: number | null; inputs?: unknown } | null;
  const booked = f?.booked_minor ?? 0;
  const likely = f?.likely_minor ?? 0;
  const usual = f?.usual_minor ?? null;
  const scale = Math.max(1, usual ?? 0, likely, booked);
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date());
  const { due = 0, contacted = 0, rebooked = 0, winback = 0 } = data?.counts ?? {};
  const reviewOnly = isConciergeReviewBusiness(businessId);

  const groups: { id: string; title: string; tiles: RevenueTile[] }[] = [
    {
      id: 'client-follow-up',
      title: t('revenue.hub.clientFollowUp'),
      tiles: [
        ...(conciergeEnabled || reviewOnly ? [{
          path: 'growth/concierge',
          icon: 'message' as const,
          variant: 'wide' as const,
          title: t('revenue.concierge'),
          detail: reviewOnly ? t('revenue.hub.conciergeReview') : t('revenue.hub.conciergeDetail'),
        }] : []),
        { path: 'growth/pipeline', icon: 'calendar', title: t('revenue.pipeline'), detail: t('revenue.hub.pipelineDue', { count: due }) },
        { path: 'growth/winback', icon: 'clients', title: t('revenue.winback'), detail: t('revenue.hub.winbackDetail', { count: winback }) },
        ...(rebookingAutopilotEnabled ? [{
          path: 'growth/autopilot',
          icon: 'refresh' as const,
          title: t('revenue.hub.autopilotTitle', { state: data?.settings?.enabled ? t('revenue.hub.on') : t('revenue.hub.offShort') }),
          detail: t('revenue.hub.autopilotDetail', { sent: contacted, rebooked }),
        }] : []),
        ...(seatFillerEnabled ? [{ path: 'growth/slots', icon: 'plus' as const, title: t('revenue.slots'), detail: t('revenue.hub.slotsDetail') }] : []),
      ],
    },
    {
      id: 'tools-and-activity',
      title: t('revenue.hub.toolsAndActivity'),
      tiles: [
        { path: 'growth/marketing', icon: 'send', title: t('marketing.title'), detail: t('marketing.draftsOnly') },
        { path: 'growth/templates', icon: 'check', title: t('revenue.templates') },
        { path: 'growth/activity', icon: 'clock', title: t('revenue.activity'), detail: t('revenue.hub.activityDetail') },
        { path: 'growth/price-pilot', icon: 'reports', title: t('revenue.pricePilot.title'), detail: t('revenue.pricePilot.shortStatus') },
      ],
    },
  ];

  return <main className="mova-page mova-revenue-page mova-revenue-hub">
    <div className="mova-revenue-hub__header">
      <ScreenHeader onBack={() => navigate(operatorUrl(businessId, ''))} backLabel={t('navigation.home')} />
      <h1>{t('revenue.title')}</h1>
    </div>
    {loading ? <p role="status" aria-busy="true">{t('revenue.loading')}</p>
      : error ? <ErrorState title={t('revenue.error')} retryLabel={t('revenue.retry')} onRetry={() => void load()} />
      : <RevenueGate>
        <Card tone="inverse" className="mova-revenue-hero">
          <svg className="mova-revenue-hero__leaf" width="120" height="120" viewBox="0 0 40 40" aria-hidden="true"><path d="M40 4C26 4 16 14 16 28C30 28 40 18 40 4Z" /></svg>
          <h2 className="mova-revenue-hero__eyebrow">{t('revenue.hub.monthEndEstimate', { month })}</h2>
          {f ? <>
            <p className="mova-revenue-hero__value"><strong>{money(likely)}</strong></p>
            <span className="mova-revenue-bar" aria-hidden="true">
              <i className="is-booked" style={{ width: `${booked / scale * 100}%` }} />
              <i className="is-likely" style={{ width: `${Math.max(0, likely - booked) / scale * 100}%` }} />
            </span>
            <p className="mova-revenue-hero__legend">
              <span><b>{money(booked)}</b> {t('revenue.hub.booked')}</span>
              {usual !== null && <span><b>{money(usual)}</b> {t('revenue.hub.usual')}</span>}
            </p>
            <p>{usual === null ? t('revenue.insufficient') : likely < usual
              ? t('revenue.hub.short', { amount: money(usual - likely) }) : t('revenue.hub.ahead')}</p>
          </> : <p>{t('revenue.insufficient')}</p>}
          <details className="mova-revenue-hero__method">
            <summary>{t('revenue.howEstimated')}</summary>
            <ForecastMethod inputs={f?.inputs} />
          </details>
        </Card>
        {groups.map(group => <section className="mova-revenue-group" key={group.id} aria-labelledby={group.id}>
          <h2 className="mova-overline" id={group.id}>{group.title}</h2>
          <ul className="mova-revenue-hub__tiles" role="list">
            {group.tiles.map(tile => <li key={tile.path} className={tile.variant === 'wide' ? 'mova-revenue-hub__tile-wide' : undefined}>
              <Link className={`mova-revenue-tile${tile.variant ? ` mova-revenue-tile--${tile.variant}` : ''}`} to={operatorUrl(businessId, tile.path)}>
                <Icon name={tile.icon} size={18} />
                <span className="mova-revenue-tile__copy">
                  <strong>{tile.title}</strong>
                  {tile.detail && <small>{tile.detail}</small>}
                </span>
              </Link>
            </li>)}
          </ul>
        </section>)}
        <p className="mova-revenue-footnote">{t('revenue.hub.reviewOnce')}</p>
      </RevenueGate>}
  </main>;
}
/** T10: AI Revenue Center comes with AI + Growth; on Free or Pro it stays visible, locked. */
function RevenueGate({children}:{children:ReactNode}){const{t}=useTranslation();const{summary}=usePlan();
 return <PlanGate feature="reports_ai_revenue" requiredPlan="ai_growth" title={t('planGate.revenue.title')} body={summary?.current_plan?.plan_key==='pro'?t('planGate.revenue.bodyPro'):t('planGate.revenue.body')} featureName={t('planGate.revenue.name')}>{children}</PlanGate>}
type DetailMode='pipeline'|'winback'|'autopilot'|'templates'|'activity'|'slots';
export function RevenueDetailPage({mode}:{mode:DetailMode}){
 const{t,i18n}=useTranslation();const navigate=useNavigate();const{client,businessId,data,loading,error,load}=useRevenueData();const[templates,setTemplates]=useState<Array<{id:string;type:string;locale:string;body:string;version:number;status:string}>>([]);const[notice,setNotice]=useState('');const[actionError,setActionError]=useState(false);const[rules,setRules]=useState<Record<string,number>>({daily_cap:10,per_client_days:14});const[editing,setEditing]=useState<Record<string,string>>({});
 const title=mode==='pipeline'?t('revenue.pipeline'):mode==='winback'?t('revenue.winback'):mode==='autopilot'?t('revenue.autopilot'):mode==='templates'?t('revenue.templates'):mode==='activity'?t('revenue.activity'):t('revenue.slots');
 const actionLabel=(value:string)=>t(`revenue.action.${({sent:'sent',skipped:'skipped',held:'held',failed:'failed',rebooked:'rebooked'} as Record<string,string>)[value]??'other'}`);
  const reload=useCallback(async()=>{if(!client||!businessId)return;try{if(mode==='templates'){const value=await invoke<{templates?:typeof templates}>(client,businessId,'messaging-settings',{action:'status'});setTemplates(value.templates??[]);}}catch{setActionError(true);}},[client,businessId,mode]);
 useEffect(()=>{void reload();},[reload]);useEffect(()=>{if(data?.settings?.rules)setRules({daily_cap:Number(data.settings.rules.daily_cap??10),per_client_days:Number(data.settings.rules.per_client_days??14)});},[data?.settings]);
 const run=async(payload:Record<string,unknown>,fn='revenue-center')=>{setActionError(false);setNotice('');try{await invoke(client,businessId,fn,payload);setNotice(t('revenue.saved'));await Promise.all([load(),reload()]);}catch{setActionError(true);}};
 const submitTemplate=async(type:string,locale:string)=>run({action:'save-template',type,locale,body:editing[`${type}:${locale}`]??''},'messaging-settings');
 const templateEditor=(type:string,locale:'en-US'|'es-US')=>{const item=templates.find(row=>row.type===type&&row.locale===locale);return <form className="mova-concierge-form" key={locale} onSubmit={(event:FormEvent)=>{event.preventDefault();void submitTemplate(type,locale);}}><label>{t(locale==='en-US'?'revenue.languageEnglish':'revenue.languageSpanish')}<textarea required maxLength={2000} placeholder={t('revenue.templateBodyRequired')} defaultValue={item?.body??''} onChange={event=>setEditing(current=>({...current,[`${type}:${locale}`]:event.currentTarget.value}))}/></label><span>{item?.status==='approved'?t('revenue.templateStatus.approved'):item?.status==='paused'?t('revenue.templateStatus.paused'):t('revenue.templateStatus.needsApproval')}</span><Button type="submit">{t('revenue.saveTemplate')}</Button></form>;};
 const money=(minor:number|null)=>minor===null?'—':new Intl.NumberFormat(i18n.resolvedLanguage,{style:'currency',currency:'USD',minimumFractionDigits:minor%100===0?0:2}).format(minor/100);
 return <main className="mova-page mova-revenue-page"><ScreenHeader onBack={()=>navigate(operatorUrl(businessId,'growth'))} backLabel={t('settings.close')}/><h1>{title}</h1>
 {(loading||error)?loading?<p role="status" aria-busy="true">{t('revenue.loading')}</p>:<ErrorState title={t('revenue.error')} retryLabel={t('revenue.retry')} onRetry={()=>void load()}/>:<>
 {mode==='pipeline'&&<PipelineView data={data} money={money} onRefresh={()=>void run({action:'refresh-pipeline'})}/>}
 {mode==='winback'&&<WinbackView data={data} onSend={(id,offer)=>void run({action:'send-winback',opportunity_id:id,...(offer?{offer}:{})})}/>}
 {mode==='autopilot'&&<><Card className="mova-revenue-forecast"><Toggle label={t('revenue.autopilotSwitch')} description={t('revenue.autopilotSwitchDetail')} checked={data?.settings?.enabled??false} onChange={(value)=>void run({action:'set-autopilot',enabled:value})}/><p>{t('revenue.rulesSummary',{dailyCap:rules.daily_cap,frequency:rules.per_client_days})}</p>{!data?.outboundEnabled&&<p className="mova-slots__note">{t('revenue.textsOffPlatform')}</p>}<TextField label={t('revenue.dailyCap')} type="number" inputMode="numeric" min={0} max={50} value={rules.daily_cap} onChange={event=>{const dailyCap=Number(event.currentTarget.value);setRules(value=>({...value,daily_cap:dailyCap}));}}/><TextField label={t('revenue.frequency')} type="number" inputMode="numeric" min={14} value={rules.per_client_days} onChange={event=>{const perClientDays=Number(event.currentTarget.value);setRules(value=>({...value,per_client_days:perClientDays}));}}/><div className="mova-revenue-actions"><Button onClick={()=>void run({action:'save-rules',rules})}>{t('revenue.saveRules')}</Button></div></Card><p>{t('revenue.autopilotHow')}</p></>}
 {mode==='templates'&&<><p className="mova-revenue-footnote">{t('revenue.board.templatesLead')}</p>{(['rebooking_reminder', ...(seatFillerEnabled ? ['slot_offer', 'slot_taken'] as const : []), 'win_back'] as const).map(type=><TemplateCard key={type} type={type} templates={templates} editor={templateEditor}/>)}<p className="mova-revenue-footnote">{t('revenue.board.templatesStop')}</p></>}
 {mode==='activity'&&<ActivityView rows={data?.decisions??[]} actionLabel={actionLabel} money={money}/>}
 {mode==='slots'&&<SlotCampaigns/>}
 {actionError&&<p role="alert">{t('revenue.outboundDisabled')}</p>}{notice&&<p role="status">{notice}</p>}
 </>}
 </main>;
}

type Pipeline=RevenueData['pipeline'][number];
const DAY=86_400_000;
/** Board 32: three stats, then Due / Contacted / Rebooked groups of client rows with when Mova will send. */
function PipelineView({data,money,onRefresh}:{data:RevenueData|null;money:(minor:number|null)=>string;onRefresh:()=>void}){const{t}=useTranslation();
 const pipeline=data?.pipeline??[];const bookedValue=(data?.decisions??[]).filter(d=>d.action==='rebooked').reduce((sum,d)=>sum+(d.value_minor??0),0);
 const weeks=(iso:string)=>Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/(7*DAY)));
 const dueText=(item:Pipeline)=>{const days=Math.round((new Date(item.next_due_at).getTime()-Date.now())/DAY);return days>1?t('revenue.board.dueIn',{count:days}):days===1?t('revenue.board.sendsTomorrow'):days===0?t('revenue.board.sendsToday'):t('revenue.board.overdue',{count:-days});};
 const groups=([['due',(i:Pipeline)=>['due','no_reply','ineligible'].includes(i.status)],['contacted',(i:Pipeline)=>i.status==='contacted'],['rebooked',(i:Pipeline)=>i.status==='rebooked']] as const);
 return <>
  <div className="mova-revenue-stats"><div><strong>{data?.counts.contacted??0}</strong><span>{t('revenue.board.remindersMonth')}</span></div><div><strong>{data?.counts.rebooked??0}</strong><span>{t('revenue.rebooked')}</span></div><div className="is-accent"><strong>{money(bookedValue)}</strong><span>{t('revenue.board.bookedFrom')}</span></div></div>
  {pipeline.length?groups.map(([group,match])=>{const rows=pipeline.filter(match);return <section key={group} className="mova-revenue-group"><h2 className="mova-overline">{t(`revenue.${group}`)} · {rows.length}</h2>{rows.length?<ul className="mova-revenue-rows">{rows.map(item=><li key={item.id} className="mova-revenue-row mova-revenue-row--plain">
   <span className="mova-revenue-row__copy"><strong>{item.client?.display_name??'—'}</strong><small>{group==='due'?t('revenue.board.sinceVisit',{count:weeks(item.last_visit_at)}):group==='contacted'?t('revenue.board.contacted',{count:weeks(item.last_visit_at)}):t('revenue.board.rebookedRow')}</small></span>
   <span className="mova-revenue-row__aside">{group==='due'?(item.status==='ineligible'?t('revenue.status.ineligible'):dueText(item)):group==='contacted'?t('revenue.board.noBookingYet'):<span className="mova-revenue-chip">{t('revenue.rebooked')}</span>}</span>
  </li>)}</ul>:<p className="mova-revenue-footnote">{t('revenue.groupEmpty')}</p>}</section>}):<EmptyState title={t('revenue.empty')} detail={t('revenue.noHistory')}/>}
  <button type="button" className="mova-revenue-method-link" onClick={onRefresh}>{t('revenue.refresh')}</button>
 </>;}
/** Board 33: clients past their usual return; Review opens the message card. Sending is a tap, and stays off until messaging is live. */
function WinbackView({data,onSend}:{data:RevenueData|null;onSend:(id:string,offer:string)=>void}){const{t,i18n}=useTranslation();const[open,setOpen]=useState<string|null>(null);const[offer,setOffer]=useState('');
 const live=Boolean(data?.outboundEnabled);const rows=data?.winback??[];
 return <>
  <p className="mova-revenue-footnote">{t('revenue.board.winbackLead')}</p>
  {rows.length?<ul className="mova-revenue-rows">{rows.map(item=>{const expanded=open===item.id;const months=Math.max(1,Math.round((Date.now()-new Date(item.last_visit_at).getTime())/(30*DAY)));const sent=item.status==='contacted';const optedOut=item.status==='opted_out';return <li key={item.id} className={`mova-revenue-row mova-revenue-row--plain${expanded?' is-open':''}`}>
   <span className="mova-revenue-row__copy"><strong>{item.client?.display_name??'—'}</strong><small>{t('revenue.board.lastVisitMonths',{count:months})} · {new Intl.DateTimeFormat(i18n.resolvedLanguage,{month:'short',day:'numeric'}).format(new Date(item.last_visit_at))}</small></span>
   {sent?<span className="mova-revenue-chip">{t('revenue.sentStatus')}</span>:optedOut?<span className="mova-revenue-row__aside">{t('revenue.board.optedOut')}</span>:<Button variant="secondary" aria-expanded={expanded} onClick={()=>{setOpen(expanded?null:item.id);setOffer('');}}>{t('revenue.board.review')}</Button>}
   {expanded&&<div className="mova-revenue-winback">
    <TextField label={t('revenue.board.offer')} placeholder={t('revenue.board.offerPlaceholder')} value={offer} maxLength={120} onChange={event=>setOffer(event.currentTarget.value)}/>
    <p className="mova-revenue-footnote">{t('revenue.board.consentNote',{language:item.client?.preferred_locale==='es-US'?t('revenue.languageSpanish'):t('revenue.languageEnglish')})}</p>
    <div className="mova-revenue-actions"><Button variant="secondary" disabled title={t('revenue.board.previewUnavailable')}>{t('revenue.board.preview')}</Button><Button disabled={!live} onClick={()=>onSend(item.id,offer.trim())}>{t('revenue.send')}</Button></div>

   </div>}
  </li>;})}</ul>:<EmptyState title={t('revenue.board.winbackEmpty')}/>}
  <p className="mova-revenue-footnote" role="note">{live?t('revenue.manualTap'):t('revenue.manualOnly')}</p>
 </>;}
type Template={id:string;type:string;locale:string;body:string;version:number;status:string;updated_at?:string};
/** Board 35: each approved message shows its copy with the fields highlighted, English/Español tabs, its status and Edit. */
function TemplateCard({type,templates,editor}:{type:string;templates:Template[];editor:(type:string,locale:'en-US'|'es-US')=>ReactNode}){const{t,i18n}=useTranslation();const[locale,setLocale]=useState<'en-US'|'es-US'>('en-US');const[editing,setEditing]=useState(false);
 const item=templates.find(row=>row.type===type&&row.locale===locale);const approved=item?.status==='approved';
 const highlighted=(body:string)=>body.split(/(\{[a-z_]+\})/g).map((part,index)=>/^\{[a-z_]+\}$/.test(part)?<mark key={index}>{part}</mark>:part);
 return <Card className="mova-template-card">
  <div className="mova-template-card__head"><h2>{t(`revenue.templateType.${type}`)}</h2><span className={`mova-revenue-chip${approved?'':' is-warn'}`}>{approved?(item?.updated_at?t('revenue.board.approvedOn',{date:new Intl.DateTimeFormat(i18n.resolvedLanguage,{month:'short',day:'numeric'}).format(new Date(item.updated_at))}):t('revenue.templateStatus.approved')):t('revenue.templateStatus.needsApproval')}</span></div>
  <div className="mova-template-card__tabs" role="tablist" aria-label={t('revenue.board.language')}>{(['en-US','es-US'] as const).map(code=><button key={code} type="button" role="tab" aria-selected={locale===code} onClick={()=>{setLocale(code);setEditing(false);}}>{code==='en-US'?'English':'Español'}</button>)}</div>
  {editing?editor(type,locale):<p className="mova-template-card__body">{item?.body?highlighted(item.body):<span className="mova-revenue-footnote">{t('revenue.board.noCopy')}</span>}</p>}
  {!editing&&<div className="mova-revenue-actions"><Button variant="secondary" onClick={()=>setEditing(true)}>{item?.body?t('revenue.board.edit'):t('revenue.board.write')}</Button></div>}
 </Card>;}
type Decision=RevenueData['decisions'][number];
/** Board 36: All / Sent / Skipped / Problems, grouped by day, with the reason in words and Export. */
function ActivityView({rows,actionLabel,money}:{rows:Decision[];actionLabel:(value:string)=>string;money:(minor:number|null)=>string}){const{t,i18n}=useTranslation();const[filter,setFilter]=useState<'all'|'sent'|'skipped'|'problems'>('all');
 const shown=rows.filter(item=>filter==='all'||(filter==='problems'?['held','failed'].includes(item.action):filter==='sent'?['sent','rebooked'].includes(item.action):item.action===filter));
 const reason=(code:string)=>t(`revenue.board.reasons.${code}`,{defaultValue:t('revenue.board.reasons.other')});
 const day=(iso:string)=>{const d=new Date(iso);const today=new Date();const diff=Math.round((new Date(today.toDateString()).getTime()-new Date(d.toDateString()).getTime())/DAY);return diff===0?t('revenue.board.today'):diff===1?t('revenue.board.yesterday'):new Intl.DateTimeFormat(i18n.resolvedLanguage,{weekday:'long',month:'short',day:'numeric'}).format(d);};
 const icon=(action:string)=>action==='sent'?'↗':action==='rebooked'?'✓':action==='skipped'?'–':'!';
 const exportCsv=()=>{const csv=[['When','Action','Reason','Value'],...shown.map(item=>[item.created_at,actionLabel(item.action),reason(item.reason_code),item.value_minor===null?'':String(item.value_minor/100)])].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='mova-autopilot-activity.csv';a.click();URL.revokeObjectURL(url);};
 return <>
  <div className="mova-revenue-filter"><div className="mova-chip-row" role="group" aria-label={t('revenue.filterActivity')}>{(['all','sent','skipped','problems'] as const).map(key=><button key={key} type="button" className={`mova-chip${filter===key?' is-selected':''}`} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{t(`revenue.board.filter.${key}`)}</button>)}</div><button type="button" className="mova-revenue-method-link" onClick={exportCsv} disabled={!shown.length}>{t('revenue.board.export')}</button></div>
  {shown.length?shown.map((item,index)=>{const label=day(item.created_at);const first=index===0||day(shown[index-1]!.created_at)!==label;return <div key={item.id}>{first&&<h2 className="mova-overline mova-revenue-day">{label}</h2>}<div className="mova-revenue-row mova-revenue-row--plain"><span className={`mova-revenue-row__icon is-${item.action}`} aria-hidden="true">{icon(item.action)}</span><span className="mova-revenue-row__copy"><strong>{actionLabel(item.action)}</strong><small>{reason(item.reason_code)} · {new Intl.DateTimeFormat(i18n.resolvedLanguage,{hour:'numeric',minute:'2-digit'}).format(new Date(item.created_at))}</small></span>{item.value_minor!==null&&<b className="mova-revenue-chip">{money(item.value_minor)}</b>}</div></div>;}):<EmptyState title={t('revenue.activityEmpty')}/>}
 </>;}
