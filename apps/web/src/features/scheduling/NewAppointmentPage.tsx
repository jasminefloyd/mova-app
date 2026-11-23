import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, Icon, ScreenHeader } from '../../components';
import { displayId } from '../../lib/display-ids';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { callFunction, errorCode, loadBookingOptions, type ClientRow, type LocationRow, type ServiceRow, type ServiceLocationRow, type MovaClient } from './api';
import { MAX_APPOINTMENT_SERVICES, validateNewAppointment, zonedWallClockToUtc, type AppointmentDraft, type AppointmentField } from './rules';
import './scheduling.css';

const KNOWN_ERRORS = new Set(['SLOT_TAKEN', 'SLOT_IN_PAST', 'SLOT_OUTSIDE_BOOKING_WINDOW', 'SLOT_OUTSIDE_LOCATION_HOURS', 'SERVICES_INVALID', 'SERVICE_NOT_OFFERED_AT_LOCATION', 'CLIENT_NOT_FOUND', 'SERVICE_NOT_FOUND', 'LOCATION_NOT_FOUND']);
type BookingRequest = { client_id: string; location_id: string; service_ids: string[]; starts_at: string };
type SlotCheck = { ends_at: string; available: boolean };

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
  const [draft, setDraft] = useState<AppointmentDraft>({ clientId: params.get('client') ?? '', serviceIds: [], locationId: '', date: todayKey, start: '10:00' });
  const [check, setCheck] = useState<{ request: BookingRequest; result?: SlotCheck; error?: string } | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<AppointmentField, true>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const idempotency = useRef<{ request: BookingRequest; key: string } | null>(null);

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
  const servicesByLocation = useMemo(() => new Map(locations.map(({ id }) => [
    id,
    services.flatMap((service) => {
      const link = links.find((row) => row.service_id === service.id && row.location_id === id);
      if (!link && service.location_assignment_mode !== 'all') return [];
      return [{ ...service, price: link?.price_minor_override ?? service.base_price_minor, duration: link?.duration_minutes_override ?? service.duration_minutes }];
    }),
  ])), [locations, services, links]);
  const offered = servicesByLocation.get(draft.locationId) ?? [];
  const selectedServices = draft.serviceIds.flatMap((id) => offered.filter((service) => service.id === id));
  const remainingServices = offered.filter((service) => !draft.serviceIds.includes(service.id));
  const selectedClient = clients.find((row) => row.id === draft.clientId);
  const bookingRequest = useMemo<BookingRequest | null>(() => {
    if (Object.keys(validateNewAppointment(draft)).length > 0) return null;
    return {
      client_id: draft.clientId, location_id: draft.locationId, service_ids: draft.serviceIds,
      starts_at: zonedWallClockToUtc(draft.date, draft.start, zone),
    };
  }, [draft, zone]);
  useEffect(() => {
    if (!client || !businessId || !bookingRequest) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void callFunction<SlotCheck>(client, businessId, 'artist-appointment-create', { ...bookingRequest, action: 'check' })
        .then((result) => {
          if (typeof result?.available !== 'boolean' || !Number.isFinite(Date.parse(result.ends_at))) throw new Error('CHECK_FAILED');
          if (active) setCheck({ request: bookingRequest, result });
        })
        .catch((error) => { if (active) setCheck({ request: bookingRequest, error: errorCode(error) }); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [client, businessId, bookingRequest, checkAttempt]);

  const currentCheck = check && check.request === bookingRequest ? check : null;
  const slot = currentCheck?.result;
  const when = slot && bookingRequest ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(bookingRequest.starts_at))
    + ' · ' + new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).formatRange(new Date(bookingRequest.starts_at), new Date(slot.ends_at)) : '';

  const update = <K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) => {
    setSaveError('');
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !businessId) return;
    const found = validateNewAppointment(draft);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length > 0 || !bookingRequest || !slot?.available || saving) return;
    if (idempotency.current?.request !== bookingRequest) idempotency.current = { request: bookingRequest, key: crypto.randomUUID() };
    setSaving(true);
    try {
      const result = await callFunction<{ appointment_id: string }>(client, businessId, 'artist-appointment-create', bookingRequest, { 'Idempotency-Key': idempotency.current.key });
      const number = await appointmentNumber(client, result.appointment_id);
      navigate(operatorUrl(businessId, number ? `appointments/${displayId('AID', number)}` : 'calendar'));
    } catch (error) {
      const code = errorCode(error);
      if (code === 'SLOT_TAKEN') setCheck({ request: bookingRequest, result: { ...slot, available: false } });
      setSaveError(KNOWN_ERRORS.has(code) ? code : 'GENERIC');
    } finally {
      setSaving(false);
    }
  };

  if (identityLoading) return <main className="mova-page mova-scheduling"><p role="status">{t('scheduling.appt.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.identityError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;
  if (loadError) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.appt.loadError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;

  const error = (key: AppointmentField) => errors[key] ? t(`scheduling.appt.error.${key}`) : '';
  const checkError = currentCheck?.error;
  const canRetryCheck = Boolean(checkError && !KNOWN_ERRORS.has(checkError));
  const serviceLimitReached = draft.serviceIds.length >= MAX_APPOINTMENT_SERVICES;
  const closeTo = `${operatorUrl(businessId, 'calendar')}${draft.date ? `?day=${encodeURIComponent(draft.date)}` : ''}`;
  const money = new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const serviceOption = (row: (typeof offered)[number]) => t('scheduling.appt.serviceOption', {
    name: row.name, duration: t('scheduling.minutesShort', { count: row.duration }), price: money.format(row.price / 100),
  });

  return <main className="mova-page mova-scheduling mova-scheduling--screen mova-scheduling--appointment">
    <ScreenHeader title={t('scheduling.appt.title')} titleAsHeading onBack={() => navigate(closeTo)} backLabel={t('scheduling.appt.close')} leadingIcon="close" />
    <form className="mova-scheduling__form mova-scheduling__form--appointment" onSubmit={(event) => void submit(event)} noValidate>
      <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.client')}</span>
        {selectedClient && !choosingClient ? <span className="mova-scheduling__selected-client">
          <span className="mova-scheduling__client-avatar" aria-hidden="true">{selectedClient.display_name.split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</span>
          <span className="mova-scheduling__selected-client-copy"><strong>{selectedClient.display_name}</strong><small>{selectedClient.phone || selectedClient.email || t('scheduling.appt.clientOnList')}</small></span>
          <button type="button" className="mova-button mova-button--secondary" onClick={()=>setChoosingClient(true)}>{t('scheduling.appt.changeClient')}</button>
        </span> : <AppointmentSelect value={draft.clientId} aria-invalid={Boolean(errors.client)} onChange={(event) => { update('clientId', event.target.value); setChoosingClient(false); }}>
          <option value="">{t('scheduling.appt.chooseClient')}</option>
          {clients.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}
        </AppointmentSelect>}
        {error('client') && <span className="mova-field__error" role="alert">{error('client')}</span>}
      </label>
      <Link className="mova-scheduling__inline-link" to={`${operatorUrl(businessId, 'clients/new')}?return=calendar&day=${encodeURIComponent(draft.date)}`}>{t('scheduling.appt.newClientInstead')}</Link>

      <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.location')}</span>
        <AppointmentSelect value={draft.locationId} disabled={locations.length === 0} aria-invalid={Boolean(errors.location)} onChange={(event) => update('locationId', event.target.value)}>
          <option value="" disabled>{t('scheduling.appt.chooseLocation')}</option>
          {locations.map((row) => {
            const compatible = draft.serviceIds.every((id) => servicesByLocation.get(row.id)?.some((service) => service.id === id));
            return <option key={row.id} value={row.id} disabled={!compatible}>
              {compatible ? row.name : t('scheduling.appt.incompatibleLocation', { name: row.name })}
            </option>;
          })}
        </AppointmentSelect>
      </label>
      {locations.length === 0 && <p className="mova-field__hint">{t('scheduling.appt.noLocations')}</p>}
      {error('location') && <p className="mova-field__error" role="alert">{error('location')}</p>}

      <div className="mova-scheduling__services">
        <label className="mova-field"><span className="mova-field__label">{t('scheduling.appt.service')}</span>
          <AppointmentSelect value="" disabled={!remainingServices.length || serviceLimitReached} aria-invalid={Boolean(errors.service)} onChange={(event) => update('serviceIds', [...draft.serviceIds, event.target.value])}>
            <option value="" disabled>{t('scheduling.appt.chooseService')}</option>
            {remainingServices.map((row) => <option key={row.id} value={row.id}>{serviceOption(row)}</option>)}
          </AppointmentSelect>
        </label>
        {selectedServices.length > 0 && <ol className="mova-scheduling__service-list" aria-label={t('scheduling.appt.selectedServices')}>
          {selectedServices.map((row) => <li key={row.id}>
            <span>{serviceOption(row)}{row.buffer_minutes > 0 && <small>{t('scheduling.appt.serviceBuffer', { duration: t('scheduling.minutesShort', { count: row.buffer_minutes }) })}</small>}</span>
            <Button type="button" variant="secondary" aria-label={t('scheduling.appt.removeService', { name: row.name })} onClick={() => update('serviceIds', draft.serviceIds.filter((id) => id !== row.id))}>{t('scheduling.appt.remove')}</Button>
          </li>)}
        </ol>}
        {error('service') && <p className="mova-field__error" role="alert">{error('service')}</p>}
        {draft.locationId && offered.length === 0 && <p className="mova-field__hint">{t('scheduling.appt.noServices')}</p>}
        {serviceLimitReached && <p className="mova-field__hint">{t('scheduling.appt.serviceLimit', { count: MAX_APPOINTMENT_SERVICES })}</p>}
      </div>

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
        {!bookingRequest ? t('scheduling.appt.pickFirst')
          : slot ? t(slot.available ? 'scheduling.appt.free' : 'scheduling.appt.busy', { when })
          : checkError ? t(canRetryCheck ? 'scheduling.appt.checkError' : `scheduling.appt.saveError.${checkError}`)
          : t('scheduling.appt.checking')}
      </p>
      {canRetryCheck && <Button type="button" variant="secondary" onClick={() => { setCheck(null); setCheckAttempt((count) => count + 1); }}>{t('scheduling.retry')}</Button>}

      {saveError && <p className="mova-field__error" role="alert">{t(`scheduling.appt.saveError.${KNOWN_ERRORS.has(saveError) ? saveError : 'GENERIC'}`)}</p>}
      <div className="mova-actions">
        <Button type="submit" loading={saving} disabled={Boolean(bookingRequest && !slot?.available)}>{t('scheduling.appt.book')}</Button>
      </div>
    </form>
  </main>;
}

function AppointmentSelect(props: ComponentPropsWithoutRef<'select'>) {
  return <span className="mova-scheduling__select">
    <select {...props} className="mova-input" />
    <Icon name="chevron" size={16} />
  </span>;
}

async function appointmentNumber(client: MovaClient, id: string): Promise<number | null> {
  const { data } = await client.from('mova_appointments').select('appointment_number').eq('id', id).maybeSingle();
  return data?.appointment_number ?? null;
}

export default NewAppointmentPage;
