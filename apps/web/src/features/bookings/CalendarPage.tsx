import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { DayStrip, EmptyState, ErrorState, HonestyBanner, IconButton } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { displayId } from '../../lib/display-ids';
import { BLOCK_REASONS } from '../scheduling/rules';

type Location = { id: string; name: string; time_zone: string; booking_mode: string; calendar_ownership: string; payment_collector: string; display_color_index: number };
type Appointment = { id: string; appointment_number:number; location_id: string; service_name_snapshot: string; service_names?:string[]; client_name: string; status: string; starts_at: string; ends_at: string };
type AvailabilityBlock = { id: string; location_id: string; reason: string; label: string; starts_at: string; ends_at: string };
const CALENDAR_HOUR_HEIGHT = 72;

function dateKey(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function isDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
}

function addDays(key: string, amount: number) {
  const value = new Date(`${key}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return dateKey(value);
}

function colorClass(index: number) {
  return `mova-calendar__location-chip--${index % 2 === 0 ? 'one' : 'two'}`;
}

function blockPosition(startValue: string, endValue: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(startValue));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 9);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const duration = Math.max(15, (new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000);
  return { top: Math.max(0, (hour - 9 + minute / 60) * CALENDAR_HOUR_HEIGHT), height: Math.max(24, duration / 60 * CALENDAR_HOUR_HEIGHT) };
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [locations, setLocations] = useState<Location[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const requestedDay = searchParams.get('day');
  const day = isDateKey(requestedDay) ? requestedDay : dateKey(new Date());
  const selectDay = useCallback((value: string) => setSearchParams({ day: value }), [setSearchParams]);
  const [locationId, setLocationId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) { setLoading(false); return; }
    setLoading(true);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 90);
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 90);
    const [locationRows, appointmentRows, blockRows] = await Promise.all([
      client.from('mova_locations').select('id,name,time_zone,booking_mode,calendar_ownership,payment_collector,display_color_index')
        .eq('artist_business_id', businessId).eq('is_active', true).order('display_color_index').order('name'),
      client.from('mova_appointments').select('id,appointment_number,location_id,service_name_snapshot,client_name,status,starts_at,ends_at')
        .eq('artist_business_id', businessId).gte('starts_at', start.toISOString()).lt('starts_at', to.toISOString())
        .in('status', ['pending_artist', 'pending_payment', 'confirmed', 'completed']).order('starts_at').limit(300),
      client.from('mova_availability_blocks').select('id,location_id,reason,label,starts_at,ends_at')
        .eq('artist_business_id', businessId).gte('starts_at', start.toISOString()).lt('starts_at', to.toISOString()).order('starts_at').limit(300),
    ]);
    if (locationRows.error || appointmentRows.error || blockRows.error) {
      setError(true);
      setLoading(false);
      return;
    }
    const appointmentIds=(appointmentRows.data??[]).map(item=>item.id);
    const {data:serviceRows,error:serviceError}=appointmentIds.length?await client.from('mova_appointment_services').select('appointment_id,position,service_name_snapshot').eq('artist_business_id',businessId).in('appointment_id',appointmentIds).order('position'):{data:[],error:null};
    if(serviceError){setError(true);setLoading(false);return;}
    const namesByAppointment=new Map<string,string[]>();for(const item of serviceRows??[])namesByAppointment.set(item.appointment_id,[...(namesByAppointment.get(item.appointment_id)??[]),item.service_name_snapshot]);
    setLocations((locationRows.data ?? []) as Location[]);
    setAppointments((appointmentRows.data ?? []).map(item=>({...item,service_names:namesByAppointment.get(item.id)??[item.service_name_snapshot]})) as Appointment[]);
    setBlocks((blockRows.data ?? []) as AvailabilityBlock[]);
    setError(false);
    setLoading(false);
  }, [businessId, client]);

  useEffect(() => { void load(); }, [load]);

  const locationIndexById = useMemo(() => new Map(locations.map((location, index) => [location.id, index])), [locations]);
  const visibleLocations = locations.filter((location) => locationId === 'all' || location.id === locationId);
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const visibleAppointments = useMemo(() => appointments.filter((item) => {
    const location = locationById.get(item.location_id);
    return (locationId === 'all' || locationId === item.location_id) && dateKey(new Date(item.starts_at), location?.time_zone) === day;
  }), [appointments, locationById, locationId, day]);
  const visibleBlocks = useMemo(() => blocks.filter((item) => {
    const location = locationById.get(item.location_id);
    return (locationId === 'all' || locationId === item.location_id) && dateKey(new Date(item.starts_at), location?.time_zone) === day;
  }), [blocks, locationById, locationId, day]);
  const selectedDate = new Date(`${day}T12:00:00`);
  const weekStart = new Date(selectedDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'long' }).format(selectedDate);
  const externalLocation = visibleLocations.find((location) => location.calendar_ownership === 'external');
  const hasCalendarItemsOn = (key: string) => [...appointments, ...blocks].some((item) => {
    const location = locationById.get(item.location_id);
    return (locationId === 'all' || locationId === item.location_id) && dateKey(new Date(item.starts_at), location?.time_zone) === key;
  });
  const days = Array.from({ length: 7 }, (_, index) => {
    const value = new Date(weekStart);
    value.setDate(value.getDate() + index);
    const key = dateKey(value);
    return {
      id: key,
      weekday: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short' }).format(value),
      date: String(value.getDate()),
      indicator: key !== day && hasCalendarItemsOn(key),
    };
  });

  if (identityLoading || loading) return <main className="mova-page mova-calendar" aria-busy="true"><p role="status">{t('calendar.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-calendar"><ErrorState title={t('calendar.identityError')} retryLabel={t('calendar.retry')} onRetry={() => window.location.reload()} /></main>;

  const blockReasonLabel = (reason: string) => (BLOCK_REASONS as readonly string[]).includes(reason) ? t(`scheduling.blockReasons.${reason}`) : t('scheduling.blockReasons.other');
  const hourLabels = Array.from({ length: 9 }, (_, index) => index + 9);
  const timeLabel = (hour: number) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: 'numeric' }).formatToParts(new Date(2000, 0, 1, hour))
    .filter((part) => hour === 9 || hour === 12 || part.type !== 'dayPeriod')
    .map((part) => part.value).join('').trim();
  const hasItems = visibleAppointments.length > 0 || visibleBlocks.length > 0;

  return <main className="mova-page mova-calendar">
    <header className="mova-calendar__header">
      <div className="mova-calendar__month-header">
        <h1>{monthLabel}</h1>
        <div className="mova-calendar__month-actions">
          <IconButton label={t('calendar.previousWeek')} icon="back" onClick={() => selectDay(addDays(day, -7))} />
          <IconButton label={t('calendar.nextWeek')} icon="chevron" onClick={() => selectDay(addDays(day, 7))} />
        </div>
      </div>

      <DayStrip variant="calendar" label={t('calendar.days')} days={days} selected={day} onSelect={selectDay} />

      <div className="mova-calendar__filters" role="group" aria-label={t('calendar.locationFilter')}>
        <button className={`mova-chip${locationId === 'all' ? ' is-selected' : ''}`} type="button" aria-pressed={locationId === 'all'} onClick={() => setLocationId('all')}>{t('calendar.allLocations')}</button>
        {locations.map((location) => <button key={location.id} className={`mova-chip${locationId === location.id ? ' is-selected' : ''}`} type="button" aria-pressed={locationId === location.id} onClick={() => setLocationId(location.id)}>
          <span className={`mova-calendar__location-dot ${colorClass(locationIndexById.get(location.id) ?? 0)}`} aria-hidden="true" />{location.name}
        </button>)}
      </div>
    </header>

    {error && <ErrorState title={t('calendar.loadError')} retryLabel={t('calendar.retry')} onRetry={() => void load()} />}
    <HonestyBanner tone="soft">{externalLocation ? t('calendar.externalCalendarNote', { location: externalLocation.name }) : t('calendar.externalCalendarGenericNote')}</HonestyBanner>

    <div className="mova-calendar__timeline" role="group" aria-label={t('calendar.scheduleFor', { day: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'long', month: 'long', day: 'numeric' }).format(selectedDate) })} style={{ '--calendar-hour-height': `${CALENDAR_HOUR_HEIGHT}px` } as CSSProperties}>
      {hourLabels.map((hour, index) => <div className="mova-calendar__hour" key={hour} style={{ top: `${index * CALENDAR_HOUR_HEIGHT}px` }}><time>{timeLabel(hour)}</time></div>)}
      {visibleAppointments.map((item) => {
        const location = locationById.get(item.location_id);
        const zone = location?.time_zone ?? 'UTC';
        const position = blockPosition(item.starts_at, item.ends_at, zone);
        const compact = position.height < 56;
        const visibleHeight = Math.max(position.height, 28);
        const color = colorClass(locationIndexById.get(item.location_id) ?? 0);
        const startTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(item.starts_at));
        const endTime = new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(item.ends_at));
        const status = t(`booking.status.${item.status}`);
        return <Link key={item.id} className={`mova-calendar__event ${color}${compact ? ' mova-calendar__event--compact' : ''}`} aria-label={`${item.service_names?.join(' + ')||item.service_name_snapshot}, ${item.client_name}, ${startTime}–${endTime}, ${location?.name ?? ''}, ${status}`} style={{ top: `${position.top}px`, height: `${visibleHeight}px` }} to={operatorUrl(businessId, `appointments/${displayId('AID',item.appointment_number)}`)}>
          <strong>{item.service_names?.join(' + ')||item.service_name_snapshot} · {item.client_name}</strong>
          <span>{compact ? startTime : `${startTime} – ${endTime}${location ? ` · ${location.name}` : ''}`}</span>
        </Link>;
      })}
      {visibleBlocks.map((block) => {
        const zone = locationById.get(block.location_id)?.time_zone ?? 'UTC';
        const position = blockPosition(block.starts_at, block.ends_at, zone);
        return <div key={block.id} className="mova-calendar__block" style={{ top: `${position.top}px`, height: `${position.height}px` }}>
          <span>{t('scheduling.blockedLabel', { label: block.label || blockReasonLabel(block.reason) })}</span>
        </div>;
      })}
    </div>

    {!error && !hasItems && <EmptyState title={t('calendar.empty')} />}
    <IconButton className="mova-calendar__fab" label={t('calendar.newAppointment')} icon="plus" onClick={() => navigate(operatorUrl(businessId, 'calendar/add'))} />
  </main>;
}

export default CalendarPage;
