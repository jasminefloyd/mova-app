import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, HonestyBanner, ScreenHeader, Toggle } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';

type Methods={cash_enabled:boolean;zelle_recorded_enabled:boolean;other_enabled:boolean};
const defaults:Methods={cash_enabled:true,zelle_recorded_enabled:true,other_enabled:true};

export function PaymentSettingsPage(){
  const navigate=useNavigate();const{t}=useTranslation();const{client,businessId,loading:identityLoading}=useArtistBusiness();const[methods,setMethods]=useState(defaults);const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[loadError,setLoadError]=useState(false);const[saveError,setSaveError]=useState(false);const[saved,setSaved]=useState(false);
  const headers=useCallback(async()=>{if(!client)return null;const{data:{session}}=await client.auth.getSession();return{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,'x-mova-artist-business-id':businessId??''};},[client,businessId]);
  const load=useCallback(async()=>{const h=await headers();if(!h)return;setLoading(true);setLoadError(false);try{const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-settings`,{method:'POST',headers:h,body:JSON.stringify({action:'get'})});const body=await response.json();if(!response.ok||!body.data)throw new Error();setMethods(body.data);}catch{setLoadError(true);}finally{setLoading(false);}},[headers]);
  useEffect(()=>{void load();},[load]);
  const save=async()=>{const h=await headers();if(!h)return;setSaving(true);setSaveError(false);setSaved(false);try{const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payment-settings`,{method:'POST',headers:h,body:JSON.stringify({action:'save',...methods})});if(!response.ok)throw new Error();setSaved(true);}catch{setSaveError(true);}finally{setSaving(false);}};
  return <main className="mova-page mova-payment-settings">
    <ScreenHeader title={t('money.paymentSettingsTitle')} onBack={()=>navigate(operatorUrl(businessId,'settings'))} backLabel={t('settings.close')}/>
    {identityLoading||loading?<p role="status" aria-busy="true">{t('money.loading')}</p>:loadError?<ErrorState title={t('money.settingsError')} retryLabel={t('money.retry')} onRetry={()=>void load()}/>:<>
      <h1>{t('money.howYouGetPaid')}</h1><p className="mova-payment-settings__intro">{t('money.paymentSettingsIntro')}</p>
      <Card tone="inverse" className="mova-payment-settings__stripe"><div><h2>{t('money.onlinePayments')}</h2><span className="mova-payment-settings__optional">{t('money.optional')}</span></div><p>{t('money.stripeDescription')}</p><Button type="button" variant="on-dark" disabled>{t('money.connectStripe')}</Button><small>{t('money.stripeSetupUnavailable')}</small></Card>
      <Card className="mova-payment-settings__manual"><h2>{t('money.recordedPayments')}</h2><Toggle label={t('money.methods.cash')} checked={methods.cash_enabled} onChange={value=>setMethods(old=>({...old,cash_enabled:value}))}/><Toggle label={t('money.methods.zelle_recorded')} checked={methods.zelle_recorded_enabled} onChange={value=>setMethods(old=>({...old,zelle_recorded_enabled:value}))}/><p>{t('money.recordedOnlyDisclaimer')}</p></Card>
      <HonestyBanner>{t('money.salonCollectionNotice')}</HonestyBanner>
      {saveError&&<p role="alert">{t('money.settingsSaveError')}</p>}{saved&&<p role="status">{t('money.settingsSaved')}</p>}
      <footer className="mova-payment-settings__actions"><Button type="button" loading={saving} onClick={()=>void save()}>{t('money.savePaymentSettings')}</Button></footer>
    </>}
  </main>;
}

export default PaymentSettingsPage;
