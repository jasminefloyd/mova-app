import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, HonestyBanner, ScreenHeader, Toggle } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { publicEnv, stripeTestModeEnabled } from '../../lib/env';

type Methods={cash_enabled:boolean;other_enabled:boolean};
type StripeStatus={account_type:string;status:string;charges_enabled:boolean;payouts_enabled:boolean;details_submitted:boolean}|null;
const defaults:Methods={cash_enabled:true,other_enabled:true};

export function PaymentSettingsPage(){
  const navigate=useNavigate();const{t}=useTranslation();const{client,businessId,loading:identityLoading}=useArtistBusiness();const[methods,setMethods]=useState(defaults);const[stripeStatus,setStripeStatus]=useState<StripeStatus>(null);const[stripeBusy,setStripeBusy]=useState(false);const[stripeError,setStripeError]=useState(false);const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[loadError,setLoadError]=useState(false);const[saveError,setSaveError]=useState(false);const[saved,setSaved]=useState(false);
  const headers=useCallback(async()=>{if(!client)return null;const{data:{session}}=await client.auth.getSession();return{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,'x-mova-artist-business-id':businessId??''};},[client,businessId]);
  const load=useCallback(async()=>{const h=await headers();if(!h)return;setLoading(true);setLoadError(false);try{const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-settings`,{method:'POST',headers:h,body:JSON.stringify({action:'get'})});const body=await response.json();if(!response.ok||!body.data)throw new Error();setMethods(body.data);}catch{setLoadError(true);}finally{setLoading(false);}},[headers]);
  useEffect(()=>{void load();},[load]);
  const loadStripe=useCallback(async()=>{if(!stripeTestModeEnabled)return;const h=await headers();if(!h)return;try{const response=await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/stripe-connect-onboard`,{method:'POST',headers:h,body:JSON.stringify({action:'status'})});const body=await response.json();if(!response.ok)throw new Error();setStripeStatus(body.data?.connected??null);}catch{setStripeError(true);}},[headers]);
  useEffect(()=>{void loadStripe();},[loadStripe]);
  const save=async()=>{const h=await headers();if(!h)return;setSaving(true);setSaveError(false);setSaved(false);try{const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-settings`,{method:'POST',headers:h,body:JSON.stringify({action:'save',...methods})});if(!response.ok)throw new Error();setSaved(true);}catch{setSaveError(true);}finally{setSaving(false);}};
  const connectStripe=async()=>{const h=await headers();if(!h)return;setStripeBusy(true);setStripeError(false);try{const response=await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/stripe-connect-onboard`,{method:'POST',headers:h,body:JSON.stringify({action:'start',return_path:window.location.pathname})});const body=await response.json();if(!response.ok||typeof body.data?.authorization_url!=='string')throw new Error();window.location.assign(body.data.authorization_url);}catch{setStripeError(true);setStripeBusy(false);}};
  return <main className="mova-page mova-payment-settings">
    <ScreenHeader title={t('money.paymentSettingsTitle')} onBack={()=>navigate(operatorUrl(businessId,'settings'))} backLabel={t('settings.close')}/>
    {identityLoading||loading?<p role="status" aria-busy="true">{t('money.loading')}</p>:loadError?<ErrorState title={t('money.settingsError')} retryLabel={t('money.retry')} onRetry={()=>void load()}/>:<>
      <h1>{t('money.howYouGetPaid')}</h1><p className="mova-payment-settings__intro">{t('money.paymentSettingsIntro')}</p>
      <Card tone="inverse" className="mova-payment-settings__stripe"><div><h2>{t('money.onlinePayments')}</h2><span className="mova-payment-settings__optional">{t('money.optional')}</span></div><p>{t('money.stripeDescription')}</p>{stripeTestModeEnabled?<><p>{t('money.stripeTestModeLabel')}</p>{stripeStatus?.charges_enabled?<p role="status">{t('money.stripeTestConnected')}</p>:<Button type="button" variant="on-dark" loading={stripeBusy} onClick={()=>void connectStripe()}>{t('money.connectStripe')}</Button>}{stripeError&&<p role="alert">{t('money.stripeConnectError')}</p>}</>:<><Button type="button" variant="on-dark" disabled>{t('money.connectStripe')}</Button><small>{t('money.stripeSetupUnavailable')}</small></>}</Card>
      <Card className="mova-payment-settings__manual"><h2>{t('money.recordedPayments')}</h2><Toggle label={t('money.methods.cash')} checked={methods.cash_enabled} onChange={value=>setMethods(old=>({...old,cash_enabled:value}))}/><Toggle label={t('money.methods.other')} checked={methods.other_enabled} onChange={value=>setMethods(old=>({...old,other_enabled:value}))}/><p>{t('money.recordedOnlyDisclaimer')}</p></Card>
      <HonestyBanner>{t('money.salonCollectionNotice')}</HonestyBanner>
      {saveError&&<p role="alert">{t('money.settingsSaveError')}</p>}{saved&&<p role="status">{t('money.settingsSaved')}</p>}
      <footer className="mova-payment-settings__actions"><Button type="button" loading={saving} onClick={()=>void save()}>{t('money.savePaymentSettings')}</Button></footer>
    </>}
  </main>;
}

export default PaymentSettingsPage;
