import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, ErrorState, Icon } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Totals = { service_value_minor:number; mova_processed_minor:number; recorded_by_artist_minor:number; collected_by_salon_minor:number; mova_platform_fee_minor:number; processor_fee_minor:number; refunds_minor:number; estimated_to_artist_minor:number };
type Activity = { id:string; category:string; amount_minor:number; created_at:string; client_name:string; service_name:string; payment_method:string|null };
type Summary = { totals:Totals; activity:Activity[] };
const blank:Totals={service_value_minor:0,mova_processed_minor:0,recorded_by_artist_minor:0,collected_by_salon_minor:0,mova_platform_fee_minor:0,processor_fee_minor:0,refunds_minor:0,estimated_to_artist_minor:0};
const currentMonth=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit'}).format(new Date());

export function MoneyPage(){
  const{t,i18n}=useTranslation();const{client,businessId,loading:identityLoading}=useArtistBusiness();
  const[month,setMonth]=useState(currentMonth);const[data,setData]=useState<Summary>({totals:blank,activity:[]});const[loading,setLoading]=useState(true);const[error,setError]=useState(false);
  const load=useCallback(async()=>{if(!client||!businessId)return;setLoading(true);setError(false);try{const{data:{session}}=await client.auth.getSession();const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/money-summary`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,'x-mova-artist-business-id':businessId},body:JSON.stringify({month})});const body=await response.json();if(!response.ok||!body.data?.totals)throw new Error();setData({totals:body.data.totals,activity:body.data.activity??[]});}catch{setError(true);}finally{setLoading(false);}},[client,businessId,month]);
  useEffect(()=>{void load();},[load]);
  const currency=(value:number)=>new Intl.NumberFormat(i18n.resolvedLanguage,{style:'currency',currency:'USD'}).format(value/100);
  const total=Math.max(0,data.totals.service_value_minor);const width=(value:number)=>`${total?Math.max(0,Math.min(100,(value/total)*100)):0}%`;
  const rows=[['processed',data.totals.mova_processed_minor],['recorded',data.totals.recorded_by_artist_minor],['salon',data.totals.collected_by_salon_minor]] as const;
  const monthLabel=new Intl.DateTimeFormat(i18n.resolvedLanguage,{month:'long',year:'numeric'}).format(new Date(`${month}-01T12:00:00`));
  return <main className="mova-page mova-money-page">
    <div className="mova-money-page__period"><label className="mova-visually-hidden" htmlFor="mova-money-month">{t('money.period')}</label><input id="mova-money-month" type="month" value={month} onChange={event=>setMonth(event.currentTarget.value)} aria-label={t('money.selectMonth')}/><span className="mova-visually-hidden" aria-live="polite">{monthLabel}</span></div>
    <h1>{t('money.title')}</h1>
    {identityLoading||loading?<p role="status" aria-busy="true">{t('money.loading')}</p>:error?<ErrorState title={t('money.error')} retryLabel={t('money.retry')} onRetry={()=>void load()}/>:<>
      <Card className="mova-money-breakdown"><div className="mova-money-breakdown__total"><h2>{t('money.serviceValue')}</h2><strong>{currency(data.totals.service_value_minor)}</strong></div>
        <div className="mova-money-breakdown__bar" role="img" aria-label={t('money.breakdownLabel')}><span className="mova-money-breakdown__bar--processed" style={{width:width(data.totals.mova_processed_minor)}}/><span className="mova-money-breakdown__bar--recorded" style={{width:width(data.totals.recorded_by_artist_minor)}}/><span className="mova-money-breakdown__bar--salon" style={{width:width(data.totals.collected_by_salon_minor)}}/></div>
        <ul>{rows.map(([key,value])=><li key={key}><i className={`mova-money-breakdown__swatch mova-money-breakdown__swatch--${key}`} aria-hidden="true"/><span><strong>{t(`money.${key}`)}</strong><small>{t(`money.${key}Description`)}</small></span><b>{currency(value)}</b></li>)}</ul>
        <table className="mova-visually-hidden"><caption>{t('money.breakdownLabel')}</caption><tbody>{rows.map(([key,value])=><tr key={key}><th>{t(`money.${key}`)}</th><td>{currency(value)}</td></tr>)}</tbody></table>
      </Card>
      <Card className="mova-money-estimate"><dl>
        <div><dt>{t('money.platformFee',{rate:'1.5%'})}</dt><dd>{currency(data.totals.mova_platform_fee_minor)}</dd></div>
        <div><dt>{t('money.processorFees')}</dt><dd>{currency(data.totals.processor_fee_minor)}</dd></div>
        <div><dt>{t('money.refunds')}</dt><dd>{currency(data.totals.refunds_minor)}</dd></div>
        <div className="mova-money-estimate__total"><dt>{t('money.estimatedToYou')}</dt><dd>{currency(data.totals.estimated_to_artist_minor)}</dd></div>
      </dl><p>{t('money.estimateDisclaimer')}</p></Card>
      <section className="mova-money-activity"><h2>{t('money.recentActivity')}</h2>{data.activity.length?<ul>{data.activity.map(item=><li key={item.id}><span><strong>{t(`money.activity.${item.category}`)} · {item.client_name}</strong><small>{new Intl.DateTimeFormat(i18n.resolvedLanguage,{month:'short',day:'numeric'}).format(new Date(item.created_at))} · {item.payment_method?t(`money.methods.${item.payment_method}`):item.service_name}</small></span><b>{currency(item.amount_minor)}</b></li>)}</ul>:<EmptyState title={t('money.empty')}/>}</section>
    </>}
    {typeof navigator!=='undefined'&&!navigator.onLine&&<p className="mova-offline-banner" role="status"><Icon name="info" size={16}/>{t('components.offline')}</p>}
  </main>;
}

export default MoneyPage;
