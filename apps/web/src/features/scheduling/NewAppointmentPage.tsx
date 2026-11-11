import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, RadioCard, ScreenHeader } from '../../components';
import { displayId } from '../../lib/display-ids';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { callFunction, errorCode, loadBookingOptions, loadBusy, type BusyRow, type ClientRow, type LocationRow, type ServiceRow, type ServiceLocationRow, type MovaClient } from './api';
import { addDays, overlaps, validateNewAppointment, zonedWallClockToUtc, type AppointmentDraft, type AppointmentField } from './rules';
import './scheduling.css';

const KNOWN_ERRORS = new Set(['SLOT_TAKEN', 'SLOT_IN_PAST', 'SLOT_OUTSIDE_LOCATION_HOURS', 'SERVICE_NOT_OFFERED_AT_LOCATION', 'CLIENT_NOT_FOUND', 'SERVICE_NOT_FOUND', 'LOCATION_NOT_FOUND']);

// Board 08c: New appointment. Books a known client into a free time. Deposit and confirmation-text
// toggles from the board are not built yet (see the phase report); the booking is confirmed, deposit-free.
export function NewAppointmentPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const requestedDay = params.get('day');
  const todayKey = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : new Date().toLocaleDateString('en-CA');
  const [choosingClient, setChoosingClient] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [links, setLinks] = useState<ServiceLocationRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<AppointmentDraft>({ clientId: params.get('client') ?? '', serviceId: '', locationId: '', date: todayKey, start: '10:00' });
  const [busyRows, setBusyRows] = useState<BusyRow[]>([]);
  const [errors, setErrors] = useState<Partial<Record<AppointmentField, true>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const idempotency = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!client || !businessId) return;
    let active = true;
    void (async () => {
      try {
        const [options, clientResult] = await Promise.all([
          loadBookingOptions(client, businessId),
          callFunction<ClientRow[]>(client, businessId, 'client-crud', { action: 'list' }),
        ]);
        if (!active) return;
        setLocations(options.locations); setServices(options.services); setLinks(options.links); setClients(Array.isArray(clientResult) ? clientResult : []);
        setDraft((current) => ({ ...current, locationId: current.locationId || options.locations[0]?.id || '' }));
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => { active = false; };
  }, [client, businessId]);

  const location = locations.find((row) => row.id === draft.locationId);
  const zone = location?.time_zone ?? 'UTC';
  const offered = useMemo(() => services.flatMap((service) => {
    if (!draft.locationId) return [{ ...service, price: service.base_price_minor, duration: service.duration_minutes }];
    const link = links.find((row) => row.service_id === service.id && row.location_id === draft.locationId);
    if (!link) return [];
    return [{ ...service, price: link.price_minor_override ?? service.base_price_minor, duration: link.duration_minutes_override ?? service.duration_minutes }];
  }), [services, links, draft.locationId]);
  const service = offered.find((row) => row.id === draft.serviceId);
  const selectedClient = clients.find((row) => row.id === draft.clientId);

  // Free-time line from board 08c: checks appointments and blocks at the chosen location.
  useEffect(() => {
    if (!client || !businessId || !draft.locationId || !DATE_KEY.test(draft.date)) { setBusyRows([]); return; }
    const from = zonedWallClockToUtc(addDays(draft.date, -1), '00:00', zone);
    const to = zonedWallClockToUtc(addDays(draft.date, 2), '00:00', zone);
    let active = true;
    void loadBusy(client, businessId, [draft.locationId], from, to).then((rows) => { if (active) setBusyRows(rows); }).catch(() => { if (active) setBusyRows([]); });
    return () => { active = false; };
  }, [client, businessId, draft.locationId, draft.date, zone]);

  const slot = service && DATE_KEY.test(draft.date) && TIME_KEY.test(draft.start)
    ? (() => {
      const startsAt = zonedWallClockToUtc(draft.date, draft.start, zone);
      const endsAt = new Date(Date.parse(startsAt) + service.duration * 60_000).toISOString();
      return { startsAt, endsAt };
    })()
    : null;
  const free = slot ? !busyRows.some((row) => overlaps({ startsAt: row.starts_at, endsAt: row.ends_at }, slot)) : null;
  const when = slot ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(slot.startsAt))
    + ' · ' + new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).formatRange(new Date(slot.startsAt), new Date(slot.endsAt)) : '';

  const update = <K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !businessId) return;
    const found = validateNewAppointment(draft);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length > 0 || !slot) return;
    setSaving(true);
    try {
      const result = await callFunction<{ appointment_id: string }>(client, businessId, 'artist-appointment-create', {
        client_id: draft.clientId, location_id: draft.locationId, service_id: draft.serviceId, starts_at: slot.startsAt,
      }, { 'Idempotency-Key': idempotency.current });
      const number = await appointmentNumber(client, result.appointment_id);
      navigate(operatorUrl(businessId, number ? `appointments/${displayId('AID', number)}` : 'calendar'));
    } catch (error) {
      const code = errorCode(error);
      setSaveError(KNOWN_ERRORS.has(code) ? code : 'GENERIC');
    } finally {
      setSaving(false);
    }
  };

  if (identityLoading) return <main className="mova-page mova-scheduling"><p role="status">{t('scheduling.appt.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.identityError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;
  if (loadError) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.appt.loadError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;

  const error = (key: AppointmentField) => errors[key] ? t(`scheduling.appt.error.${key}`) : '';
  const closeTo = `${operatorUrl(businessId, 'calendar')}${draft.date ? `?day=${encodeURIComponent(draft.date)}` : ''}`;

  return <main className="mova-page mova-scheduling mova-scheduling--screen mova-scheduling--appointment">
    <ScreenHeader title={t('scheduling.appt.title')} titleAsHeading onBack={() => navigate(closeTo)} backLabel={t('scheduling.appt.close')} leadingIcon="close" />
    <form className="mova-scheduling__form mova-scheduling__form--appointment" onSubmit={(event) => void submit(event)} noValidate>
      <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.client')}</span>
        {selectedClient && !choosingClient ? <span className="mova-scheduling__selected-client">
          <span className="mova-scheduling__client-avatar" aria-hidden="true">{selectedClient.display_name.split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</span>
          <span className="mova-scheduling__selected-client-copy"><strong>{selectedClient.display_name}</strong><small>{selectedClient.phone || selectedClient.email || t('scheduling.appt.clientOnList')}</small></span>
          <button type="button" className="mova-button mova-button--secondary" onClick={()=>setChoosingClient(true)}>{t('scheduling.appt.changeClient')}</button>
        </span> : <select className="mova-input" value={draft.clientId} aria-invalid={Boolean(errors.client)} onChange={(event) => { update('clientId', event.target.value); setChoosingClient(false); }}>
          <option value="">{t('scheduling.appt.chooseClient')}</option>
          {clients.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}
        </select>}
        {error('client') && <span className="mova-field__error" role="alert">{error('client')}</span>}
      </label>
      <Link className="mova-scheduling__inline-link" to={`${operatorUrl(businessId, 'clients/new')}?return=calendar&day=${encodeURIComponent(draft.date)}`}>{t('scheduling.appt.newClientInstead')}</Link>

      <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.service')}</span>
        <select className="mova-input" value={draft.serviceId} aria-invalid={Boolean(errors.service)} onChange={(event) => update('serviceId', event.target.value)}>
          <option value="">{t('scheduling.appt.chooseService')}</option>
          {offered.map((row) => <option key={row.id} value={row.id}>{t('scheduling.appt.serviceOption', { name: row.name, duration: t('scheduling.minutesShort', { count: row.duration }), price: new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(row.price / 100) })}</option>)}
        </select>
        {error('service') && <span className="mova-field__error" role="alert">{error('service')}</span>}
        {draft.locationId && offered.length === 0 && <span className="mova-field__hint">{t('scheduling.appt.noServices')}</span>}
      </label>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.appt.location')}</legend>
        <div className="mova-scheduling__pair">
          {locations.map((row) => <RadioCard key={row.id} name="loc" value={row.id} label={row.name} checked={draft.locationId === row.id} onChange={(value) => { update('locationId', value); update('serviceId', ''); }} />)}
        </div>
        {locations.length === 0 && <p className="mova-field__hint">{t('scheduling.appt.noLocations')}</p>}
      </fieldset>

      <div className="mova-form-grid mova-scheduling__date-time">
        <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.date')}</span>
          <input className="mova-input" type="date" value={draft.date} aria-invalid={Boolean(errors.date)} onChange={(event) => update('date', event.target.value)} />
          {error('date') && <span className="mova-field__error" role="alert">{error('date')}</span>}
        </label>
        <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.start')}</span>
          <input className="mova-input" type="time" value={draft.start} aria-invalid={Boolean(errors.start)} onChange={(event) => update('start', event.target.value)} />
          {error('start') && <span className="mova-field__error" role="alert">{error('start')}</span>}
        </label>
      </div>

      <p className="mova-scheduling__free" role="status" aria-live="polite">
        {free === null ? t('scheduling.appt.pickFirst') : free ? t('scheduling.appt.free', { when }) : t('scheduling.appt.busy', { when })}
      </p>

      {saveError && <p className="mova-field__error" role="alert">{t(`scheduling.appt.saveError.${KNOWN_ERRORS.has(saveError) ? saveError : 'GENERIC'}`)}</p>}
      <div className="mova-actions">
        <Button type="submit" loading={saving} disabled={free === false}>{t('scheduling.appt.book')}</Button>
      </div>
    </form>
  </main>;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

async function appointmentNumber(client: MovaClient, id: string): Promise<number | null> {
  const { data } = await client.from('mova_appointments').select('appointment_number').eq('id', id).maybeSingle();
  return data?.appointment_number ?? null;
}

export default NewAppointmentPage;
