import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, TextArea, TextField } from '../../components';
import { clientProfilesEnabled, publicEnv, stripeTestModeEnabled } from '../../lib/env';
import type { PublicArtist } from '../showcase/PublicArtistPage';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { trackProfileEvent } from '../reports/track';
import { PublicLocaleToggle } from '../../app/PublicLocaleToggle';
import { useLocale } from '../../app/LocaleProvider';

type Slot = { starts_at: string; ends_at: string; local_date: string; local_time: string; utc_offset: string; time_zone: string; booking_mode: 'instant'|'request' };
type Group = { location_id: string; location_name: string; booking_mode: 'instant'|'request'; slots: Slot[] };
type OpenDay = { date: string; open_count: number };
type BookingDraft={serviceIds:string[];day:string;slot:Slot|null;locationId:string;alternateStartsAt:string};
type ConsentChoices = { rebooking_reminders: { email: boolean; sms: boolean }; offers: { email: boolean; sms: boolean }; review_requests: { email: boolean } };
const api = (name: string) => `${publicEnv.VITE_SUPABASE_URL}/functions/v1/${name}`;
const businessDate = (zone: string) => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const emptyConsentChoices = (): ConsentChoices => ({ rebooking_reminders: { email: false, sms: false }, offers: { email: false, sms: false }, review_requests: { email: true } });
function readBookingDraft(handle:string):BookingDraft|null{try{if(typeof window==='undefined')return null;const value=JSON.parse(window.sessionStorage.getItem(`mova_booking_draft_${handle}`)??'null') as (Partial<BookingDraft>&{serviceId?:string})|null;const serviceIds=Array.isArray(value?.serviceIds)?value.serviceIds:typeof value?.serviceId==='string'?[value.serviceId]:[];if(!value||serviceIds.length<1||serviceIds.length>8||serviceIds.some(id=>typeof id!=='string')||typeof value.day!=='string'||typeof value.locationId!=='string'||typeof value.alternateStartsAt!=='string')return null;const slot=value.slot;if(slot!==null&&(!slot||typeof slot!=='object'||typeof slot.starts_at!=='string'||typeof slot.ends_at!=='string'||typeof slot.local_date!=='string'||typeof slot.local_time!=='string'||typeof slot.utc_offset!=='string'||typeof slot.time_zone!=='string'||!['instant','request'].includes(slot.booking_mode)))return null;return{serviceIds,day:value.day,slot:slot as Slot|null,locationId:value.locationId,alternateStartsAt:value.alternateStartsAt};}catch{return null;}}

export function BookingRoute() {
  const { handle = '' } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate(); const { i18n,t } = useTranslation(); const { locale: guestLocale } = useLocale();
  const [draft]=useState(()=>readBookingDraft(handle));
  const locale = params.get('locale') === 'es-US' ? 'es-US' : params.get('locale') === 'en-US' ? 'en-US' : guestLocale;
  const requestedPortfolioItemId=params.get('portfolio_item_id');
  const [artist,setArtist]=useState<PublicArtist|null>(null);const [groups,setGroups]=useState<Group[]>([]);const [openDays,setOpenDays]=useState<OpenDay[]>([]);const [day,setDay]=useState(draft?.day??'');const [dayPage,setDayPage]=useState(0);const [serviceIds,setServiceIds]=useState<string[]>(draft?.serviceIds??(params.get('service_ids')?params.get('service_ids')!.split(',').filter(Boolean):params.get('service_id')?[params.get('service_id')!]:[]));
  const [slot,setSlot]=useState<Slot|null>(draft?.slot??null);const [locationId,setLocationId]=useState(draft?.locationId??'');const [alternateStartsAt,setAlternateStartsAt]=useState(draft?.alternateStartsAt??'');const [clientNote,setClientNote]=useState('');const [name,setName]=useState('');const [email,setEmail]=useState('');const [phone,setPhone]=useState('');const [consents,setConsents]=useState<ConsentChoices>(emptyConsentChoices);const [showServicePicker,setShowServicePicker]=useState(false);const [step,setStep]=useState<'times'|'details'>('times');const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
  const requestIdentity=useRef<{key:string;token:string}|null>(null);
  const trackedBookingStart=useRef('');
  const selectedServices=useMemo(()=>serviceIds.map(id=>artist?.services.find(entry=>entry.id===id)).filter((entry):entry is NonNullable<typeof entry>=>Boolean(entry)),[artist,serviceIds]);
  const service=selectedServices[0];
  const selectedLook=useMemo(()=>artist?.looks.find((look)=>look.id===requestedPortfolioItemId&&look.service_ids.some(id=>serviceIds.includes(id)))??null,[artist,requestedPortfolioItemId,serviceIds]);
  const selectedPricing=useMemo(()=>{const entries=selectedServices.map(entry=>entry.location_deposits.find(item=>item.location_id===locationId));if(!entries.length||entries.some(entry=>!entry))return undefined;return{price_minor:entries.reduce((sum,entry)=>sum+entry!.price_minor,0),duration_minutes:entries.reduce((sum,entry)=>sum+entry!.duration_minutes,0),deposit_amount_minor:entries.reduce((sum,entry)=>sum+entry!.deposit_amount_minor,0)};},[selectedServices,locationId]);
  const eligibleLocations=useMemo(()=>artist?.locations.filter((location)=>stripeTestModeEnabled||!selectedServices.some(entry=>entry.location_deposits.some(item=>item.location_id===location.id&&item.deposit_amount_minor>0)))??[],[artist,selectedServices,stripeTestModeEnabled]);
  const serviceDepositUnavailable=Boolean(!stripeTestModeEnabled&&eligibleLocations.length===0&&selectedServices.some(entry=>entry.location_deposits.some(item=>item.deposit_amount_minor>0)));
  const visibleDays=openDays.slice(dayPage*5,dayPage*5+5);
  const pageCount=Math.max(1,Math.ceil(openDays.length/5));
  const alternateSlots=useMemo(()=>slot?.booking_mode==='request'?groups.find((group)=>group.location_id===locationId)?.slots.filter((item)=>item.starts_at!==slot.starts_at)??[]:[],[groups,locationId,slot]);
  const formatSlot=(value:Slot)=>new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:value.time_zone}).format(new Date(value.starts_at));
  const formatLocalTime=(value:Slot)=>new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit',timeZone:value.time_zone}).format(new Date(value.starts_at));
  const formatDay=(value:string)=>new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
  const selectedLocation=artist?.locations.find((item)=>item.id===locationId);
  const selectedZone=slot?.time_zone??artist?.locations[0]?.time_zone;
  const zoneLabel=selectedZone?new Intl.DateTimeFormat(locale,{timeZone:selectedZone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find((part)=>part.type==='timeZoneName')?.value:'';
  const setConsent=(purpose:keyof ConsentChoices,channel:'email'|'sms',value:boolean)=>setConsents((current)=>({...current,[purpose]:{...current[purpose],[channel]:value}}));

  useEffect(()=>{void (async()=>{try{const response=await fetch(api('public-artist'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({handle,tab:'services',locale})});const body=await response.json();if(!response.ok||!body.data)throw new Error();setArtist(body.data);setServiceIds(current=>current.length?current:[body.data.services[0]?.id].filter((id):id is string=>Boolean(id)));}catch{setError(true);}})();},[handle,locale]);
  useEffect(()=>{if(artist&&trackedBookingStart.current!==handle){trackedBookingStart.current=handle;trackProfileEvent(handle,'booking_started');}},[artist,handle]);
  useEffect(()=>{
    if(!artist||!serviceIds.length)return;
    if(serviceDepositUnavailable){setGroups([]);setOpenDays([]);setSlot(null);setLocationId('');return;}
    let active=true;
    void Promise.all(eligibleLocations.map(async(location)=>{
      const fromDate=businessDate(location.time_zone);
      const response=await fetch(api('availability-search'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({location_id:location.id,service_ids:serviceIds,from_date:fromDate,days:30})});
      const body=await response.json();if(!response.ok)throw new Error();
      return {group:{location_id:location.id,location_name:location.name,booking_mode:location.booking_mode,slots:body.data.groups?.[0]?.slots??[]} as Group,days:(body.data.days??[]) as OpenDay[]};
    })).then((result)=>{
      if(!active)return;
      const nextGroups=result.map((item)=>item.group);
      const counts=new Map<string,number>();
      for(const {days} of result)for(const item of days)counts.set(item.date,(counts.get(item.date)??0)+item.open_count);
      const nextDays=[...counts].map(([date,open_count])=>({date,open_count})).sort((a,b)=>a.date.localeCompare(b.date));
      setGroups(nextGroups);setOpenDays(nextDays);setDayPage(0);
      setDay(current=>current&&nextDays.some((item)=>item.date===current&&item.open_count>0)?current:(nextDays.find((item)=>item.open_count>0)?.date??nextDays[0]?.date??''));
      if(draft?.slot){const match=nextGroups.find(group=>group.location_id===draft.locationId)?.slots.find(item=>item.starts_at===draft.slot?.starts_at);setSlot(match??null);if(!match)setLocationId('');}
    }).catch(()=>{if(active)setError(true);});
    return()=>{active=false;};
  },[artist,serviceIds,draft,eligibleLocations,serviceDepositUnavailable]);
  const signIn=()=>{if(typeof window!=='undefined')window.sessionStorage.setItem(`mova_booking_draft_${handle}`,JSON.stringify({serviceIds,day,slot,locationId,alternateStartsAt} satisfies BookingDraft));};
  const create=async()=>{
    if(!slot||!locationId)return;
    setBusy(true);setError(false);
    try{
      requestIdentity.current??={key:crypto.randomUUID(),token:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')};
      const response=await fetch(api('booking-create'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??'','Idempotency-Key':requestIdentity.current.key},body:JSON.stringify({location_id:locationId,service_ids:serviceIds,starts_at:slot.starts_at,alternate_starts_at:alternateStartsAt||undefined,client_note:clientNote.trim()||undefined,portfolio_item_id:selectedLook?.id,client_name:name,client_email:email||undefined,client_phone:phone||undefined,client_locale:locale,manage_token:requestIdentity.current.token,consents})});
      const body=await response.json();if(!response.ok||!body.data?.manage_url)throw new Error();
      if(typeof body.data.id==='string'&&/^[0-9a-f-]{36}$/i.test(body.data.id))trackProfileEvent(handle,'booking_completed',body.data.id);
      if(typeof window!=='undefined'){
        window.sessionStorage.removeItem(`mova_booking_draft_${handle}`);
        if(clientProfilesEnabled){
          try{
            const optInKey=`mova_client_profile_optin_${handle}`;const client=createMovaSupabaseClient();const{data:{session}}=await client.auth.getSession();
            if(session){
              const headers={'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??'',Authorization:`Bearer ${session.access_token}`};
              const profileResponse=await fetch(api('customer-profile'),{method:'POST',headers,body:JSON.stringify({action:'bootstrap'})});
              if(profileResponse.ok&&typeof body.data.id==='string'){
                const linkResponse=await fetch(api('customer-profile'),{method:'POST',headers,body:JSON.stringify({action:'link-booking',appointment_id:body.data.id,manage_token:requestIdentity.current.token})});
                if(linkResponse.ok&&window.sessionStorage.getItem(optInKey)==='true'){
                  const channel=window.sessionStorage.getItem(`mova_client_profile_optin_channel_${handle}`)==='sms'?'sms':'email';
                  const consentResponse=await fetch(api('customer-profile'),{method:'POST',headers,body:JSON.stringify({action:'consent-by-handle',artist_handle:handle,purpose:'rebooking_reminders',channel,granted:true})});
                  if(consentResponse.ok){window.sessionStorage.removeItem(optInKey);window.sessionStorage.removeItem(`mova_client_profile_optin_channel_${handle}`);}
                }
              }
            }
          }catch{/* Booking succeeded; optional profile setup can be retried later. */}
        }
      }
      if(Number(body.data.deposit_due_minor)>0&&stripeTestModeEnabled){
        const checkout=await fetch(api('payment-intent-create'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??'','Idempotency-Key':`${requestIdentity.current.key}:checkout`},body:JSON.stringify({appointment_id:body.data.id,manage_token:requestIdentity.current.token})});
        const checkoutBody=await checkout.json();
        if(!checkout.ok||typeof checkoutBody.data?.checkout_url!=='string')throw new Error();
        window.location.assign(checkoutBody.data.checkout_url);
        return;
      }
      navigate(new URL(body.data.manage_url).pathname,{replace:true});
    }catch{setError(true);}finally{setBusy(false);}
  };
  if(error)return <main className="mova-page"><ErrorState title={i18n.t('booking.error')} retryLabel={i18n.t('booking.retry')} onRetry={()=>window.location.reload()}/></main>;
  const toggleService=(value:string,checked:boolean)=>{setServiceIds(current=>{if(checked)return current.includes(value)||current.length>=8?current:[...current,value];if(current.length<=1)return current;return current.filter(id=>id!==value);});setSlot(null);setDay('');setLocationId('');setGroups([]);setOpenDays([]);setAlternateStartsAt('');setStep('times');};
  const updateConsentContact=(channel:'email'|'sms',present:boolean)=>{
    if(present)return;
    setConsents((current)=>({...current,rebooking_reminders:{...current.rebooking_reminders,[channel]:false},offers:{...current.offers,[channel]:false},...(channel==='email'?{review_requests:{email:false}}:{})}));
  };
  return <main className="mova-page mova-booking">
    <div className="mova-booking__brand"><p className="mova-wordmark">mova</p><PublicLocaleToggle /></div>
    <h1>{step==='details'?i18n.t('booking.detailsTitle'):i18n.t('booking.bookWith',{name:artist?.profile.display_name??''})}</h1>
    {service&&<Card className="mova-booking__service"><div><small>{selectedLook?i18n.t('booking.fromLook',{look:selectedLook.alt_text}):i18n.t('booking.selectedServices')}</small><strong>{selectedServices.map(item=>item.name).join(' + ')}</strong><p>{i18n.t('booking.serviceDurationPrice',{duration:selectedPricing?.duration_minutes??selectedServices.reduce((sum,item)=>sum+item.duration_minutes+(item.buffer_minutes??0),0),price:new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format((selectedPricing?.price_minor??selectedServices.reduce((sum,item)=>sum+item.base_price_minor,0))/100)})}</p></div><Button type="button" variant="ghost" onClick={()=>setShowServicePicker((value)=>!value)}>{i18n.t('booking.addAnotherService')}</Button></Card>}
    {showServicePicker&&<fieldset className="mova-booking__consents"><legend>{i18n.t('booking.chooseServices')}</legend>{artist?.services.map(item=><label key={item.id}><input type="checkbox" checked={serviceIds.includes(item.id)} disabled={!serviceIds.includes(item.id)&&serviceIds.length>=8} onChange={event=>toggleService(item.id,event.currentTarget.checked)}/><span>{item.name} · {item.duration_minutes} {i18n.t('booking.minutes')}</span></label>)}</fieldset>}
    {serviceDepositUnavailable?<div role="alert" className="mova-booking__deposit-block"><Card><h2>{i18n.t('booking.depositUnavailableTitle')}</h2><p>{i18n.t('booking.depositUnavailable')}</p></Card></div>:step==='times'?<>
      <h2>{i18n.t('booking.chooseDate')}</h2>
      {openDays.length>0?<>
        <div className="mova-booking__day-heading"><span>{i18n.t('booking.monthAndZone',{month:new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date(`${(day||openDays[0]!.date).slice(0,7)}-01T12:00:00Z`)),zone:zoneLabel})}</span><div><Button type="button" variant="ghost" disabled={dayPage===0} onClick={()=>setDayPage((value)=>Math.max(0,value-1))} aria-label={i18n.t('booking.previousDays')}>‹</Button><Button type="button" variant="ghost" disabled={dayPage>=pageCount-1} onClick={()=>setDayPage((value)=>Math.min(pageCount-1,value+1))} aria-label={i18n.t('booking.nextDays')}>›</Button></div></div>
        <div className="mova-day-options" role="group" aria-label={i18n.t('booking.chooseDate')}>{visibleDays.map((item)=><button className="mova-booking__day" aria-pressed={day===item.date} disabled={item.open_count===0} key={item.date} type="button" onClick={()=>{setDay(item.date);setSlot(null);}}><span>{new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'}).format(new Date(`${item.date}T12:00:00Z`))}</span><strong>{new Intl.DateTimeFormat(locale,{day:'numeric',timeZone:'UTC'}).format(new Date(`${item.date}T12:00:00Z`))}</strong><small>{item.open_count>0?i18n.t(item.open_count===1?'booking.openCount_one':'booking.openCount_other',{count:item.open_count}):i18n.t('booking.full')}</small></button>)}</div>
        <h2>{day?i18n.t(groups.filter((group)=>group.slots.some((item)=>item.local_date===day)).length===1?'booking.dayAtLocations_one':'booking.dayAtLocations_other',{date:formatDay(day),count:groups.filter((group)=>group.slots.some((item)=>item.local_date===day)).length}):i18n.t('booking.chooseTime')}</h2>
        {groups.filter((group)=>group.slots.some((item)=>item.local_date===day)).map((group)=><Card className="mova-booking__location" key={group.location_id}><header><h3>{group.location_name}</h3><span className={`mova-booking__mode mova-booking__mode--${group.booking_mode}`}>{i18n.t(`booking.mode.${group.booking_mode}`)}</span></header><div className="mova-time-options">{group.slots.filter((item)=>item.local_date===day).map((item)=><button className="mova-chip" aria-pressed={slot?.starts_at===item.starts_at&&locationId===group.location_id} key={item.starts_at} type="button" onClick={()=>{setSlot(item);setLocationId(group.location_id);setAlternateStartsAt('');}}>{formatLocalTime(item)}</button>)}</div>{group.booking_mode==='request'&&<p>{i18n.t('booking.requestModeNote')}</p>}</Card>)}
      </>:<EmptyState title={i18n.t('booking.noTimesTitle')} detail={i18n.t('booking.noTimesDetail')}/>}
      {slot&&selectedPricing&&<Card className="mova-booking__price-summary"><strong>{selectedServices.map(item=>item.name).join(' + ')}</strong><p>{i18n.t('booking.priceSummary',{amount:new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format(selectedPricing.price_minor/100)})} · {selectedPricing.deposit_amount_minor>0?i18n.t('booking.depositSummary',{amount:new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format(selectedPricing.deposit_amount_minor/100)}):i18n.t('booking.noDeposit')}</p></Card>}
      <div className="mova-booking__sticky"><p>{slot&&selectedLocation?i18n.t('booking.selectedSlotSummary',{summary:formatSlot(slot),location:selectedLocation.name}):i18n.t('booking.chooseTime')}</p><Button disabled={!slot||!locationId} onClick={()=>setStep('details')}>{i18n.t('booking.continue')}</Button></div>
    </>:<>
      <Card className="mova-booking__details-summary"><Button type="button" variant="ghost" onClick={()=>setStep('times')}>{i18n.t('booking.change')}</Button><strong>{selectedServices.map(item=>item.name).join(' + ')}{artist?.profile.display_name?` ${i18n.t('booking.withArtist',{name:artist.profile.display_name})}`:''}</strong><p>{slot&&selectedLocation?`${formatSlot(slot)} · ${selectedLocation.name}`:''}</p><strong>{selectedPricing?new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format(selectedPricing.price_minor/100):''}</strong><small>{selectedPricing?.deposit_amount_minor?i18n.t('booking.depositSummary',{amount:new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format(selectedPricing.deposit_amount_minor/100)}):i18n.t('booking.noDeposit')}</small></Card>
      {clientProfilesEnabled&&<Card className="mova-booking__signin"><Link to={`/signin?artist=${encodeURIComponent(handle)}&returnTo=${encodeURIComponent(`/a/${handle}/book?service_ids=${encodeURIComponent(serviceIds.join(','))}`)}`} onClick={signIn}>{t('identity.haveProfileSignIn')}</Link></Card>}
      <section className="mova-booking__details"><h2>{i18n.t('booking.yourDetails')}</h2>{slot?.booking_mode==='request'&&<><p className="mova-booking__request-honesty">{i18n.t('booking.requestNotConfirmed')}</p><label className="mova-field"><span>{i18n.t('booking.anotherTimeOptional')}</span><select value={alternateStartsAt} onChange={(event)=>setAlternateStartsAt(event.target.value)}><option value="">{i18n.t('booking.noAlternate')}</option>{alternateSlots.map((item)=><option key={item.starts_at} value={item.starts_at}>{formatSlot(item)}</option>)}</select></label><TextArea label={i18n.t('booking.noteForStylist')} value={clientNote} onChange={(event)=>setClientNote(event.currentTarget.value.slice(0,1000))}/></>}
        <TextField label={i18n.t('booking.name')} autoComplete="name" value={name} onChange={(event)=>setName(event.target.value)} required/>
        <TextField label={i18n.t('booking.email')} type="email" autoComplete="email" value={email} onChange={(event)=>{setEmail(event.target.value);updateConsentContact('email',Boolean(event.target.value));}}/>
        <TextField label={i18n.t('booking.phone')} type="tel" autoComplete="tel" value={phone} onChange={(event)=>{setPhone(event.target.value);updateConsentContact('sms',Boolean(event.target.value));}}/>
        <fieldset className="mova-booking__consents"><legend>{i18n.t('booking.communicationChoices')}</legend><p>{i18n.t('booking.appointmentUpdatesNotice')}</p>
          {Boolean(email)&&<label><input type="checkbox" checked={consents.review_requests.email} onChange={(event)=>setConsent('review_requests','email',event.target.checked)}/><span>{i18n.t('booking.reviewRequestsChoice')}</span></label>}
          {Boolean(email)&&<label><input type="checkbox" checked={consents.rebooking_reminders.email} onChange={(event)=>setConsent('rebooking_reminders','email',event.target.checked)}/><span>{i18n.t('booking.rebookingEmailChoice')}</span></label>}
          {Boolean(phone)&&<label><input type="checkbox" checked={consents.rebooking_reminders.sms} onChange={(event)=>setConsent('rebooking_reminders','sms',event.target.checked)}/><span>{i18n.t('booking.rebookingSmsChoice')}</span></label>}
          {Boolean(email)&&<label><input type="checkbox" checked={consents.offers.email} onChange={(event)=>setConsent('offers','email',event.target.checked)}/><span>{i18n.t('booking.offersEmailChoice')}</span></label>}
          {Boolean(phone)&&<label><input type="checkbox" checked={consents.offers.sms} onChange={(event)=>setConsent('offers','sms',event.target.checked)}/><span>{i18n.t('booking.offersSmsChoice')}</span></label>}
        </fieldset>
        <Button loading={busy} disabled={!name.trim()||(!email.trim()&&!phone.trim())} onClick={()=>void create()}>{slot?.booking_mode==='instant'?i18n.t('booking.bookAppointment'):i18n.t('booking.submit')}</Button>
      </section>
    </>}
  </main>;
}
export default BookingRoute;
