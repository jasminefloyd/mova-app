import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Checkbox, TextField } from '../../components';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { clientProfilesEnabled, publicEnv } from '../../lib/env';

export function SignInPage(){
  const{t,i18n}=useTranslation();const[params]=useSearchParams();const navigate=useNavigate();const[contact,setContact]=useState('');const[code,setCode]=useState('');const[step,setStep]=useState<'contact'|'code'>('contact');const[optIn,setOptIn]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const dialogRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=dialogRef.current;if(dialog&&!dialog.open)dialog.showModal();return()=>{if(dialog?.open)dialog.close();};},[]);
  const returnTo=params.get('returnTo');const safeReturn=returnTo?.startsWith('/')&&!returnTo.startsWith('//')?returnTo:'/me';
  const submit=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{
    const auth=createMovaSupabaseClient();const normalized=contact.trim();const phone=!normalized.includes('@');const digits=normalized.replace(/\D/g,'');const phoneNumber=normalized.startsWith('+')?`+${digits}`:digits.length===10?`+1${digits}`:digits.length===11&&digits.startsWith('1')?`+${digits}`:'';if(phone&&!phoneNumber)throw new Error('INVALID_CONTACT');
    if(step==='contact'){
      if(phone){const result=await auth.auth.signInWithOtp({phone:phoneNumber,options:{shouldCreateUser:true,data:{preferred_locale:i18n.resolvedLanguage??'en-US'}}});if(result.error)throw result.error;}
      else{const result=await auth.auth.signInWithOtp({email:normalized.toLowerCase(),options:{shouldCreateUser:true,data:{preferred_locale:i18n.resolvedLanguage??'en-US'}}});if(result.error)throw result.error;}
      setStep('code');return;
    }
    const result=phone?await auth.auth.verifyOtp({phone:phoneNumber,token:code,type:'sms'}):await auth.auth.verifyOtp({email:normalized.toLowerCase(),token:code,type:'email'});if(result.error)throw result.error;
    const response=await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/customer-profile`,{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??'',Authorization:`Bearer ${result.data.session?.access_token??''}`},body:JSON.stringify({action:'bootstrap'})});
    if(!response.ok){await auth.auth.signOut();throw new Error('PROFILE_SETUP_FAILED');}
    const artistHandle=params.get('artist');if(artistHandle){window.sessionStorage.setItem(`mova_client_profile_optin_${artistHandle}`,optIn?'true':'false');window.sessionStorage.setItem(`mova_client_profile_optin_channel_${artistHandle}`,phone?'sms':'email');}
    navigate(safeReturn,{replace:true});
  }catch(err){setError(err instanceof Error&&err.message==='PROFILE_SETUP_FAILED'?t('identity.profileUnavailable'):t(step==='contact'?'identity.sendCodeError':'identity.verifyCodeError'));}finally{setBusy(false);}};
  return <main className="mova-client-auth">
    <dialog ref={dialogRef} className="mova-client-auth__sheet" aria-labelledby="mova-client-auth-title" onCancel={(event)=>{event.preventDefault();navigate(safeReturn,{replace:true});}}>
      <div className="mova-client-auth__handle" aria-hidden="true"><span/></div>
      <button type="button" className="mova-client-auth__close" aria-label={t('identity.close')} onClick={()=>navigate(safeReturn,{replace:true})}>×</button>
      <h1 id="mova-client-auth-title">{t('identity.title')}</h1><p className="mova-client-auth__intro">{clientProfilesEnabled?t('identity.intro'):t('identity.disabled')}</p>
      {clientProfilesEnabled&&<>
        <Card className="mova-client-auth__benefits"><p>✓ {t('identity.benefitSaved')}</p><p>✓ {t('identity.benefitAppointments')}</p><p>✓ {t('identity.benefitCard')}</p></Card>
        <form onSubmit={(event)=>void submit(event)}>
          {step==='contact'?<TextField label={t('identity.contact')} type="text" autoComplete="email" value={contact} onChange={(event)=>setContact(event.target.value)} placeholder={t('identity.contactPlaceholder')} required/>:<TextField label={t('identity.code')} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="••••••" required/>}
          {params.get('artist')&&step==='contact'&&<Checkbox label={t('identity.optIn')} checked={optIn} onChange={(event)=>setOptIn(event.currentTarget.checked)}/>}
          {error&&<p role="alert">{error}</p>}
          <Button type="submit" loading={busy} disabled={!contact.trim()||(step==='code'&&code.length<6)}>{t(step==='contact'?'identity.sendCode':'identity.verify')}</Button>
        </form>
        {step==='code'&&<button className="mova-link-button" type="button" onClick={()=>{setStep('contact');setCode('');}}>{t('identity.changeContact')}</button>}
      </>}
      <Link className="mova-client-auth__guest" to={safeReturn}>{t('identity.continueGuest')}</Link>
      {clientProfilesEnabled&&<small className="mova-client-auth__terms">{t('identity.terms')}</small>}
    </dialog>
  </main>;
}
export default SignInPage;
