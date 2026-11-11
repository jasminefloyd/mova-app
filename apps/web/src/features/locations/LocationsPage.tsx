import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, IconButton, ScreenHeader, TextField } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { publicEnv } from '../../lib/env';
import { useNavigate } from 'react-router';
import { operatorUrl } from '../../app/operator-url';

type Location = { id: string; name: string; location_type: string; booking_mode: string; calendar_ownership: string; payment_collector: string; time_zone: string; display_color_index: number; address: Record<string, string>; is_active: boolean };
type HoursRow = { weekday: number; opens_at: string; closes_at: string };
type ExceptionRow = { exception_date: string; is_closed: boolean; opens_at: string; closes_at: string; reason: string };
const types = ['suite', 'booth', 'commission_salon', 'mobile'] as const;
const zones = Intl.supportedValuesOf('timeZone');
const clockLabel = (value: string) => { const [hour = 0, minute = 0] = value.split(':').map(Number); return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute)); };
function groupHours(rows: HoursRow[], weekday: (value: number) => string) {
  const groups = new Map<string, { days: number[]; opens_at: string; closes_at: string }>();
  rows.forEach((row) => { const key = `${row.opens_at}|${row.closes_at}`; const group = groups.get(key) ?? { days: [], opens_at: row.opens_at, closes_at: row.closes_at }; group.days.push(row.weekday); groups.set(key, group); });
  return [...groups.values()].sort((a, b) => a.days[0]! - b.days[0]!).map((group) => ({ ...group, label: group.days.map(weekday).join(', ') }));
}

export function LocationsPage() {
  const { t } = useTranslation(); const navigate=useNavigate(); const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [locations, setLocations] = useState<Location[]>([]); const [hours, setHours] = useState<HoursRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string,{hours:HoursRow[];policy:Record<string,unknown>|null}>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); const [name, setName] = useState(''); const [type, setType] = useState<(typeof types)[number]|''>('');
  const [mode, setMode] = useState<'instant'|'request'|''>(''); const [ownership, setOwnership] = useState<'mova'|'external'|''>(''); const [collector, setCollector] = useState<'artist'|'salon'|''>('');
  const [timeZone, setTimeZone] = useState(''); const [lead, setLead] = useState('60'); const [horizon, setHorizon] = useState('60'); const [buffer, setBuffer] = useState('0');
  const [cancellationWindow, setCancellationWindow] = useState('1440'); const [requestExpiry, setRequestExpiry] = useState('24');
  const [street, setStreet] = useState(''); const [city, setCity] = useState(''); const [state, setState] = useState(''); const [postalCode, setPostalCode] = useState('');
  const [parking, setParking] = useState(''); const [entry, setEntry] = useState(''); const [clientNotes, setClientNotes] = useState(''); const [doorCode, setDoorCode] = useState('');
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);const [exceptionDate,setExceptionDate]=useState('');const [exceptionType,setExceptionType]=useState<'closed'|'open'|''>('');const [exceptionOpens,setExceptionOpens]=useState('');const [exceptionCloses,setExceptionCloses]=useState('');const [exceptionReason,setExceptionReason]=useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const load = async () => {
    if (!client || !businessId) return;
    const { data, error: queryError } = await client.from('mova_locations').select('*').eq('artist_business_id', businessId).order('created_at');
    if (queryError) { setError(true); return; }
    const rows=(data ?? []) as Location[]; setLocations(rows);
    const detailRows=await Promise.all(rows.map(async (location)=>{
      const [hourResult,policyResult]=await Promise.all([client.from('mova_location_hours').select('weekday,opens_at,closes_at').eq('location_id',location.id),client.from('mova_location_policies').select('lead_time_minutes,booking_horizon_days,buffer_after_minutes').eq('location_id',location.id).maybeSingle()]);
      return [location.id,{hours:(hourResult.data??[]) as HoursRow[],policy:policyResult.data as Record<string,unknown>|null}] as const;
    }));
    setSummaries(Object.fromEntries(detailRows)); setError(false);
  };
  useEffect(() => { void load(); }, [client, businessId]);
  const reset = () => { setEditingId(null); setFormOpen(false); setName(''); setHours([]); setExceptions([]); setMode(''); setOwnership(''); setCollector(''); setType(''); setTimeZone(''); setDoorCode(''); setStreet('');setCity('');setState('');setPostalCode('');setParking('');setEntry('');setClientNotes('');setLead('60');setHorizon('60');setBuffer('0');setCancellationWindow('1440');setRequestExpiry('24');setExceptionDate('');setExceptionType('');setExceptionOpens('');setExceptionCloses('');setExceptionReason(''); };
  const edit = async (location: Location) => {
    if (!client) return;
    const { data: rows } = await client.from('mova_location_hours').select('weekday,opens_at,closes_at').eq('location_id', location.id);
    const { data: daysOff } = await client.from('mova_location_exceptions').select('exception_date,is_closed,hours,reason').eq('location_id',location.id);
    const { data: policy } = await client.from('mova_location_policies').select('*').eq('location_id', location.id).maybeSingle();
    setEditingId(location.id); setFormOpen(true); setName(location.name); setType(location.location_type as (typeof types)[number]); setMode(location.booking_mode as 'instant'|'request'); setOwnership(location.calendar_ownership as 'mova'|'external'); setCollector(location.payment_collector as 'artist'|'salon'); setTimeZone(location.time_zone); setHours((rows ?? []) as HoursRow[]);
    setLead(String(policy?.lead_time_minutes ?? 60)); setHorizon(String(policy?.booking_horizon_days ?? 60)); setBuffer(String(policy?.buffer_after_minutes ?? 0)); setCancellationWindow(String(policy?.cancellation_window_minutes ?? 1440)); setRequestExpiry(String(policy?.request_expiry_hours ?? 24));
    setExceptions((daysOff??[]).map((item)=>({exception_date:item.exception_date,is_closed:item.is_closed,opens_at:item.hours?.[0]?.opens_at??'09:00',closes_at:item.hours?.[0]?.closes_at??'17:00',reason:item.reason??''})));
    setStreet(location.address?.street??'');setCity(location.address?.city??'');setState(location.address?.state??'');setPostalCode(location.address?.postal_code??'');setParking(policy?.client_details?.parking??'');setEntry(policy?.client_details?.entry??'');setClientNotes(policy?.client_details?.notes??'');setDoorCode('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!client || !businessId) return;
    if(!type||!mode||!ownership||!collector||!timeZone||hours.some((row)=>!row.opens_at||!row.closes_at||row.opens_at===row.closes_at)){setError(true);return;}
    setBusy(true); setError(false);
    const { data: { session } } = await client.auth.getSession();
    const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/location-save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, 'x-mova-artist-business-id': businessId }, body: JSON.stringify({
      artist_business_id: businessId,
      location_id: editingId, name, location_type: type, booking_mode: mode, calendar_ownership: ownership, payment_collector: collector, time_zone: timeZone,
      address: { street, city, state, postal_code: postalCode }, display_color_index: locations.length % 12,
      hours: hours.map((row) => ({ weekday: row.weekday, opens_at: row.opens_at, closes_at: row.closes_at })),
      exceptions: exceptions.map((item)=>({exception_date:item.exception_date,is_closed:item.is_closed,hours:item.is_closed?[]:[{opens_at:item.opens_at,closes_at:item.closes_at}],reason:item.reason})),
      policies: { lead_time_minutes: Number(lead), booking_horizon_days: Number(horizon), buffer_after_minutes: Number(buffer), cancellation_window_minutes: Number(cancellationWindow), request_expiry_hours: Number(requestExpiry) },
      client_details: { parking, entry, notes: clientNotes }, door_code: doorCode,
    }) });
    setBusy(false); if (!response.ok) { setError(true); return; } reset(); await load();
  };
  if (identityLoading) return <main className="mova-page"><p role="status">{t('locations.loading')}</p></main>;
  if (!businessId) return <main className="mova-page"><ErrorState title={t('locations.identityError')} retryLabel={t('locations.retry')} onRetry={() => window.location.reload()} /></main>;
  return <main className="mova-page mova-location-settings">
    <ScreenHeader onBack={()=>navigate(operatorUrl(businessId,'settings'))} trailing={<IconButton label={t('locations.add')} icon="plus" onClick={()=>navigate(operatorUrl(businessId,'settings/locations/new'))} />} />
    <h1>{t('locations.title')}</h1>
    {error && <ErrorState title={t('locations.error')} retryLabel={t('locations.retry')} onRetry={() => void load()} />}
    {locations.length === 0 && !formOpen && <EmptyState title={t('locations.empty')} action={<Button onClick={()=>navigate(operatorUrl(businessId,'settings/locations/new'))}>{t('locations.add')}</Button>} />}
    <div className="mova-location-list">{locations.map((location, index) => {
      const summary = summaries[location.id];
      const schedule = groupHours(summary?.hours ?? [], (weekday) => t(`locations.weekdaysShort.${weekday}`));
      const color = location.display_color_index % 2 === 0 ? 'one' : 'two';
      return <Card className={`mova-location-card${index === 0 ? ' is-featured' : ''}`} key={location.id}>
        <header className="mova-location-card__heading"><span className={`mova-location-card__dot mova-location-card__dot--${color}`} aria-hidden="true"/><h2>{location.name}</h2><span className={`mova-location-card__status${location.is_active ? '' : ' is-off'}`}>{t(location.is_active ? 'screens.locations.bookingOn' : 'locations.inactive')}</span></header>
        <p className="mova-location-card__type">{t(`locations.types.${location.location_type}`)} · {location.time_zone}</p>
        <div className="mova-location-card__chips"><span className={location.booking_mode === 'request' ? 'is-request' : ''}>{t(`locations.cardMode.${location.booking_mode}`)}</span><span>{t(`locations.cardCollector.${location.payment_collector}`)}</span></div>
        <div className="mova-location-card__hours">{schedule.map((row) => <p key={`${row.opens_at}-${row.closes_at}`}><span>{row.label}</span><strong>{clockLabel(row.opens_at)} – {clockLabel(row.closes_at)}</strong></p>)}</div>
        {summary?.policy && <dl className="mova-location-card__rules"><div><dt>{t('screens.locations.buffer')}</dt><dd>{t('scheduling.minutesShort', { count: Number(summary.policy.buffer_after_minutes ?? 0) })}</dd></div><div><dt>{t('screens.locations.notice')}</dt><dd>{t('scheduling.hoursShort', { count: Math.round(Number(summary.policy.lead_time_minutes ?? 0) / 60) })}</dd></div><div><dt>{t('screens.locations.bookAhead')}</dt><dd>{t('scheduling.weeksShort', { count: Math.round(Number(summary.policy.booking_horizon_days ?? 0) / 7) })}</dd></div></dl>}
        <Button type="button" variant="secondary" onClick={() => void edit(location)}>{t('screens.locations.editHours')}</Button>
      </Card>;
    })}</div>
    {formOpen && <Card className="mova-location-form"><form onSubmit={(event) => void save(event)}>
      <h2>{editingId ? t('locations.edit') : t('locations.add')}</h2>
      <TextField label={t('locations.name')} value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
      <label className="mova-field"><span>{t('locations.type')}</span><select required value={type} onChange={(event) => setType(event.target.value as (typeof types)[number]|'')}><option value="">{t('locations.chooseType')}</option>{types.map((value) => <option key={value} value={value}>{t(`locations.types.${value}`)}</option>)}</select></label>
      <label className="mova-field"><span>{t('locations.timeZone')}</span><select required value={timeZone} onChange={(event) => setTimeZone(event.target.value)}><option value="">{t('locations.chooseTimeZone')}</option>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
      <TextField label={t('locations.street')} autoComplete="street-address" value={street} onChange={(event)=>setStreet(event.target.value)} />
      <div className="mova-form-grid"><TextField label={t('locations.city')} autoComplete="address-level2" value={city} onChange={(event)=>setCity(event.target.value)} /><TextField label={t('locations.state')} autoComplete="address-level1" value={state} onChange={(event)=>setState(event.target.value)} /><TextField label={t('locations.postalCode')} autoComplete="postal-code" value={postalCode} onChange={(event)=>setPostalCode(event.target.value)} /></div>
      {(['bookingMode','calendarOwnership','paymentCollector'] as const).map((key) => <fieldset className="mova-choice-fieldset" key={key}><legend>{t(`locations.${key}`)}</legend>{(key === 'bookingMode' ? ['instant','request'] : key === 'calendarOwnership' ? ['mova','external'] : ['artist','salon']).map((value) => <label key={value}><input type="radio" name={key} checked={(key === 'bookingMode' ? mode : key === 'calendarOwnership' ? ownership : collector) === value} onChange={() => key === 'bookingMode' ? setMode(value as 'instant'|'request') : key === 'calendarOwnership' ? setOwnership(value as 'mova'|'external') : setCollector(value as 'artist'|'salon')} />{t(`locations.${key}Values.${value}`)}</label>)}</fieldset>)}
      <fieldset className="mova-choice-fieldset"><legend>{t('locations.hours')}</legend>{Array.from({ length: 7 }, (_, weekday) => { const row = hours.find((entry) => entry.weekday === weekday); return <div className="mova-hours-row" key={weekday}><label><input type="checkbox" checked={Boolean(row)} onChange={(event) => setHours((current) => event.target.checked ? [...current, { weekday, opens_at: '', closes_at: '' }] : current.filter((entry) => entry.weekday !== weekday))} />{t(`locations.weekdays.${weekday}`)}</label>{row && <><input aria-label={t('locations.opensAt', { day: t(`locations.weekdays.${weekday}`) })} type="time" value={row.opens_at.slice(0,5)} onChange={(event) => setHours((current) => current.map((entry) => entry.weekday === weekday ? { ...entry, opens_at: event.target.value } : entry))} /><input aria-label={t('locations.closesAt', { day: t(`locations.weekdays.${weekday}`) })} type="time" value={row.closes_at.slice(0,5)} onChange={(event) => setHours((current) => current.map((entry) => entry.weekday === weekday ? { ...entry, closes_at: event.target.value } : entry))} /></>}</div>; })}</fieldset>
      <fieldset className="mova-choice-fieldset"><legend>{t('locations.exceptions')}</legend><div className="mova-form-grid"><TextField label={t('locations.exceptionDate')} type="date" value={exceptionDate} onChange={(event)=>setExceptionDate(event.target.value)} /><label className="mova-field"><span>{t('locations.exceptionType')}</span><select value={exceptionType} onChange={(event)=>setExceptionType(event.target.value as 'closed'|'open'|'')}><option value="">{t('locations.chooseExceptionType')}</option><option value="closed">{t('locations.closedDate')}</option><option value="open">{t('locations.openDate')}</option></select></label>{exceptionType==='open'&&<><TextField label={t('locations.opensAt',{day:t('locations.exceptionDay')})} type="time" value={exceptionOpens} onChange={(event)=>setExceptionOpens(event.target.value)} /><TextField label={t('locations.closesAt',{day:t('locations.exceptionDay')})} type="time" value={exceptionCloses} onChange={(event)=>setExceptionCloses(event.target.value)} /></>}<TextField label={t('locations.reason')} value={exceptionReason} onChange={(event)=>setExceptionReason(event.target.value)} /></div><Button type="button" variant="secondary" disabled={!exceptionDate||!exceptionType||(exceptionType==='open'&&(!exceptionOpens||!exceptionCloses||exceptionOpens===exceptionCloses))||exceptions.some((item)=>item.exception_date===exceptionDate)} onClick={()=>{setExceptions((current)=>[...current,{exception_date:exceptionDate,is_closed:exceptionType==='closed',opens_at:exceptionOpens,closes_at:exceptionCloses,reason:exceptionReason}].sort((a,b)=>a.exception_date.localeCompare(b.exception_date)));setExceptionDate('');setExceptionType('');setExceptionOpens('');setExceptionCloses('');setExceptionReason('');}}>{t('locations.addException')}</Button>{exceptions.map((item)=><div className="mova-hours-row" key={item.exception_date}><span>{item.exception_date}: {item.is_closed?t('locations.closedDate'):`${item.opens_at}–${item.closes_at}`}</span><Button type="button" variant="secondary" onClick={()=>setExceptions((current)=>current.filter((entry)=>entry.exception_date!==item.exception_date))}>{t('locations.removeException')}</Button></div>)}</fieldset>
      <div className="mova-form-grid"><TextField label={t('locations.leadMinutes')} type="number" min="0" value={lead} onChange={(event) => setLead(event.target.value)} /><TextField label={t('locations.horizonDays')} type="number" min="1" value={horizon} onChange={(event) => setHorizon(event.target.value)} /><TextField label={t('locations.bufferMinutes')} type="number" min="0" value={buffer} onChange={(event) => setBuffer(event.target.value)} /><TextField label={t('locations.cancellationWindow')} type="number" min="0" value={cancellationWindow} onChange={(event) => setCancellationWindow(event.target.value)} /><TextField label={t('locations.requestExpiry')} type="number" min="1" max="168" value={requestExpiry} onChange={(event) => setRequestExpiry(event.target.value)} /></div>
      <TextField label={t('locations.parking')} value={parking} onChange={(event)=>setParking(event.target.value)} />
      <TextField label={t('locations.entry')} value={entry} onChange={(event)=>setEntry(event.target.value)} />
      <TextField label={t('locations.clientNotes')} value={clientNotes} onChange={(event)=>setClientNotes(event.target.value)} />
      <TextField label={t('locations.doorCode')} hint={t('locations.doorCodePrivacy')} autoComplete="off" value={doorCode} onChange={(event)=>setDoorCode(event.target.value)} />
      <div className="mova-actions"><Button loading={busy} type="submit">{t('locations.save')}</Button>{editingId && <Button type="button" variant="secondary" onClick={reset}>{t('locations.cancel')}</Button>}</div>
    </form></Card>}
  </main>;
}
