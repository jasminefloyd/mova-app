import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, Icon, IconButton, TextArea, TextField } from '../../components';
import { clientProfilesEnabled, hcaptchaSiteKey, publicEnv, stripeTestModeEnabled, textsEnabled } from '../../lib/env';
import { MAX_PUBLIC_BOOKING_SERVICES, publicBookingLocations } from './public-booking-locations';
import { HCaptcha } from '../../components/HCaptcha';
import type { PublicArtist } from '../showcase/PublicArtistPage';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { trackProfileEvent } from '../reports/track';
import { readClientProfile } from '../identity/read-client-profile';
import { PUBLIC_PROFILE_LOCALE as locale } from '../../app/locale';

type Slot = { starts_at: string; ends_at: string; local_date: string; local_time: string; utc_offset: string; time_zone: string; booking_mode: 'instant'|'request' };
type Group = { location_id: string; location_name: string; booking_mode: 'instant'|'request'; slots: Slot[] };
type OpenDay = { date: string; open_count: number };
type BookingDraft={serviceIds:string[];day:string;slot:Slot|null;locationId:string;alternateStartsAt:string};
type ConsentChoices = { rebooking_reminders: { email: boolean; sms: boolean }; offers: { email: boolean; sms: boolean }; review_requests: { email: boolean } };
const TIME_PREVIEW_COUNT = 6;
const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
const hours = new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'short' });
const minutes = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' });

function formatDuration(totalMinutes: number) {
  const wholeHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (!wholeHours) return minutes.format(remainingMinutes);
  return remainingMinutes ? `${hours.format(wholeHours)} ${minutes.format(remainingMinutes)}` : hours.format(wholeHours);
}

const api = (name: string) => `${publicEnv.VITE_SUPABASE_URL}/functions/v1/${name}`;
const businessDate = (zone: string) => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const emptyConsentChoices = (): ConsentChoices => ({ rebooking_reminders: { email: false, sms: false }, offers: { email: false, sms: false }, review_requests: { email: true } });
function readBookingDraft(handle:string):BookingDraft|null{try{if(typeof window==='undefined')return null;const value=JSON.parse(window.sessionStorage.getItem(`mova_booking_draft_${handle}`)??'null') as (Partial<BookingDraft>&{serviceId?:string})|null;const serviceIds=Array.isArray(value?.serviceIds)?value.serviceIds:typeof value?.serviceId==='string'?[value.serviceId]:[];if(!value||serviceIds.length<1||serviceIds.length>MAX_PUBLIC_BOOKING_SERVICES||serviceIds.some(id=>typeof id!=='string')||typeof value.day!=='string'||typeof value.locationId!=='string'||typeof value.alternateStartsAt!=='string')return null;const slot=value.slot;if(slot!==null&&(!slot||typeof slot!=='object'||typeof slot.starts_at!=='string'||typeof slot.ends_at!=='string'||typeof slot.local_date!=='string'||typeof slot.local_time!=='string'||typeof slot.utc_offset!=='string'||typeof slot.time_zone!=='string'||!['instant','request'].includes(slot.booking_mode)))return null;return{serviceIds,day:value.day,slot:slot as Slot|null,locationId:value.locationId,alternateStartsAt:value.alternateStartsAt};}catch{return null;}}

export function BookingRoute() {
  const { handle = '' } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate(); const { t } = useTranslation('common', { lng: locale });
  const requestedPortfolioItemId = params.get('portfolio_item_id');
  const requestedService = params.get('service_id');
  const requestedServiceIds = params.get('service_ids')?.split(',').filter(Boolean) ?? (requestedService ? [requestedService] : []);
  const [draft] = useState(() => {
    const saved = readBookingDraft(handle);
    return requestedPortfolioItemId && requestedServiceIds.length > 0 && saved?.serviceIds.join(',') !== requestedServiceIds.join(',')
      ? null : saved;
  });
  const [artist,setArtist]=useState<PublicArtist|null>(null);const [groups,setGroups]=useState<Group[]>([]);const [openDays,setOpenDays]=useState<OpenDay[]>([]);const [availabilityLoading,setAvailabilityLoading]=useState(true);const [day,setDay]=useState(draft?.day??'');const [dayPage,setDayPage]=useState(0);const [serviceIds,setServiceIds]=useState<string[]>(draft?.serviceIds ?? requestedServiceIds);
  const [slot,setSlot]=useState<Slot|null>(draft?.slot??null);const [locationId,setLocationId]=useState(draft?.locationId??'');const [alternateStartsAt,setAlternateStartsAt]=useState(draft?.alternateStartsAt??'');const [clientNote,setClientNote]=useState('');const [name,setName]=useState('');const [email,setEmail]=useState('');const [phone,setPhone]=useState('');const [consents,setConsents]=useState<ConsentChoices>(emptyConsentChoices);const [step,setStep]=useState<'times'|'details'>('times');const [busy,setBusy]=useState(false);const [error,setError]=useState(false);const [windowNotice,setWindowNotice]=useState('');const [availabilityRefresh,setAvailabilityRefresh]=useState(0);
  const [captchaToken,setCaptchaToken]=useState<string|null>(null);const [captchaReset,setCaptchaReset]=useState(0);
  const addServiceSelect = useRef<HTMLSelectElement>(null);
  const requestIdentity=useRef<{key:string;token:string}|null>(null);
  const [clientSession, setClientSession] = useState<'checking' | 'signed-in' | 'guest'>('checking');
  const trackedBookingStart=useRef('');
  const selectedServices=useMemo(()=>serviceIds.map(id=>artist?.services.find(entry=>entry.id===id)).filter((entry):entry is NonNullable<typeof entry>=>Boolean(entry)),[artist,serviceIds]);
  const service=selectedServices[0];
  const selectedLook=useMemo(()=>artist?.looks.find((look)=>look.id===requestedPortfolioItemId&&look.service_ids.some(id=>serviceIds.includes(id)))??null,[artist,requestedPortfolioItemId,serviceIds]);
  const eligibleLocations = useMemo(() => publicBookingLocations(artist?.locations ?? [], selectedServices, stripeTestModeEnabled), [artist, selectedServices]);
  const locationTotals = eligibleLocations.map(location => selectedServices.reduce((total, service) => {
    const offer = service.location_deposits.find(item => item.location_id === location.id)!;
    return {
      price: total.price + offer.price_minor,
      duration: total.duration + offer.duration_minutes,
      deposit: total.deposit + offer.deposit_amount_minor,
    };
  }, { price: 0, duration: 0, deposit: 0 }));
  const selectedPricing = locationTotals[eligibleLocations.findIndex(location => location.id === locationId)];
  const prices = locationTotals.map(total => total.price);
  const durations = locationTotals.map(total => total.duration);
  const displayedPrice = selectedPricing?.price ?? (prices.length ? Math.min(...prices) : selectedServices.reduce((total, service) => total + service.base_price_minor, 0));
  const displayedDuration = selectedPricing?.duration ?? (durations.length ? Math.min(...durations) : selectedServices.reduce((total, service) => total + service.duration_minutes, 0));
  const priceLabel = money.format(displayedPrice / 100);
  const durationLabel = formatDuration(displayedDuration);
  const totalPrice = !selectedPricing && new Set(prices).size > 1 ? t('booking.fromValue', { value: priceLabel }) : priceLabel;
  const totalDuration = !selectedPricing && new Set(durations).size > 1 ? t('booking.fromValue', { value: durationLabel }) : durationLabel;
  const serviceDepositUnavailable = !stripeTestModeEnabled && eligibleLocations.length === 0
    && publicBookingLocations(artist?.locations ?? [], selectedServices, true).length > 0;
  const visibleDays=openDays.slice(dayPage*5,dayPage*5+5);const hasOpenDays=openDays.some((item)=>item.open_count>0);
  const pageCount=Math.max(1,Math.ceil(openDays.length/5));
  const alternateSlots=useMemo(()=>slot?.booking_mode==='request'?groups.find((group)=>group.location_id===locationId)?.slots.filter((item)=>item.starts_at!==slot.starts_at)??[]:[],[groups,locationId,slot]);
  const formatSlot=(value:Slot)=>new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:value.time_zone}).format(new Date(value.starts_at));
  const formatDay=(value:string)=>new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
  const selectedLocation=artist?.locations.find((item)=>item.id===locationId);
  const selectedZone=slot?.time_zone??artist?.locations[0]?.time_zone;
  const zoneLabel=selectedZone?new Intl.DateTimeFormat(locale,{timeZone:selectedZone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find((part)=>part.type==='timeZoneName')?.value:'';
  const setConsent=(purpose:keyof ConsentChoices,channel:'email'|'sms',value:boolean)=>setConsents((current)=>({...current,[purpose]:{...current[purpose],[channel]:value}}));

  useEffect(()=>{void (async()=>{try{const response=await fetch(api('public-artist'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({handle,tab:'services',locale})});const body=await response.json();if(!response.ok||!body.data)throw new Error();const profile: PublicArtist = body.data;
    setArtist(profile);
    const firstBookable = profile.services.find(item => publicBookingLocations(profile.locations, [item], stripeTestModeEnabled).length > 0);
    const defaultService = firstBookable ?? profile.services[0];
    setServiceIds(current => current.length || !defaultService ? current : [defaultService.id]);}catch{setError(true);}})();},[handle,locale]);
  useEffect(() => {
    if (!clientProfilesEnabled) return;
    const controller = new AbortController();
    async function prefillClient() {
      let hasSession = false;
      try {
        const { data: { session } } = await createMovaSupabaseClient().auth.getSession();
        if (controller.signal.aborted) return;
        if (!session) { setClientSession('guest'); return; }
        hasSession = true;
        setClientSession('signed-in');
        const profile = await readClientProfile(session.access_token, controller.signal);
        if (controller.signal.aborted) return;
        if (!profile) { setClientSession('guest'); return; }
        const verifiedEmail = profile.verified_contacts?.find(contact => contact.type === 'email')?.value;
        const verifiedPhone = profile.verified_contacts?.find(contact => contact.type === 'phone')?.value;
        setName(current => current || profile.display_name || '');
        setEmail(current => current || profile.email || verifiedEmail || '');
        setPhone(current => current || profile.phone || verifiedPhone || '');
      } catch {
        if (!controller.signal.aborted && !hasSession) setClientSession('guest');
      }
    }
    void prefillClient();
    return () => controller.abort();
  }, []);
  useEffect(()=>{if(artist&&trackedBookingStart.current!==handle){trackedBookingStart.current=handle;trackProfileEvent(handle,'booking_started');}},[artist,handle]);
  useEffect(()=>{
    if(!artist)return;
    if(!serviceIds.length){setAvailabilityLoading(false);return;}
    if(serviceDepositUnavailable){setGroups([]);setOpenDays([]);setSlot(null);setLocationId('');setAvailabilityLoading(false);return;}
    let active=true;
    setAvailabilityLoading(true);
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
      setGroups(nextGroups);setOpenDays(nextDays);setDayPage(0);setAvailabilityLoading(false);
      setDay(current=>current&&nextDays.some((item)=>item.date===current&&item.open_count>0)?current:(nextDays.find((item)=>item.open_count>0)?.date??nextDays[0]?.date??''));
      if(draft?.slot&&serviceIds===draft.serviceIds&&availabilityRefresh===0){const match=nextGroups.find(group=>group.location_id===draft.locationId)?.slots.find(item=>item.starts_at===draft.slot?.starts_at);setSlot(match??null);if(!match)setLocationId('');}
    }).catch(()=>{if(active){setError(true);setAvailabilityLoading(false);}});
    return()=>{active=false;};
  },[artist,serviceIds,draft,eligibleLocations,serviceDepositUnavailable,availabilityRefresh]);
  const signInQuery = new URLSearchParams({ service_ids: serviceIds.join(','), locale });
  if (selectedLook) signInQuery.set('portfolio_item_id', selectedLook.id);
  const signIn=()=>{if(typeof window!=='undefined')window.sessionStorage.setItem(`mova_booking_draft_${handle}`,JSON.stringify({serviceIds,day,slot,locationId,alternateStartsAt} satisfies BookingDraft));};
  const create=async()=>{
    if(!slot||!locationId)return;
    setBusy(true);setError(false);
    try{
      requestIdentity.current??={key:crypto.randomUUID(),token:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')};
      const response=await fetch(api('booking-create'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??'','Idempotency-Key':requestIdentity.current.key},body:JSON.stringify({...(captchaToken?{captcha_token:captchaToken}:{}),location_id:locationId,service_ids:serviceIds,starts_at:slot.starts_at,alternate_starts_at:alternateStartsAt||undefined,client_note:clientNote.trim()||undefined,portfolio_item_id:selectedLook?.id,client_name:name,client_email:email||undefined,client_phone:phone||undefined,client_locale:locale,manage_token:requestIdentity.current.token,consents})});
      const body=await response.json();if(!response.ok||!body.data?.manage_url){setCaptchaReset((n)=>n+1);if(body.data?.code==='SLOT_OUTSIDE_BOOKING_WINDOW'){setWindowNotice(t('booking.slotWindowExpired'));setStep('times');setSlot(null);setLocationId('');setAvailabilityRefresh((value)=>value+1);return;}throw new Error();}
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
  if(error)return <main className="mova-page"><ErrorState title={t('booking.error')} retryLabel={t('booking.retry')} onRetry={()=>window.location.reload()}/></main>;
  const changeServices = (nextIds: string[]) => {
    setServiceIds(nextIds);
    setSlot(null);
    setDay('');
    setLocationId('');
    setGroups([]);
    setOpenDays([]);
    setAvailabilityLoading(nextIds.length > 0);
    setAlternateStartsAt('');
    setWindowNotice('');
  };
  const availableServices = artist?.services.filter(item => !selectedServices.some(selected => selected.id === item.id)) ?? [];
  const atServiceLimit = selectedServices.length >= MAX_PUBLIC_BOOKING_SERVICES;
  const dayGroups = groups.map(group => ({ ...group, slots: group.slots.filter(item => item.local_date === day) }))
    .filter(group => group.slots.length);
  const serviceList = <ul className="mova-booking__service-list" role="list">
    {selectedServices.map(item => <li key={item.id}>
      <span>{item.name}</span>
      {step === 'times' && <IconButton type="button" className="mova-booking__remove-service"
        label={t('booking.removeService', { name: item.name })} onClick={() => {
          changeServices(selectedServices.filter(selected => selected.id !== item.id).map(selected => selected.id));
          requestAnimationFrame(() => addServiceSelect.current?.focus());
        }} />}
    </li>)}
  </ul>;
  const serviceTotal = <div className="mova-booking__service-total" aria-live="polite">
    <span>{totalDuration}</span>
    <strong>{totalPrice}</strong>
  </div>;
  const depositLabel = selectedPricing?.deposit
    ? t('booking.depositSummary', { amount: money.format(selectedPricing.deposit / 100) })
    : t('booking.noDeposit');
  const updateConsentContact=(channel:'email'|'sms',present:boolean)=>{
    if(present)return;
    setConsents((current)=>({...current,rebooking_reminders:{...current.rebooking_reminders,[channel]:false},offers:{...current.offers,[channel]:false},...(channel==='email'?{review_requests:{email:false}}:{})}));
  };
  const heading = step === 'details'
    ? t('booking.detailsTitle')
    : artist ? t('booking.bookWith', { name: artist.profile.display_name }) : t('booking.bookAppointment');
  return <main lang={locale} className="mova-page mova-booking">
    <header className="mova-booking__screen-header"><IconButton icon="back" label={step==='details'?t('booking.backToTimes'):t('booking.backToProfile')} onClick={()=>step==='details'?setStep('times'):navigate(`/a/${encodeURIComponent(handle)}?locale=${locale}`)}/><h1 title={heading}>{heading}</h1></header>
    {Boolean(artist?.services.length) && step === 'times' && <Card className="mova-booking__service">
      <h2>{t('booking.selectedServices')}</h2>
      {selectedLook && <p>{t('booking.fromLook', { look: selectedLook.alt_text })}</p>}
      {service ? serviceList : <p role="status">{t('booking.emptyServices')}</p>}
      <div className="mova-booking__add-service">
        <select ref={addServiceSelect} className="mova-input" value="" aria-label={t('booking.addService')}
          disabled={atServiceLimit || !availableServices.length} onChange={event => {
            const id = event.currentTarget.value;
            if (availableServices.some(item => item.id === id) && !atServiceLimit) {
              changeServices([...selectedServices.map(item => item.id), id]);
            }
          }}>
          <option value="" disabled>{t(atServiceLimit ? 'booking.serviceLimit' : availableServices.length ? 'booking.addService' : 'booking.allServicesAdded')}</option>
          {availableServices.map(item => <option value={item.id} key={item.id}>{item.name} · {formatDuration(item.duration_minutes)}</option>)}
        </select>
        <Icon name="chevron" size={16} />
      </div>
      {service && serviceTotal}
      {slot && Boolean(selectedPricing?.deposit) && <p>{depositLabel}</p>}
    </Card>}
    {serviceDepositUnavailable?<div role="alert" className="mova-booking__deposit-block"><Card><h2>{t('booking.depositUnavailableTitle')}</h2><p>{t('booking.depositUnavailable')}</p></Card></div>:step==='times'? (!artist?.services.length || Boolean(service)) && <>
      <h2>{t('booking.chooseDate')}</h2>
      {windowNotice&&<p role="status" className="mova-field__hint">{windowNotice}</p>}
      {hasOpenDays?<>
        <div className="mova-booking__day-heading"><span>{t('booking.monthAndZone',{month:new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date(`${(day||openDays[0]!.date).slice(0,7)}-01T12:00:00Z`)),zone:zoneLabel})}</span><div><Button type="button" variant="ghost" disabled={dayPage===0} onClick={()=>setDayPage((value)=>Math.max(0,value-1))} aria-label={t('booking.previousDays')}>‹</Button><Button type="button" variant="ghost" disabled={dayPage>=pageCount-1} onClick={()=>setDayPage((value)=>Math.min(pageCount-1,value+1))} aria-label={t('booking.nextDays')}>›</Button></div></div>
        <div className="mova-day-options" role="group" aria-label={t('booking.chooseDate')}>{visibleDays.map((item)=><button className="mova-booking__day" aria-pressed={day===item.date} disabled={item.open_count===0} key={item.date} type="button" onClick={()=>{if(item.date!==day){setDay(item.date);setSlot(null);setLocationId('');setAlternateStartsAt('');setWindowNotice('');}}}><span>{new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'}).format(new Date(`${item.date}T12:00:00Z`))}</span><strong>{new Intl.DateTimeFormat(locale,{day:'numeric',timeZone:'UTC'}).format(new Date(`${item.date}T12:00:00Z`))}</strong><small>{item.open_count>0?t(item.open_count===1?'booking.openCount_one':'booking.openCount_other',{count:item.open_count}):t('booking.full')}</small></button>)}</div>
        {dayGroups.length > 0 && <h2>{t(dayGroups.length === 1 ? 'booking.dayAtLocations_one' : 'booking.dayAtLocations_other', { date: formatDay(day), count: dayGroups.length })}</h2>}
        {dayGroups.map(group => <LocationTimes key={`${day}:${group.location_id}`} group={group}
          selectedStart={locationId === group.location_id ? slot?.starts_at : undefined}
          onSelect={item => { setSlot(item); setLocationId(group.location_id); setAlternateStartsAt(''); }} />)}
      </>:availabilityLoading?<p role="status" aria-busy="true">{t('booking.loading')}</p>:<EmptyState title={t('booking.noTimesTitle')} detail={t('booking.noTimesDetail')}/>}
      {slot && selectedLocation && hasOpenDays && <div className="mova-booking__sticky">
        <div role="status">
          <strong>{formatSlot(slot)}</strong>
          <p>{selectedLocation.name} · {t(slot.booking_mode === 'request' ? 'booking.requestNeeded' : 'booking.instantConfirmation')}</p>
        </div>
        <Button type="button" onClick={() => setStep('details')}>{t('booking.continue')}</Button>
      </div>}
    </>:<>
      <Card className="mova-booking__service">
        <header>
          <h2>{t('booking.selectedServices')}</h2>
          <Button type="button" variant="ghost" onClick={() => setStep('times')}>{t('booking.change')}</Button>
        </header>
        {serviceList}
        {serviceTotal}
        {slot && selectedLocation && <p>{t('booking.selectedSlotSummary', { summary: formatSlot(slot), location: selectedLocation.name })}</p>}
        <p>{depositLabel}</p>
      </Card>
      {clientProfilesEnabled&&clientSession==='guest'&&<Card className="mova-booking__signin"><Icon name="user" size={28}/><Link to={`/signin?artist=${encodeURIComponent(handle)}&returnTo=${encodeURIComponent(`/a/${handle}/book?${signInQuery}`)}`} onClick={signIn}><strong>{t('identity.haveProfileSignIn')}</strong><small>{t('identity.fillDetailsPrompt')}</small></Link><Icon name="chevron" size={24}/></Card>}
      <section className="mova-booking__details"><h2>{t('booking.yourDetails')}</h2>{slot?.booking_mode==='request'&&<><p className="mova-booking__request-honesty">{t('booking.requestNotConfirmed')}</p><label className="mova-field"><span>{t('booking.anotherTimeOptional')}</span><select value={alternateStartsAt} onChange={(event)=>setAlternateStartsAt(event.target.value)}><option value="">{t('booking.noAlternate')}</option>{alternateSlots.map((item)=><option key={item.starts_at} value={item.starts_at}>{formatSlot(item)}</option>)}</select></label><TextArea label={t('booking.noteForStylist')} value={clientNote} onChange={(event)=>setClientNote(event.currentTarget.value.slice(0,1000))}/></>}
        <TextField label={t('booking.name')} autoComplete="name" value={name} onChange={(event)=>setName(event.target.value)} required/>
        <TextField label={t('booking.email')} type="email" autoComplete="email" value={email} onChange={(event)=>{setEmail(event.target.value);updateConsentContact('email',Boolean(event.target.value));}}/>
        <TextField label={t('booking.phone')} type="tel" autoComplete="tel" value={phone} onChange={(event)=>{setPhone(event.target.value);updateConsentContact('sms',Boolean(event.target.value));}}/>
        <fieldset className="mova-booking__consents"><legend>{t('booking.communicationChoices')}</legend><p>{t('booking.appointmentUpdatesNotice')}</p>
          {Boolean(email)&&<label><input type="checkbox" checked={consents.review_requests.email} onChange={(event)=>setConsent('review_requests','email',event.target.checked)}/><span>{t('booking.reviewRequestsChoice')}</span></label>}
          {Boolean(email)&&<label><input type="checkbox" checked={consents.rebooking_reminders.email} onChange={(event)=>setConsent('rebooking_reminders','email',event.target.checked)}/><span>{t('booking.rebookingEmailChoice')}</span></label>}
          {textsEnabled&&Boolean(phone)&&<label><input type="checkbox" checked={consents.rebooking_reminders.sms} onChange={(event)=>setConsent('rebooking_reminders','sms',event.target.checked)}/><span>{t('booking.rebookingSmsChoice')}</span></label>}
          {Boolean(email)&&<label><input type="checkbox" checked={consents.offers.email} onChange={(event)=>setConsent('offers','email',event.target.checked)}/><span>{t('booking.offersEmailChoice')}</span></label>}
          {textsEnabled&&Boolean(phone)&&<label><input type="checkbox" checked={consents.offers.sms} onChange={(event)=>setConsent('offers','sms',event.target.checked)}/><span>{t('booking.offersSmsChoice')}</span></label>}
        </fieldset>
        <HCaptcha siteKey={hcaptchaSiteKey} locale={locale} onToken={setCaptchaToken} resetKey={captchaReset} />
        <Button loading={busy} disabled={!name.trim()||(!email.trim()&&!phone.trim())||(Boolean(hcaptchaSiteKey)&&!captchaToken)} onClick={()=>void create()}>{slot?.booking_mode==='instant'?t('booking.bookAppointment'):t('booking.submit')}</Button>
        {(!name.trim()||(!email.trim()&&!phone.trim()))&&<p className="mova-field__hint" role="status">{t('booking.detailsRequiredHint')}</p>}
        {name.trim()&&(email.trim()||phone.trim())&&Boolean(hcaptchaSiteKey)&&!captchaToken&&<p className="mova-field__hint" role="status">{t('booking.verificationRequiredHint')}</p>}
      </section>
    </>}
  </main>;
}
function LocationTimes({ group, selectedStart, onSelect }: {
  group: Group;
  selectedStart: string | undefined;
  onSelect: (slot: Slot) => void;
}) {
  const { t } = useTranslation('common', { lng: locale });
  const timesId = useId();
  const [expanded, setExpanded] = useState(false);
  const preview = group.slots.slice(0, TIME_PREVIEW_COUNT);
  const selectedSlot = group.slots.find(item => item.starts_at === selectedStart);
  if (selectedSlot && !preview.includes(selectedSlot)) preview[preview.length - 1] = selectedSlot;

  return <Card className="mova-booking__location">
    <header>
      <h3>{group.location_name}</h3>
      <span className={`mova-booking__mode mova-booking__mode--${group.booking_mode}`}>
        {t(`booking.mode.${group.booking_mode}`)}
      </span>
    </header>
    <div className="mova-time-options" id={timesId} role="group" aria-label={group.location_name}>
      {(expanded ? group.slots : preview).map(item => <button className="mova-chip" type="button"
        aria-pressed={selectedStart === item.starts_at} key={item.starts_at} onClick={() => onSelect(item)}>
        {new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: item.time_zone }).format(new Date(item.starts_at))}
      </button>)}
    </div>
    {group.slots.length > TIME_PREVIEW_COUNT && <Button className="mova-booking__more-times" type="button" variant="ghost"
      aria-expanded={expanded} aria-controls={timesId} onClick={() => setExpanded(!expanded)}>
      {t(expanded ? 'booking.showFewerTimes' : 'booking.showMoreTimes')}
    </Button>}
  </Card>;
}

export default BookingRoute;
