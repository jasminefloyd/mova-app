import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, TextArea, TextField } from '../../components';
import { publicEnv } from '../../lib/env';
import type { PublicArtist } from '../showcase/PublicArtistPage';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { clientProfilesEnabled } from '../../lib/env';

type Slot = { starts_at: string; ends_at: string; local_date: string; local_time: string; utc_offset: string; time_zone: string; booking_mode: 'instant'|'request' };
type Group = { location_id: string; location_name: string; booking_mode: 'instant'|'request'; slots: Slot[] };
const api = (name: string) => `${publicEnv.VITE_SUPABASE_URL}/functions/v1/${name}`;
const businessDate = (zone: string) => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
type BookingDraft={serviceId:string;day:string;slot:Slot|null;locationId:string;alternateStartsAt:string};
function readBookingDraft(handle:string):BookingDraft|null{try{if(typeof window==='undefined')return null;const value=JSON.parse(window.sessionStorage.getItem(`mova_booking_draft_${handle}`)??'null') as Partial<BookingDraft>|null;if(!value||typeof value.serviceId!=='string'||typeof value.day!=='string'||typeof value.locationId!=='string'||typeof value.alternateStartsAt!=='string')return null;const slot=value.slot;if(slot!==null&&(!slot||typeof slot!=='object'||typeof slot.starts_at!=='string'||typeof slot.ends_at!=='string'||typeof slot.local_date!=='string'||typeof slot.local_time!=='string'||typeof slot.utc_offset!=='string'||typeof slot.time_zone!=='string'||!['instant','request'].includes(slot.booking_mode)))return null;return{serviceId:value.serviceId,day:value.day,slot:slot as Slot|null,locationId:value.locationId,alternateStartsAt:value.alternateStartsAt};}catch{return null;}}

export function BookingRoute() {
  const { handle = '' } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate(); const { i18n,t } = useTranslation();
  const [draft]=useState(()=>readBookingDraft(handle));
  const locale = i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US';
  const requestedPortfolioItemId=params.get('portfolio_item_id');
  const [artist,setArtist]=useState<PublicArtist|null>(null);const [groups,setGroups]=useState<Group[]>([]);const [day,setDay]=useState(draft?.day??'');const [serviceId,setServiceId]=useState(draft?.serviceId??params.get('service_id')??'');
  const [slot,setSlot]=useState<Slot|null>(draft?.slot??null);const [locationId,setLocationId]=useState(draft?.locationId??'');const [alternateStartsAt,setAlternateStartsAt]=useState(draft?.alternateStartsAt??'');const [clientNote,setClientNote]=useState('');const [name,setName]=useState('');const [email,setEmail]=useState('');const [phone,setPhone]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
  const requestIdentity=useRef<{key:string;token:string}|null>(null);
  const service=useMemo(()=>artist?.services.find((entry)=>entry.id===serviceId),[artist,serviceId]);
  const selectedLook=useMemo(()=>artist?.looks.find((look)=>look.id===requestedPortfolioItemId&&look.service_ids.includes(serviceId))??null,[artist,requestedPortfolioItemId,serviceId]);
  const alternateSlots=useMemo(()=>slot?.booking_mode==='request'?groups.find((group)=>group.location_id===locationId)?.slots.filter((item)=>item.starts_at!==slot.starts_at)??[]:[],[groups,locationId,slot]);
  const formatSlot=(value:Slot)=>new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:value.time_zone}).format(new Date(value.starts_at));
  useEffect(()=>{void (async()=>{try{const response=await fetch(api('public-artist'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({handle,tab:'services',locale})});const body=await response.json();if(!response.ok||!body.data)throw new Error();setArtist(body.data);setServiceId((current)=>current||body.data.services[0]?.id||'');}catch{setError(true);}})();},[handle,locale]);
  useEffect(()=>{if(!artist||!serviceId)return;let active=true;void Promise.all(artist.locations.map(async(location)=>{const fromDate=businessDate(location.time_zone);const response=await fetch(api('availability-search'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??''},body:JSON.stringify({location_id:location.id,service_id:serviceId,from_date:fromDate,days:30})});const body=await response.json();if(!response.ok)throw new Error();return {location_id:location.id,location_name:location.name,booking_mode:location.booking_mode,slots:body.data.groups?.[0]?.slots??[]} as Group;})).then((result)=>{if(active){setGroups(result);setDay(current=>current||(result.flatMap((group)=>group.slots).map((item)=>item.local_date).sort()[0]??''));if(draft?.slot){const match=result.find(group=>group.location_id===draft.locationId)?.slots.find(item=>item.starts_at===draft.slot?.starts_at);setSlot(match??null);if(!match)setLocationId('');}}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[artist,serviceId,draft]);
  const signIn=()=>{if(typeof window!=='undefined')window.sessionStorage.setItem(`mova_booking_draft_${handle}`,JSON.stringify({serviceId,day,slot,locationId,alternateStartsAt} satisfies BookingDraft));};
  const create=async()=>{
    if(!slot||!locationId)return;
    setBusy(true);setError(false);
    try{
      requestIdentity.current??={key:crypto.randomUUID(),token:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')};
      const response=await fetch(api('booking-create'),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicEnv.VITE_SUPABASE_ANON_KEY??'','Idempotency-Key':requestIdentity.current.key},body:JSON.stringify({location_id:locationId,service_id:serviceId,starts_at:slot.starts_at,alternate_starts_at:alternateStartsAt||undefined,client_note:clientNote.trim()||undefined,portfolio_item_id:selectedLook?.id,client_name:name,client_email:email||undefined,client_phone:phone||undefined,client_locale:locale,manage_token:requestIdentity.current.token})});
      const body=await response.json();if(!response.ok||!body.data?.manage_url)throw new Error();
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
      navigate(new URL(body.data.manage_url).pathname,{replace:true});
    }catch{setError(true);}finally{setBusy(false);}
  };
  if(error)return <main className="mova-page"><ErrorState title={i18n.t('booking.error')} retryLabel={i18n.t('booking.retry')} onRetry={()=>window.location.reload()}/></main>;
  const days=[...new Set(groups.flatMap((group)=>group.slots.map((item)=>item.local_date)))];
  return <main className="mova-page mova-booking"><p className="mova-wordmark">mova.</p><h1>{artist?.profile.display_name}</h1><h2>{i18n.t('booking.chooseService')}</h2>
    <label className="mova-field"><span>{i18n.t('booking.service')}</span><select value={serviceId} onChange={(event)=>{setServiceId(event.target.value);setSlot(null);setAlternateStartsAt('');}}>{artist?.services.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {service && <p>{service.category} · {service.duration_minutes} {i18n.t('booking.minutes')}</p>}
    <h2>{i18n.t('booking.chooseDate')}</h2><div className="mova-day-options">{days.map((value)=><button className="mova-chip" aria-pressed={day===value} key={value} type="button" onClick={()=>{setDay(value);setSlot(null);}}>{new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric'}).format(new Date(`${value}T12:00:00Z`))}</button>)}</div>
    <h2>{i18n.t('booking.chooseTime')}</h2>{groups.map((group)=><Card key={group.location_id}><h3>{group.location_name}</h3><p>{i18n.t(`booking.mode.${group.booking_mode}`)}</p><div className="mova-time-options">{group.slots.filter((item)=>item.local_date===day).map((item)=><button className="mova-chip" aria-pressed={slot?.starts_at===item.starts_at&&locationId===group.location_id} key={item.starts_at} type="button" onClick={()=>{setSlot(item);setLocationId(group.location_id);setAlternateStartsAt('');}}>{item.local_time} {item.utc_offset}</button>)}</div></Card>)}
    {slot&&<Card><h2>{i18n.t('booking.yourDetails')}</h2>{clientProfilesEnabled&&<p className="mova-booking__signin"><Link to={`/signin?artist=${encodeURIComponent(handle)}&returnTo=${encodeURIComponent(`/a/${handle}/book?service_id=${encodeURIComponent(serviceId)}`)}`} onClick={signIn}>{t('booking.haveProfileSignIn')}</Link></p>}{slot.booking_mode==='request'&&<><label className="mova-field"><span>{i18n.t('booking.anotherTimeOptional')}</span><select value={alternateStartsAt} onChange={(event)=>setAlternateStartsAt(event.target.value)}><option value="">{i18n.t('booking.noAlternate')}</option>{alternateSlots.map((item)=><option key={item.starts_at} value={item.starts_at}>{formatSlot(item)}</option>)}</select></label><TextArea label={i18n.t('booking.noteForStylist')} value={clientNote} onChange={(event)=>setClientNote(event.currentTarget.value.slice(0,1000))}/></>}<TextField label={i18n.t('booking.name')} autoComplete="name" value={name} onChange={(event)=>setName(event.target.value)} required/><TextField label={i18n.t('booking.email')} type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)}/><TextField label={i18n.t('booking.phone')} type="tel" autoComplete="tel" value={phone} onChange={(event)=>setPhone(event.target.value)}/><Button type="button" loading={busy} disabled={!name.trim()||(!email.trim()&&!phone.trim())} onClick={()=>void create()}>{i18n.t('booking.submit')}</Button></Card>}
  </main>;
}
export default BookingRoute;
