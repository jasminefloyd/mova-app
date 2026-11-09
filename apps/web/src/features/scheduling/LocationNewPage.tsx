import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, RadioCard, ScreenHeader, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { callFunction, errorCode } from './api';
import { BOOK_AHEAD_WEEK_OPTIONS, BUFFER_MINUTE_OPTIONS, LOCATION_KINDS, NOTICE_HOUR_OPTIONS, locationSavePayload, newLocationDefaults, validateNewLocation, type LocationKind, type NewLocationDraft, type NewLocationField } from './rules';
import './scheduling.css';

// Board 19a: Create new location. Saves through the existing location-save function.
export function LocationNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [draft, setDraft] = useState<NewLocationDraft>(() => newLocationDefaults(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [errors, setErrors] = useState<Partial<Record<NewLocationField, true>>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [colorIndex, setColorIndex] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const zones = Intl.supportedValuesOf('timeZone');

  useEffect(() => {
    if (!client || !businessId) return;
    void client.from('mova_locations').select('id', { count: 'exact', head: true }).eq('artist_business_id', businessId)
      .then(({ count, error }) => { if (error) setLoadError(true); else setColorIndex((count ?? 0) % 12); });
  }, [client, businessId]);

  const update = <K extends keyof NewLocationDraft>(key: K, value: NewLocationDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleDay = (weekday: number) => setDraft((current) => ({
    ...current,
    weekdays: current.weekdays.includes(weekday) ? current.weekdays.filter((day) => day !== weekday) : [...current.weekdays, weekday],
    hoursByWeekday: current.weekdays.includes(weekday) ? current.hoursByWeekday : { ...current.hoursByWeekday, [weekday]: { opens: '09:00', closes: '17:00' } },
  }));
  const updateDayHours = (weekday: number, key: 'opens' | 'closes', value: string) => setDraft((current) => ({
    ...current,
    hoursByWeekday: { ...current.hoursByWeekday, [weekday]: { ...current.hoursByWeekday[weekday], [key]: value } },
  }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateNewLocation(draft);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length > 0 || !businessId) return;
    setBusy(true);
    try {
      await callFunction(client, businessId, 'location-save', { ...locationSavePayload(draft, colorIndex), location_id: null });
      navigate(operatorUrl(businessId, 'settings/locations'));
    } catch (error) {
      setSaveError(errorCode(error));
    } finally {
      setBusy(false);
    }
  };

  if (identityLoading) return <main className="mova-page mova-scheduling"><p role="status">{t('scheduling.locationNew.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.identityError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;

  const fieldError = (key: NewLocationField) => errors[key] ? t(`scheduling.locationNew.error.${key}`) : '';
  const minutes = (value: number) => value === 0 ? t('scheduling.locationNew.noBuffer') : t('scheduling.minutesShort', { count: value });
  const hours = (value: number) => t('scheduling.hoursShort', { count: value });
  const weeks = (value: number) => t('scheduling.weeksShort', { count: value });
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

  return <main className="mova-page mova-scheduling">
    <ScreenHeader title={t('scheduling.locationNew.title')} onBack={() => navigate(operatorUrl(businessId, 'settings/locations'))} backLabel={t('scheduling.locationNew.back')} />
    <h1>{t('scheduling.locationNew.heading')}</h1>
    {loadError && <ErrorState title={t('scheduling.locationNew.loadError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} />}
    <form className="mova-scheduling__form" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.kindLegend')}</legend>
        <div className="mova-scheduling__stack">
          {LOCATION_KINDS.map((kind) => <RadioCard key={kind} name="kind" value={kind} label={t(`scheduling.locationNew.kind.${kind}`)} checked={draft.kind === kind} onChange={(value) => update('kind', value as LocationKind)} />)}
        </div>
        {errors.kind && <p className="mova-field__error" role="alert">{fieldError('kind')}</p>}
      </fieldset>

      <TextField label={t('scheduling.locationNew.name')} placeholder={t('scheduling.locationNew.namePlaceholder')} maxLength={120} value={draft.name} error={fieldError('name')} onChange={(event) => update('name', event.target.value)} />
      <TextField label={t('scheduling.locationNew.address')} hint={t('scheduling.locationNew.addressHint')} autoComplete="street-address" maxLength={300} value={draft.address} error={fieldError('address')} onChange={(event) => update('address', event.target.value)} />
      <label className="mova-field"><span className="mova-field__label">{t('scheduling.locationNew.timeZone')}</span>
        <select className="mova-input" value={draft.timeZone} aria-invalid={Boolean(errors.timeZone)} onChange={(event) => update('timeZone', event.target.value)}>
          {!zones.includes(draft.timeZone) && draft.timeZone && <option value={draft.timeZone}>{draft.timeZone}</option>}
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
        <span className="mova-field__hint">{t('scheduling.locationNew.timeZoneHint')}</span>
        {errors.timeZone && <span className="mova-field__error" role="alert">{fieldError('timeZone')}</span>}
      </label>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.modeLegend')}</legend>
        <div className="mova-scheduling__stack">
          <RadioCard name="mode" value="instant" label={t('scheduling.mode.instant')} description={t('scheduling.mode.instantHint')} checked={draft.mode === 'instant'} onChange={(value) => update('mode', value as 'instant')} />
          <RadioCard name="mode" value="request" label={t('scheduling.mode.request')} description={t('scheduling.mode.requestHint')} checked={draft.mode === 'request'} onChange={(value) => update('mode', value as 'request')} />
        </div>
      </fieldset>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.collectorLegend')}</legend>
        <div className="mova-scheduling__pair">
          <RadioCard name="collector" value="artist" label={t('scheduling.collector.artist')} checked={draft.collector === 'artist'} onChange={(value) => update('collector', value as 'artist')} />
          <RadioCard name="collector" value="salon" label={t('scheduling.collector.salon')} checked={draft.collector === 'salon'} onChange={(value) => update('collector', value as 'salon')} />
        </div>
      </fieldset>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.locationNew.hoursLegend')}</legend>
        <div className="mova-scheduling__days" role="group" aria-label={t('scheduling.locationNew.daysLabel')}>
          {dayNames.map((name, weekday) => <button key={name} type="button" className="mova-scheduling__day" aria-pressed={draft.weekdays.includes(weekday)} aria-label={t(`scheduling.days.${name}`)} onClick={() => toggleDay(weekday)}>{t(`scheduling.daysShort.${name}`)}</button>)}
        </div>
        {errors.weekdays && <p className="mova-field__error" role="alert">{fieldError('weekdays')}</p>}
        {draft.weekdays.slice().sort((a, b) => a - b).map((weekday) => <fieldset key={weekday} className="mova-choice-fieldset">
          <legend>{t(`scheduling.days.${dayNames[weekday]}`)}</legend>
          <div className="mova-form-grid">
            <TextField label={t('scheduling.locationNew.opens')} type="time" value={draft.hoursByWeekday[weekday]?.opens ?? '09:00'} onChange={(event) => updateDayHours(weekday, 'opens', event.target.value)} />
            <TextField label={t('scheduling.locationNew.closes')} type="time" value={draft.hoursByWeekday[weekday]?.closes ?? '17:00'} onChange={(event) => updateDayHours(weekday, 'closes', event.target.value)} />
          </div>
        </fieldset>)}
        {errors.hours && <p className="mova-field__error" role="alert">{fieldError('hours')}</p>}
      </fieldset>

      <section className="mova-scheduling__rules" aria-label={t('scheduling.locationNew.rulesTitle')}>
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
      <div className="mova-actions">
        <Button type="submit" loading={busy}>{t('scheduling.locationNew.save')}</Button>
      </div>
    </form>
  </main>;
}

export default LocationNewPage;
