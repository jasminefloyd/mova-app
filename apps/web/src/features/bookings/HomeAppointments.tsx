import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar, Card, EmptyState, ErrorState, Icon, KPITile, SectionOverline, StatusChip } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { displayId } from '../../lib/display-ids';

type Booking = { id: string; appointment_number:number; location_id: string; service_name_snapshot: string; client_name: string; status: string; starts_at: string; ends_at: string; request_expires_at: string | null };
type Location = { id: string; name: string; time_zone: string; display_color_index: number };
type Profile = { display_name: string; handle: string; is_published: boolean };
type HomeMetrics = { revenue: string; revenueDelta: string; booked: string; rating: string; ratingCount: string };

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function greetingKey(hour: number) {
  return hour < 12 ? 'homeAppointments.goodMorning' : hour < 17 ? 'homeAppointments.goodAfternoon' : 'homeAppointments.goodEvening';
}

function shortDayLabel(date: Date, locale: string, timeZone: string) {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(date);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone }).format(date);
  return `${weekday} ${day}`;
}

export function HomeAppointments({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t, i18n } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [items, setItems] = useState<Booking[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [metrics, setMetrics] = useState<HomeMetrics>({ revenue: '—', revenueDelta: '—', booked: '—', rating: '—', ratingCount: '—' });

  const load = useCallback(async () => {
    if (!client || !businessId) { setLoading(false); return; }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 90);
    const [bookings, locationRows, profileRow] = await Promise.all([
      client.from('mova_appointments').select('id,appointment_number,location_id,service_name_snapshot,client_name,status,starts_at,ends_at,request_expires_at')
        .eq('artist_business_id', businessId).in('status', ['pending_artist', 'pending_payment', 'confirmed', 'completed'])
        .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at').limit(100),
      client.from('mova_locations').select('id,name,time_zone,display_color_index').eq('artist_business_id', businessId).eq('is_active', true).order('display_color_index'),
      client.from('mova_artist_profiles').select('display_name,handle,is_published').eq('artist_business_id', businessId).maybeSingle(),
    ]);
    if (bookings.error || locationRows.error || profileRow.error) {
      setError(true);
      setLoading(false);
      return;
    }
    setItems((bookings.data ?? []) as Booking[]);
    setLocations((locationRows.data ?? []) as Location[]);
    setProfile((profileRow.data ?? null) as Profile | null);
    setError(false);
    setLoading(false);
  }, [businessId, client]);

  useEffect(() => {
    if (identityLoading) return;
    if (!client || !businessId) { setLoading(false); return; }
    void load();
  }, [businessId, client, identityLoading, load]);

  useEffect(() => {
    let active = true;
    if (!client || !businessId) return;
    void (async () => {
      try {
        const { data: envelope, error } = await client.functions.invoke<{ data?: { current?: Record<string, number>; previous?: Record<string, number> } }>('reports-summary', { body: { range: 'week_to_date' }, headers: { 'x-mova-artist-business-id': businessId } });
        if (error || !envelope?.data?.current) return;
        const { current, previous = {} } = envelope.data;
        const booked = Number(current.offered_seconds) > 0 ? `${Math.round(Number(current.booked_seconds) / Number(current.offered_seconds) * 100)}%` : '—';
        const ratingCount = Number(current.rating_count) + Number(current.google_rating_count);
        const rating = ratingCount > 0 ? ((Number(current.rating_sum) + Number(current.google_rating_sum)) / ratingCount).toFixed(1) : '—';
        const oldRevenue = Number(previous.service_value_minor) || 0;
        const revenueDelta = oldRevenue > 0 ? `${Number(current.service_value_minor) >= oldRevenue ? '+' : ''}${Math.round((Number(current.service_value_minor) - oldRevenue) / oldRevenue * 100)}%` : (Number(current.service_value_minor) ? '+100%' : '—');
        if (active) setMetrics({ revenue: Number(current.service_value_minor) ? new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(current.service_value_minor) / 100) : '—', revenueDelta, booked, rating, ratingCount: ratingCount ? t('homeAppointments.ratingCount', { count: ratingCount }) : '—' });
      } catch { /* Reports remain available on their dedicated screen. */ }
    })();
    return () => { active = false; };
  }, [businessId, client, i18n.resolvedLanguage, t]);

  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const locationIndexById = useMemo(() => new Map(locations.map((location, index) => [location.id, index % 2])), [locations]);
  const todayKeyByZone = useMemo(() => new Map(locations.map((location) => [location.time_zone, dateKey(new Date(), location.time_zone)])), [locations]);
  const todayItems = items.filter((item) => {
    if (item.status !== 'confirmed' && item.status !== 'completed') return false;
    const zone = locationById.get(item.location_id)?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return dateKey(new Date(item.starts_at), zone) === (todayKeyByZone.get(zone) ?? dateKey(new Date(), zone));
  });
  const now = Date.now();
  const needsYou = items.filter((item) => item.status === 'pending_artist' && (!item.request_expires_at || new Date(item.request_expires_at).getTime() > now));
  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, { date: Date; locationId: string; items: Booking[] }>();
    for (const item of items) {
      if (item.status !== 'pending_artist' && item.status !== 'pending_payment' && item.status !== 'confirmed') continue;
      const zone = locationById.get(item.location_id)?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (dateKey(new Date(item.starts_at), zone) === (todayKeyByZone.get(zone) ?? dateKey(new Date(), zone))) continue;
      const key = `${zone}:${dateKey(new Date(item.starts_at), zone)}:${item.location_id}`;
      const group = groups.get(key) ?? { date: new Date(item.starts_at), locationId: item.location_id, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 3);
  }, [items, locationById, todayKeyByZone]);

  if (identityLoading || loading) return <main className="mova-page mova-home" aria-busy="true"><p role="status">{t('homeAppointments.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-home"><ErrorState title={t('homeAppointments.noIdentity')} retryLabel={t('homeAppointments.retry')} onRetry={() => window.location.reload()} /></main>;
  if (error) return <main className="mova-page mova-home"><ErrorState title={t('homeAppointments.error')} retryLabel={t('homeAppointments.retry')} onRetry={() => { setLoading(true); void load(); }} /></main>;

  const currentDate = new Date(now);
  const dateLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'long', month: 'short', day: 'numeric' }).format(currentDate);
  const name = profile?.display_name ?? '';

  return <main className="mova-page mova-home">
    <header className="mova-home__header">
      <div><p>{dateLabel}</p><h1>{t(greetingKey(currentDate.getHours()), { name })}</h1></div>
      <button type="button" className="mova-home__settings" onClick={onOpenSettings} aria-label={t('navigation.openSettings')}>
        <Avatar label={t('navigation.openSettings')} size={44} placeholder />
      </button>
    </header>

    <Link className="mova-home__metrics" to={operatorUrl(businessId, 'reports')} aria-label={t('homeAppointments.openReports')}>
      <KPITile label={t('homeAppointments.thisWeek')} value={metrics.revenue} delta={metrics.revenueDelta} tone="inverse" />
      <KPITile label={t('homeAppointments.booked')} value={metrics.booked} delta={t('homeAppointments.ofHours')} tone="inverse" />
      <KPITile label={t('homeAppointments.rating')} value={metrics.rating} delta={metrics.ratingCount} tone="inverse" />
    </Link>

    <section className="mova-home__section">
      <SectionOverline>{t('homeAppointments.needsYou', { count: needsYou.length })}</SectionOverline>
      {needsYou.length ? <Card tone="warm" className="mova-home__needs-list">{needsYou.map((item) => {
        const location = locationById.get(item.location_id);
        const requestDay = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', timeZone: location?.time_zone }).format(new Date(item.starts_at));
        const requestContext = { service: item.service_name_snapshot, day: requestDay, location: location?.name ?? '' };
        const requestDetails = item.request_expires_at
          ? t('homeAppointments.requestDetails', { ...requestContext, count: Math.max(1, Math.ceil((new Date(item.request_expires_at).getTime() - now) / 3_600_000)) })
          : t('homeAppointments.requestDetailsNoExpiry', requestContext);
        return <Link key={item.id} className="mova-home__need" to={operatorUrl(businessId, `appointments/${displayId('AID',item.appointment_number)}`)}>
          <Icon name="clock" size={20} />
          <span><strong>{t('homeAppointments.bookingRequest', { name: item.client_name })}</strong><small>{requestDetails}</small></span>
          <Icon name="chevron" size={18} />
        </Link>;
      })}</Card> : <EmptyState title={t('homeAppointments.noRequests')} />}
    </section>

    <section className="mova-home__section">
      <div className="mova-home__section-heading">
        <SectionOverline>{t('homeAppointments.todayCount', { count: todayItems.length })}</SectionOverline>
        <Link to={operatorUrl(businessId, 'calendar')}>{t('homeAppointments.calendar')}</Link>
      </div>
      {todayItems.length ? <Card className="mova-home__today-list">{todayItems.map((item) => {
        const location = locationById.get(item.location_id);
        const time = new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: 'numeric', minute: '2-digit', timeZone: location?.time_zone }).format(new Date(item.starts_at));
        const isNow = item.status === 'confirmed' && new Date(item.starts_at).getTime() <= now && new Date(item.ends_at).getTime() > now;
        return <Link className="mova-home__appointment" to={operatorUrl(businessId, `appointments/${displayId('AID',item.appointment_number)}`)} key={item.id}>
          <time>{time}</time><span className="mova-home__appointment-bar" data-location={locationIndexById.get(item.location_id) ?? 0} aria-hidden="true" />
          <span className="mova-home__appointment-copy"><strong>{item.service_name_snapshot}</strong><small>{item.client_name}{location ? ` · ${location.name}` : ''}</small></span>
          {isNow && <StatusChip status="confirmed">{t('homeAppointments.now')}</StatusChip>}
        </Link>;
      })}</Card> : <EmptyState title={t('homeAppointments.noToday')} />}
    </section>

    <section className="mova-home__section">
      <SectionOverline>{t('homeAppointments.upcoming')}</SectionOverline>
      {upcomingGroups.length ? <Card className="mova-home__coming-list">{upcomingGroups.map((group) => {
        const location = locationById.get(group.locationId);
        const zone = location?.time_zone ?? 'UTC';
        const destination = operatorUrl(businessId, 'calendar');
        const requestCount = group.items.filter((item) => item.status === 'pending_artist').length;
        return <Link className="mova-home__coming-row" to={destination} key={`${zone}:${dateKey(group.date, zone)}:${group.locationId}`}>
          <strong>{shortDayLabel(group.date, i18n.resolvedLanguage ?? 'en-US', zone)}</strong>
          <span>{t(group.items.length === 1 ? 'homeAppointments.appointmentsAtLocationOne' : 'homeAppointments.appointmentsAtLocationOther', { count: group.items.length, location: location?.name ?? '' })}</span>
          {requestCount > 0 && <StatusChip status="request">{t(requestCount === 1 ? 'homeAppointments.requestCountOne' : 'homeAppointments.requestCountOther', { count: requestCount })}</StatusChip>}
        </Link>;
      })}</Card> : <EmptyState title={t('homeAppointments.noUpcoming')} />}
    </section>
  </main>;
}
