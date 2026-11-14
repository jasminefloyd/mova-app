import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, IconButton, ScreenHeader } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { useNavigate } from 'react-router';
import { operatorUrl } from '../../app/operator-url';

type Location = { id: string; name: string; location_type: string; booking_mode: string; payment_collector: string; time_zone: string; display_color_index: number; is_active: boolean };
type HoursRow = { weekday: number; opens_at: string; closes_at: string };

function zoneLabel(timeZone: string, locale: string) {
  try { return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? timeZone; }
  catch { return timeZone; }
}
const clockLabel = (value: string, locale: string) => {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute));
};

export function LocationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [locations, setLocations] = useState<Location[]>([]);
  const [hours, setHours] = useState<Record<string, HoursRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    if (!client || !businessId) return;
    setLoading(true); setError(false);
    const { data, error: queryError } = await client.from('mova_locations')
      .select('id,name,location_type,booking_mode,payment_collector,time_zone,display_color_index,is_active')
      .eq('artist_business_id', businessId).order('created_at');
    if (queryError) { setError(true); setLoading(false); return; }
    const rows = (data ?? []) as Location[];
    const hourResults = await Promise.all(rows.map(async (location) => {
      const result = await client.from('mova_location_hours').select('weekday,opens_at,closes_at').eq('location_id', location.id).eq('artist_business_id', businessId);
      if (result.error) throw result.error;
      return [location.id, (result.data ?? []) as HoursRow[]] as const;
    })).catch(() => null);
    if (!hourResults) { setError(true); setLoading(false); return; }
    setLocations(rows);
    setHours(Object.fromEntries(hourResults));
    setExpandedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [client, businessId]);
  const openLocation = (id?: string) => {
    const base = 'settings/locations/new';
    const query = id ? `?location_id=${encodeURIComponent(id)}` : '';
    navigate(operatorUrl(businessId, `${base}${query}`));
  };

  if (identityLoading || loading) return <main className="mova-page"><p role="status" aria-busy="true">{t('locations.loading')}</p></main>;
  if (!businessId) return <main className="mova-page"><ErrorState title={t('locations.identityError')} retryLabel={t('locations.retry')} onRetry={() => window.location.reload()} /></main>;
  return <main className="mova-page mova-location-settings">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings'))} trailing={<IconButton label={t('locations.add')} icon="plus" onClick={() => openLocation()} />} />
    <h1>{t('locations.title')}</h1>
    {error && <ErrorState title={t('locations.error')} retryLabel={t('locations.retry')} onRetry={() => void load()} />}
    {!error && locations.length === 0 && <EmptyState title={t('locations.empty')} action={<Button onClick={() => openLocation()}>{t('locations.add')}</Button>} />}
    <div className="mova-location-list">{locations.map((location) => {
      const days = [...(hours[location.id] ?? [])].sort((a, b) => a.weekday - b.weekday);
      const color = location.display_color_index % 2 === 0 ? 'one' : 'two';
      const expanded = expandedId === location.id;
      return <Card className={`mova-location-card${expanded ? ' is-featured' : ''}`} key={location.id}>
        <header className="mova-location-card__heading"><span className={`mova-location-card__dot mova-location-card__dot--${color}`} aria-hidden="true"/><h2><button type="button" className="mova-location-card__toggle" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : location.id)}>{location.name}</button></h2><span className={`mova-location-card__status${location.is_active ? '' : ' is-off'}`}>{t(location.is_active ? 'screens.locations.bookingOn' : 'locations.inactive')}</span></header>
        <p className="mova-location-card__type">{t(`locations.types.${location.location_type}`)} · {zoneLabel(location.time_zone, i18n.language)}</p>
        <div className="mova-location-card__chips"><span className={location.booking_mode === 'request' ? 'is-request' : ''}>{t(`locations.cardMode.${location.booking_mode}`)}</span><span>{t(`locations.cardCollector.${location.payment_collector}`)}</span></div>
        {expanded && <>
          <div className="mova-location-card__hours">{days.map((row) => <p key={row.weekday}><span>{t(`locations.weekdaysShort.${row.weekday}`)}</span><strong>{clockLabel(row.opens_at, i18n.language)} – {clockLabel(row.closes_at, i18n.language)}</strong></p>)}</div>
          <Button type="button" variant="secondary" onClick={() => openLocation(location.id)}>{t('screens.locations.editHours')}</Button>
        </>}
      </Card>;
    })}</div>
  </main>;
}

export default LocationsPage;
