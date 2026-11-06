import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Checkbox, HonestyBanner, OptionGroup, RadioCard, ScreenHeader } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';

type CalendarStatus={google:{google_account_email:string|null;status:string;connected_at:string}|null;feedConfigured:boolean;locations:Array<{id:string;name:string}>;settings:{location_ids:string[]}};
export function CalendarSyncPage(){
  const navigate=useNavigate();const{t}=useTranslation();const{client,businessId,loading:identityLoading}=useArtistBusiness();
  const[state,setState]=useState<CalendarStatus|null>(null);const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');const[issuedFeed,setIssuedFeed]=useState('');
  const request=useCallback(async(action:string|Record<string,unknown>)=>{
    if(!client)return null;const{data:{session}}=await client.auth.getSession();if(!session)return null;
    const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-google-connect`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`,'x-mova-artist-business-id':businessId??''},body:JSON.stringify(typeof action==='string'?{action}:action)});
    const result=await response.json();if(!response.ok)throw new Error(result?.error?.code??result?.data?.code??'CALENDAR_ACTION_FAILED');return result.data;
  },[client,businessId]);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const data=await request('status');if(data)setState(data);}catch{setError(t('calendarSync.loadError'));}finally{setLoading(false);}},[request,t]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);if(params.get('calendar')==='connected')setNotice(t('calendarSync.connected'));if(params.get('calendar')==='connect_error')setError(t('calendarSync.connectError'));},[t]);
  const connect=async()=>{setBusy(true);setError('');try{const result=await request('begin');if(result?.authorizationUrl)window.location.assign(result.authorizationUrl);else throw new Error('GOOGLE_CALENDAR_NOT_CONFIGURED');}catch(error){setError(error instanceof Error&&error.message==='GOOGLE_CALENDAR_NOT_CONFIGURED'?t('calendarSync.providerUnavailable'):t('calendarSync.connectError'));setBusy(false);}};
  const disconnect=async()=>{setBusy(true);setError('');try{await request('disconnect');setNotice(t('calendarSync.disconnected'));await load();}catch{setError(t('calendarSync.actionError'));}finally{setBusy(false);}};
  const issueFeed=async()=>{setBusy(true);setError('');try{const result=await request('rotate-feed');if(result?.feedUrl){setIssuedFeed(result.feedUrl);setState(old=>old?{...old,feedConfigured:true}:old);setNotice(t('calendarSync.linkReset'));return result.feedUrl as string;}throw new Error();}catch{setError(t('calendarSync.actionError'));return '';}finally{setBusy(false);}};
  const copyFeed=async()=>{const feed=issuedFeed||await issueFeed();if(!feed)return;try{await navigator.clipboard.writeText(feed);setNotice(t('calendarSync.linkCopied'));}catch{setError(t('calendarSync.copyError'));}};
  const saveLocations=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!state)return;setBusy(true);setError('');try{await request({action:'save-settings',location_ids:state.settings.location_ids});setNotice(t('calendarSync.locationsSaved'));}catch{setError(t('calendarSync.actionError'));}finally{setBusy(false);}};
  const displayFeed=issuedFeed?issuedFeed.replace(/([?&]token=|feed\/)[^/&]+/,'$1••••••••'):state?.feedConfigured?'webcal://[DOMAIN]/feed/••••••••':'webcal://[DOMAIN]/feed/••••••••';
  return <main className="mova-page mova-calendar-sync">
    <ScreenHeader onBack={()=>navigate(operatorUrl(businessId,'settings'))} backLabel={t('settings.close')}/><h1>{t('calendarSync.title')}</h1>
    <HonestyBanner>{t('calendarSync.oneWay')}</HonestyBanner>
    {identityLoading||loading?<p role="status" aria-busy="true">{t('calendarSync.loading')}</p>:<>
      <Card className="mova-calendar-sync__card">
        <div className="mova-calendar-sync__heading"><h2>{t('calendarSync.googleTitle')}</h2><span className={state?.google?.status==='active'?'mova-calendar-sync__connected':''}>{state?.google?.status==='active'?`✓ ${t('calendarSync.connectedLabel')}`:t('calendarSync.notConnected')}</span></div>
        <p>{state?.google?.google_account_email??t('calendarSync.googleDescription')}</p>
        <h3>{t('calendarSync.eventDetails')}</h3><OptionGroup label={t('calendarSync.eventDetails')}><div className="mova-calendar-sync__privacy"><RadioCard name="calendar-privacy" value="service" label={t('calendarSync.serviceOnly')} checked disabled/><RadioCard name="calendar-privacy" value="client" label={t('calendarSync.clientName')} disabled/></div></OptionGroup>
        {Boolean(state?.locations.length)&&<details className="mova-calendar-sync__location-details"><summary>{t('calendarSync.locations')}</summary><form onSubmit={(event)=>void saveLocations(event)}>{state?.locations.map(location=><Checkbox key={location.id} label={location.name} checked={state.settings.location_ids.includes(location.id)} onChange={()=>setState(old=>old?{...old,settings:{...old.settings,location_ids:old.settings.location_ids.includes(location.id)?old.settings.location_ids.filter(id=>id!==location.id):[...old.settings.location_ids,location.id]}}:old)}/>) }<Button type="submit" variant="secondary" disabled={busy}>{t('calendarSync.saveLocations')}</Button></form></details>}
        {state?.google?.status==='active'?<Button variant="secondary" disabled={busy} onClick={()=>void disconnect()}>{t('calendarSync.disconnect')}</Button>:<Button disabled={busy} loading={busy} onClick={()=>void connect()}>{t('calendarSync.connectGoogle')}</Button>}
      </Card>
      <Card className="mova-calendar-sync__card">
        <h2>{t('calendarSync.appleTitle')}</h2><p>{t('calendarSync.appleDescription')}</p>
        <div className="mova-calendar-sync__feed" aria-label={t('calendarSync.privateLink')}><span aria-hidden="true">▣</span><code>{displayFeed}</code></div>
        <div className="mova-calendar-sync__actions"><Button onClick={()=>void copyFeed()} disabled={busy}>{t('calendarSync.copyLink')}</Button><Button variant="secondary" onClick={()=>void issueFeed()} disabled={busy}>{t('calendarSync.resetLink')}</Button></div>
      </Card>
    </>}
    {error&&<p role="alert" className="mova-calendar-sync__message">{error}</p>}{notice&&<p role="status" className="mova-calendar-sync__message">{notice}</p>}
  </main>;
}
export default CalendarSyncPage;
