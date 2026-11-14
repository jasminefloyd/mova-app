import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, Icon, RadioCard, ScreenHeader, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { callFunction, errorCode } from './api';
import { BOOK_AHEAD_WEEK_OPTIONS, BUFFER_MINUTE_OPTIONS, LOCATION_KINDS, NOTICE_HOUR_OPTIONS, locationSavePayload, newLocationDefaults, validateNewLocation, type LocationKind, type NewLocationDraft, type NewLocationField } from './rules';
import './scheduling.css';

// Friendly zone name, e.g. "Eastern Time". Falls back to the zone id.
function zoneName(timeZone: string, locale: string) {
  try { return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? timeZone; } catch { return timeZone; }
}

// Board 19a: Create new location. Saves through the existing location-save function.
export function LocationNewPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const locationId = searchParams.get('location_id');
  const [zoneOpen, setZoneOpen] = useState(false);
  const [draft, setDraft] = useState<NewLocationDraft>(() => newLocationDefaults(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [differentHours, setDifferentHours] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<NewLocationField, true>>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [colorIndex, setColorIndex] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(Boolean(locationId));
  const [savedAddress, setSavedAddress] = useState<Record<string, unknown>>({});
  const [savedClientDetails, setSavedClientDetails] = useState<Record<string, unknown>>({});
  const [savedExceptions, setSavedExceptions] = useState<Array<{ exception_date: string; is_closed: boolean; hours: Array<{ opens_at: string; closes_at: string }>; reason: string }>>([]);
  const [savedPolicyRemainder, setSavedPolicyRemainder] = useState<Record<string, number>>({});
  const zones = Intl.supportedValuesOf('timeZone');

  const locationsPath = operatorUrl(businessId, 'settings/locations');
  const returnTo = searchParams.get('return_to') === '/onboarding/publish' ? '/onboarding/publish' : locationsPath;
  const backTo = searchParams.get('back_to') === '/onboarding/services' ? '/onboarding/services' : locationsPath;

  useEffect(() => {
    if (!client || !businessId) return;
    void client.from('mova_locations').select('id', { count: 'exact', head: true }).eq('artist_business_id', businessId)
      .then(({ count, error }) => { if (error) setLoadError(true); else setColorIndex((count ?? 0) % 12); });
  }, [client, businessId]);

  useEffect(() => {
    if (!locationId || !client || !businessId) { setLoadingLocation(false); return; }
    let active = true;
    setLoadingLocation(true);
    void (async () => {
      const [locationResult, hoursResult, policyResult, exceptionResult] = await Promise.all([
        client.from('mova_locations').select('id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone,address,display_color_index').eq('id', locationId).eq('artist_business_id', businessId).maybeSingle(),
        client.from('mova_location_hours').select('weekday,opens_at,closes_at').eq('location_id', locationId).eq('artist_business_id', businessId),
        client.from('mova_location_policies').select('lead_time_minutes,booking_horizon_days,buffer_before_minutes,buffer_after_minutes,cancellation_window_minutes,request_expiry_hours,client_details').eq('location_id', locationId).eq('artist_business_id', businessId).maybeSingle(),
        client.from('mova_location_exceptions').select('exception_date,is_closed,hours,reason').eq('location_id', locationId).eq('artist_business_id', businessId).order('exception_date'),
      ]);
      if (!active) return;
      if (locationResult.error || hoursResult.error || policyResult.error || exceptionResult.error || !locationResult.data) {
        setLoadError(true); setLoadingLocation(false); return;
      }
      const row = locationResult.data;
      const address = row.address && typeof row.address === 'object' && !Array.isArray(row.address) ? row.address as Record<string, unknown> : {};
      const hourRows = (hoursResult.data ?? []) as Array<{ weekday: number; opens_at: string; closes_at: string }>;
      const hoursByWeekday = Object.fromEntries(hourRows.map((entry) => [entry.weekday, { opens: entry.opens_at.slice(0, 5), closes: entry.closes_at.slice(0, 5) }]));
      const weekdays = hourRows.map((entry) => entry.weekday).sort((a, b) => a - b);
      const distinctHours = new Set(hourRows.map((entry) => `${entry.opens_at}|${entry.closes_at}`));
      setDifferentHours(distinctHours.size > 1);
      setDraft((current) => ({
        ...current,
        kind: row.location_type as LocationKind,
        name: row.name,
        address: typeof address.street === 'string' ? address.street : '',
        timeZone: row.time_zone,
        mode: row.booking_mode as 'instant' | 'request',
        collector: row.payment_collector as 'artist' | 'salon',
        weekdays,
        hoursByWeekday,
        bufferMinutes: Number(policyResult.data?.buffer_after_minutes ?? 0),
        noticeHours: Math.max(1, Math.round(Number(policyResult.data?.lead_time_minutes ?? 60) / 60)),
        bookAheadWeeks: Math.max(1, Math.round(Number(policyResult.data?.booking_horizon_days ?? 56) / 7)),
      }));
      setSavedAddress(address);
      const clientDetails = policyResult.data?.client_details;
      setSavedClientDetails(clientDetails && typeof clientDetails === 'object' && !Array.isArray(clientDetails) ? clientDetails as Record<string, unknown> : {});
      setSavedPolicyRemainder({
        buffer_before_minutes: Number(policyResult.data?.buffer_before_minutes ?? 0),
        cancellation_window_minutes: Number(policyResult.data?.cancellation_window_minutes ?? 1440),
        request_expiry_hours: Number(policyResult.data?.request_expiry_hours ?? 24),
      });
      setSavedExceptions((exceptionResult.data ?? []).map((item) => ({ exception_date: item.exception_date, is_closed: item.is_closed, hours: Array.isArray(item.hours) ? item.hours : [], reason: item.reason ?? '' })));
      setColorIndex(Number(row.display_color_index ?? 0));
      setLoadingLocation(false);
    })();
    return () => { active = false; };
  }, [locationId, client, businessId]);

  const update = <K extends keyof NewLocationDraft>(key: K, value: NewLocationDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleDay = (weekday: number) => setDraft((current) => {
    const removing = current.weekdays.includes(weekday);
    const primary = current.hoursByWeekday[current.weekdays[0] ?? weekday] ?? { opens: '09:00', closes: '17:00' };
    return {
      ...current,
      weekdays: removing ? current.weekdays.filter((day) => day !== weekday) : [...current.weekdays, weekday],
      hoursByWeekday: removing ? current.hoursByWeekday : { ...current.hoursByWeekday, [weekday]: differentHours ? { opens: '09:00', closes: '17:00' } : primary },
    };
  });
  const updateDayHours = (weekday: number, key: 'opens' | 'closes', value: string) => setDraft((current) => {
    const hours = current.hoursByWeekday[weekday] ?? { opens: '09:00', closes: '17:00' };
    const nextHours = { ...hours, [key]: value };
    const selected = differentHours ? [weekday] : current.weekdays;
    return { ...current, hoursByWeekday: { ...current.hoursByWeekday, ...Object.fromEntries(selected.map((day) => [day, nextHours])) } };
  });
  const toggleDifferentHours = () => {
    setDraft((current) => {
      if (differentHours) {
        const first = current.hoursByWeekday[current.weekdays[0] ?? 0] ?? { opens: '09:00', closes: '17:00' };
        return { ...current, hoursByWeekday: { ...current.hoursByWeekday, ...Object.fromEntries(current.weekdays.map((day) => [day, first])) } };
      }
      return current;
    });
    setDifferentHours((value) => !value);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateNewLocation(draft);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length > 0 || !businessId) return;
    setBusy(true);
    try {
      const payload = locationSavePayload(draft, colorIndex);
      await callFunction(client, businessId, 'location-save', {
        ...payload,
        location_id: locationId,
        address: { ...savedAddress, street: draft.address.trim() },
        exceptions: locationId ? savedExceptions : payload.exceptions,
        client_details: savedClientDetails,
        policies: { ...payload.policies, ...savedPolicyRemainder },
      });
      navigate(returnTo);
    } catch (error) {
      setSaveError(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  if (identityLoading || loadingLocation) return <main className="mova-page mova-scheduling"><p role="status">{t('scheduling.locationNew.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.identityError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;

  const fieldError = (key: NewLocationField) => errors[key] ? t(`scheduling.locationNew.error.${key}`) : '';
  const minutes = (value: number) => value === 0 ? t('scheduling.locationNew.noBuffer') : t('scheduling.minutesShort', { count: value });
  const hours = (value: number) => t('scheduling.hoursShort', { count: value });
  const weeks = (value: number) => t('scheduling.weeksShort', { count: value });
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

  const primaryHours = draft.hoursByWeekday[draft.weekdays[0] ?? 0] ?? { opens: '09:00', closes: '17:00' };
  return <main className="mova-page mova-scheduling mova-scheduling--screen mova-location-new">
    <ScreenHeader title={t(locationId ? 'scheduling.locationNew.editTitle' : 'scheduling.locationNew.title')} onBack={() => navigate(backTo)} backLabel={t('scheduling.locationNew.back')} />
    <h1 className="mova-location-new__title">{t('scheduling.locationNew.heading')}</h1>
    {loadError && <ErrorState title={t('scheduling.locationNew.loadError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} />}
    <form className="mova-scheduling__form" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.kindLegend')}</legend>
        <div className="mova-scheduling__pair mova-location-new__kind-grid">
          {LOCATION_KINDS.map((kind) => <RadioCard key={kind} name="kind" value={kind} label={t(`scheduling.locationNew.kind.${kind}`)} checked={draft.kind === kind} onChange={(value) => update('kind', value as LocationKind)} />)}
        </div>
        {errors.kind && <p className="mova-field__error" role="alert">{fieldError('kind')}</p>}
      </fieldset>

      <TextField label={t('scheduling.locationNew.name')} placeholder={t('scheduling.locationNew.namePlaceholder')} maxLength={120} value={draft.name} error={fieldError('name')} onChange={(event) => update('name', event.target.value)} />
      <div className="mova-location-new__address"><Icon name="location" size={20} /><TextField label={t('scheduling.locationNew.address')} placeholder={t('scheduling.locationNew.addressPlaceholder')} hint={t('scheduling.locationNew.addressHint')} autoComplete="street-address" maxLength={300} value={draft.address} error={fieldError('address')} onChange={(event) => update('address', event.target.value)} /></div>
      {!zoneOpen && <p className="mova-location-new__zone"><Icon name="clock" size={16} /><span>{t('scheduling.locationNew.timeZoneLine', { zone: zoneName(draft.timeZone, i18n.language) })}</span><button type="button" className="mova-scheduling__inline-link" onClick={() => setZoneOpen(true)}>{t('scheduling.locationNew.timeZoneChange')}</button></p>}
      {(zoneOpen || errors.timeZone) && <label className="mova-field"><span className="mova-field__label">{t('scheduling.locationNew.timeZone')}</span>
        <select className="mova-input" value={draft.timeZone} aria-invalid={Boolean(errors.timeZone)} onChange={(event) => update('timeZone', event.target.value)}>
          {!zones.includes(draft.timeZone) && draft.timeZone && <option value={draft.timeZone}>{draft.timeZone}</option>}
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
        <span className="mova-field__hint">{t('scheduling.locationNew.timeZoneHint')}</span>
        {errors.timeZone && <span className="mova-field__error" role="alert">{fieldError('timeZone')}</span>}
      </label>}

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.modeLegend')}</legend>
        <div className="mova-scheduling__stack mova-location-new__booking-options">
          <RadioCard name="mode" value="instant" label={t('scheduling.mode.instant')} description={t('scheduling.mode.instantHint')} checked={draft.mode === 'instant'} onChange={(value) => update('mode', value as 'instant')} />
          <RadioCard name="mode" value="request" label={t('scheduling.mode.request')} description={t('scheduling.mode.requestHint')} checked={draft.mode === 'request'} onChange={(value) => update('mode', value as 'request')} />
        </div>
      </fieldset>

      <fieldset className="mova-choice-fieldset mova-location-new__collector">
        <legend>{t('scheduling.locationNew.collectorLegend')}</legend>
        <div className="mova-scheduling__pair">
          <RadioCard name="collector" value="artist" label={t('scheduling.collector.artist')} checked={draft.collector === 'artist'} onChange={(value) => update('collector', value as 'artist')} />
          <RadioCard name="collector" value="salon" label={t('scheduling.collector.salon')} checked={draft.collector === 'salon'} onChange={(value) => update('collector', value as 'salon')} />
        </div>
        <p className="mova-location-new__payment-hint">{t(draft.collector === 'artist' ? 'scheduling.locationNew.collectorArtistHint' : 'scheduling.locationNew.collectorSalonHint')}</p>
      </fieldset>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.hoursLegend')}</legend>
        <div className="mova-scheduling__days" role="group" aria-label={t('scheduling.locationNew.daysLabel')}>
          {dayNames.map((name, weekday) => <button key={name} type="button" className="mova-scheduling__day" aria-pressed={draft.weekdays.includes(weekday)} aria-label={t(`scheduling.days.${name}`)} onClick={() => toggleDay(weekday)}>{t(`scheduling.daysShort.${name}`)}</button>)}
        </div>
        {errors.weekdays && <p className="mova-field__error" role="alert">{fieldError('weekdays')}</p>}
        {!differentHours && <div className="mova-form-grid mova-location-new__shared-hours">
          <TextField label={t('scheduling.locationNew.opens')} type="time" value={primaryHours.opens} onChange={(event) => updateDayHours(draft.weekdays[0] ?? 0, 'opens', event.target.value)} />
          <TextField label={t('scheduling.locationNew.closes')} type="time" value={primaryHours.closes} onChange={(event) => updateDayHours(draft.weekdays[0] ?? 0, 'closes', event.target.value)} />
        </div>}
        {differentHours && draft.weekdays.slice().sort((a, b) => a - b).map((weekday) => <div key={weekday} className="mova-location-new__day-hours"><strong>{t(`scheduling.days.${dayNames[weekday]}`)}</strong><div className="mova-form-grid"><TextField label={t('scheduling.locationNew.opens')} type="time" value={draft.hoursByWeekday[weekday]?.opens ?? '09:00'} onChange={(event) => updateDayHours(weekday, 'opens', event.target.value)} /><TextField label={t('scheduling.locationNew.closes')} type="time" value={draft.hoursByWeekday[weekday]?.closes ?? '17:00'} onChange={(event) => updateDayHours(weekday, 'closes', event.target.value)} /></div></div>)}
        <button type="button" className="mova-scheduling__inline-link mova-location-new__different-hours" aria-expanded={differentHours} onClick={toggleDifferentHours}>{t(differentHours ? 'scheduling.locationNew.sameHours' : 'scheduling.locationNew.differentHours')}</button>
        {errors.hours && <p className="mova-field__error" role="alert">{fieldError('hours')}</p>}
      </fieldset>

      <section className="mova-scheduling__rules mova-location-new__rules-card" aria-label={t('scheduling.locationNew.rulesTitle')}>
        <h2>{t('scheduling.locationNew.rulesTitle')}</h2>
        <div className="mova-form-grid">
          <label className="mova-field"><span className="mova-field__label">{t('scheduling.locationNew.buffer')}</span>
            <select className="mova-input" value={draft.bufferMinutes} onChange={(event) => update('bufferMinutes', Number(event.target.value))}>{BUFFER_MINUTE_OPTIONS.map((value) => <option key={value} value={value}>{minutes(value)}</option>)}</select></label>
          <label className="mova-field"><span className="mova-field__label">{t('scheduling.locationNew.notice')}</span>
            <select className="mova-input" value={draft.noticeHours} onChange={(event) => update('noticeHours', Number(event.target.value))}>{NOTICE_HOUR_OPTIONS.map((value) => <option key={value} value={value}>{hours(value)}</option>)}</select></label>
          <label className="mova-field"><span className="mova-field__label">{t('scheduling.locationNew.bookAhead')}</span>
            <select className="mova-input" value={draft.bookAheadWeeks} onChange={(event) => update('bookAheadWeeks', Number(event.target.value))}>{BOOK_AHEAD_WEEK_OPTIONS.map((value) => <option key={value} value={value}>{weeks(value)}</option>)}</select></label>
        </div>
      </section>

      {saveError && <p className="mova-field__error" role="alert">{t('scheduling.locationNew.saveError')}</p>}
      <div className="mova-actions mova-scheduling__footer-actions">
      <Button type="submit" disabled={Boolean(locationId && loadError)} loading={busy}>{t(locationId ? 'scheduling.locationNew.saveEdit' : 'scheduling.locationNew.save')}</Button>
      </div>
    </form>
  </main>;
}

export default LocationNewPage;
