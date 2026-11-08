import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, IconButton, OptionGroup, RadioCard, TextField } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { parseDisplayId } from '../../lib/display-ids';

type Method='card'|'cash'|'other';
type Appointment={id:string;status:string;starts_at:string;service_name_snapshot:string;service_price_minor:number;balance_due_minor:number;client_name:string;location_id:string;artist_business_id:string};
const endpoint=(name:string)=>`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

export function GetPaidPage(){
  const{appointmentId=''}=useParams();const appointmentNumber=parseDisplayId('AID',appointmentId);const navigate=useNavigate();const{t,i18n}=useTranslation();const{client,businessId,loading:identityLoading}=useArtistBusiness();
  const[appointment,setAppointment]=useState<Appointment|null>(null);const[serviceNames,setServiceNames]=useState<string[]>([]);const[method,setMethod]=useState<Method>('card');const[cardMode,setCardMode]=useState<'qr'|'text'>('text');const[collector,setCollector]=useState<'artist'|'salon'>('artist');const[amount,setAmount]=useState('');const[otherLabel,setOtherLabel]=useState('');const[settings,setSettings]=useState({cash_enabled:true,other_enabled:true});const[stripeReady,setStripeReady]=useState(false);const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState(false);
  const back=()=>navigate(operatorUrl(businessId,`appointments/${appointmentId}`));
  const load=useCallback(async()=>{if(!client||!businessId)return;setLoading(true);setError(false);try{if(!appointmentNumber)throw new Error();const {data:a,error:aError}=await client.from('mova_appointments').select('id,appointment_number,status,starts_at,service_name_snapshot,service_price_minor,balance_due_minor,client_name,location_id,artist_business_id').eq('appointment_number',appointmentNumber).eq('artist_business_id',businessId).maybeSingle();
    if(aError||!a)throw new Error();const [{data:paymentLocation},{data:stripe},{data:methods},{data:services}]=await Promise.all([
      client.from('mova_locations').select('name,payment_collector,time_zone').eq('id',a.location_id).eq('artist_business_id',businessId).maybeSingle(),
      client.from('mova_stripe_connections').select('status,charges_enabled,account_type').eq('artist_business_id',businessId).maybeSingle(),
      client.from('mova_payment_method_settings').select('cash_enabled,other_enabled').eq('artist_business_id',businessId).maybeSingle(),
      client.from('mova_appointment_services').select('position,service_name_snapshot').eq('appointment_id',a.id).eq('artist_business_id',businessId).order('position'),
    ]);setAppointment(a as Appointment);setServiceNames(services?.map(item=>item.service_name_snapshot)??[a.service_name_snapshot]);setCollector(paymentLocation?.payment_collector==='salon'?'salon':'artist');setAmount(((a.balance_due_minor??0)/100).toFixed(2));setStripeReady(Boolean(stripe?.status==='active'&&stripe.charges_enabled));if(methods)setSettings(methods);}catch{setError(true);}finally{setLoading(false);}},[client,businessId,appointmentNumber]);
  useEffect(()=>{void load();},[load]);
  const balance=appointment?.balance_due_minor??0;const amountMinor=useMemo(()=>/^\d+(\.\d{1,2})?$/.test(amount)?Math.round(Number(amount)*100):0,[amount]);
  const currency=(minor:number)=>new Intl.NumberFormat(i18n.resolvedLanguage,{style:'currency',currency:'USD'}).format(minor/100);
  const availableMethods:Method[]=['card',...(settings.cash_enabled?['cash' as const]:[]),...(settings.other_enabled?['other' as const]:[])];
  const save=async()=>{if(!client||!businessId||!appointment||amountMinor<=0)return;setBusy(true);setError(false);try{const{data:{session}}=await client.auth.getSession();const response=await fetch(endpoint('manual-payment-record'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,'x-mova-artist-business-id':businessId,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({appointment_id:appointment.id,method:method==='card'?'card_checkout':method,amount_minor:amountMinor,collector,recorded_method_label:method==='other'?otherLabel.trim():undefined})});const payload=await response.json();if(!response.ok)throw new Error(payload.error?.code??'PAYMENT_RECORD_FAILED');back();}catch{setError(true);}finally{setBusy(false);}};
  return <main className="mova-page mova-get-paid">
    <header className="mova-get-paid__header"><h1>{t('money.getPaid')}</h1><IconButton label={t('money.close')} icon="close" onClick={back}/></header>
    {identityLoading||loading?<p role="status" aria-busy="true">{t('money.loading')}</p>:error&&!appointment?<ErrorState title={t('money.error')} retryLabel={t('money.retry')} onRetry={()=>void load()}/>:appointment&&<>
      <p className="mova-get-paid__context">{serviceNames.join(' + ')||appointment.service_name_snapshot} · {appointment.client_name} · {t('money.balance',{amount:currency(balance)})}</p>
      <TextField label={t('money.amount')} inputMode="decimal" value={amount} onChange={event=>setAmount(event.currentTarget.value)}/>
      <fieldset className="mova-get-paid__method-group"><legend className="mova-visually-hidden">{t('money.method')}</legend><OptionGroup label={t('money.method')}>
        {availableMethods.map(value=><RadioCard key={value} name="payment-method" value={value} label={t(`money.methods.${value}`)} checked={method===value} disabled={value==='card'&&!stripeReady} onChange={()=>setMethod(value)}/>) }
      </OptionGroup></fieldset>
      {method==='card'?<section className="mova-get-paid__card-flow"><p className="mova-get-paid__status">{t('money.processedByStripe')}</p><OptionGroup label={t('money.cardDelivery')}><RadioCard name="card-delivery" value="qr" label={t('money.showPayQr')} description={t('money.clientScansAtChair')} checked={cardMode==='qr'} disabled={!stripeReady} onChange={()=>setCardMode('qr')}/><RadioCard name="card-delivery" value="text" label={t('money.textPayLink',{name:appointment.client_name})} description={t('money.paysOnPhone')} checked={cardMode==='text'} disabled={!stripeReady} onChange={()=>setCardMode('text')}/></OptionGroup><p>{t('money.cardFeeNotice',{fee:currency(Math.round(amountMinor*150/10000))})}</p>{!stripeReady&&<Card tone="warm" className="mova-get-paid__notice"><p>{t('money.stripeNotConnected')}</p><Button type="button" variant="secondary" onClick={()=>navigate(operatorUrl(businessId,'settings/payments'))}>{t('money.paymentSettings')}</Button></Card>}</section>:<>
        <p className="mova-get-paid__recorded-status"><IconStatus/>{t('money.recordedOnly')}</p>
        {method==='cash'&&<p className="mova-get-paid__notice-copy">{t('money.cashInstructions')}</p>}
        {method==='other'&&<><TextField label={t('money.otherMethod')} placeholder={t('money.otherPlaceholder')} value={otherLabel} maxLength={80} onChange={event=>setOtherLabel(event.currentTarget.value)}/><p className="mova-get-paid__notice-copy">{t('money.otherInstructions')}</p></>}
        <fieldset className="mova-get-paid__collector"><legend>{t('money.whoReceived')}</legend><OptionGroup label={t('money.whoReceived')}><RadioCard name="payment-collector" value="artist" label={t('money.iReceived')} checked={collector==='artist'} onChange={()=>setCollector('artist')}/><RadioCard name="payment-collector" value="salon" label={t('money.salonReceived')} checked={collector==='salon'} onChange={()=>setCollector('salon')}/></OptionGroup></fieldset>
      </>}
      {error&&<p role="alert">{t('money.recordError')}</p>}
      <footer className="mova-get-paid__actions"><Button type="button" loading={busy} disabled={method==='card'||amountMinor<=0||amountMinor>balance||(method==='other'&&!otherLabel.trim())} onClick={()=>void save()}>{method==='card'?cardMode==='text'?t('money.sendPayLink',{amount:currency(amountMinor)}):t('money.showPayQr'):method==='cash'?t('money.saveCashPayment'):t('money.savePayment',{amount:currency(amountMinor)})}</Button></footer>
    </>}
  </main>;
}

function IconStatus(){return <span aria-hidden="true" className="mova-get-paid__status-icon">✓</span>;}
export default GetPaidPage;
