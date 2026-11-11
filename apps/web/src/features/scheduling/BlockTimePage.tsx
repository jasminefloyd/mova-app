import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, RadioCard, ScreenHeader, TextField, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { loadBookingOptions, loadBusy, type LocationRow } from './api';
import { addDays, BLOCK_REASONS, blockDefaults, blockWindow, buildBlockRows, overlaps, validateBlockTime, type BlockDraft, type BlockField, type BlockReason } from './rules';
import './scheduling.css';

// Board 08e: Block time. Writes one availability block per chosen location and selected week.
export function BlockTimePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const requestedDay = params.get('day');
  const today = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : new Date().toLocaleDateString('en-CA');
  const [draft, setDraft] = useState<BlockDraft>(() => blockDefaults(today));
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [where, setWhere] = useState<'all' | string>('all');
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [errors, setErrors] = useState<Partial<Record<BlockField, true>>>({});
  const [loadError, setLoadError] = useState(false);
  const [conflicts, setConflicts] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!client || !businessId) return;
    void loadBookingOptions(client, businessId).then((options) => setLocations(options.locations)).catch(() => setLoadError(true));
  }, [client, businessId]);

  const chosen = useMemo(() => where === 'all' ? locations.map((row) => row.id) : locations.filter((row) => row.id === where).map((row) => row.id), [where, locations]);
  const update = <K extends keyof BlockDraft>(key: K, value: BlockDraft[K]) => { setConflicts(null); setDraft((current) => ({ ...current, [key]: value })); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !businessId) return;
    const found = validateBlockTime({ ...draft, locationIds: chosen });
    setErrors(found);
    setSaveError(false);
    if (Object.keys(found).length > 0) return;
    const zoneByLocation = Object.fromEntries(locations.map((row) => [row.id, row.time_zone]));
    const occurrenceDrafts = Array.from({ length: repeatWeeks }, (_, index) => ({ ...draft, date: addDays(draft.date, index * 7), locationIds: chosen }));
    const rows = occurrenceDrafts.flatMap((occurrence) => buildBlockRows(occurrence, zoneByLocation, businessId));
    setBusy(true);
    try {
      if (conflicts === null) {
        // Board 08e: if an appointment already falls inside the block, ask before saving.
        const windowByLocation = Object.fromEntries(chosen.map((locationId) => [locationId, occurrenceDrafts.map((occurrence) => blockWindow({ ...occurrence, locationIds: [locationId] }, zoneByLocation[locationId] ?? 'UTC'))]));
        const windows = Object.values(windowByLocation).flat();
        const from = windows.reduce((min, window) => (window.startsAt < min ? window.startsAt : min), windows[0]!.startsAt);
        const to = windows.reduce((max, window) => (window.endsAt > max ? window.endsAt : max), windows[0]!.endsAt);
        const busyRows = await loadBusy(client, businessId, chosen, from, to);
        const hits = busyRows.filter((row) => (windowByLocation[row.location_id] ?? []).some((window) => overlaps({ startsAt: row.starts_at, endsAt: row.ends_at }, window)));
        if (hits.length > 0) { setConflicts(hits.length); setBusy(false); return; }
      }
      const { error } = await client.from('mova_availability_blocks').insert(rows);
      if (error) throw error;
      navigate(`${operatorUrl(businessId, 'calendar')}${requestedDay ? `?day=${encodeURIComponent(requestedDay)}` : ''}`);
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  };

  if (identityLoading) return <main className="mova-page mova-scheduling"><p role="status">{t('scheduling.block.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.identityError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;
  if (loadError) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.block.loadError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;

  const error = (key: BlockField) => errors[key] ? t(`scheduling.block.error.${key}`) : '';

  return <main className="mova-page mova-scheduling mova-scheduling--screen mova-scheduling--block">
    <ScreenHeader title={t('scheduling.block.title')} onBack={() => navigate(`${operatorUrl(businessId, 'calendar')}${requestedDay ? `?day=${encodeURIComponent(requestedDay)}` : ''}`)} backLabel={t('scheduling.block.close')} leadingIcon="close" />
    <form className="mova-scheduling__form mova-scheduling__form--block" onSubmit={(event) => void save(event)} noValidate>
      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.block.whatFor')}</legend>
        <div className="mova-scheduling__pair mova-scheduling__reason-grid">
          {BLOCK_REASONS.map((reason) => <RadioCard key={reason} name="reason" value={reason} label={t(`scheduling.blockReasons.${reason}`)} checked={draft.reason === reason} onChange={(value) => update('reason', value as BlockReason)} />)}
        </div>
        {errors.reason && <p className="mova-field__error" role="alert">{error('reason')}</p>}
      </fieldset>

      <TextField label={`${t('scheduling.block.label')} ${t('scheduling.block.labelHint')}`} placeholder={t('scheduling.block.labelPlaceholder')} maxLength={120} value={draft.label} error={error('label')} onChange={(event) => update('label', event.target.value)} />

      <section className="mova-scheduling__when mova-scheduling__when-card" aria-label={t('scheduling.block.when')}>
        <div className="mova-scheduling__all-day"><Toggle label={t('scheduling.block.allDay')} checked={draft.allDay} onChange={(value) => update('allDay', value)} /></div>
        <TextField label={t('scheduling.block.date')} type="date" value={draft.date} error={error('date')} onChange={(event) => update('date', event.target.value)} />
        {!draft.allDay && <div className="mova-form-grid">
          <TextField label={t('scheduling.block.from')} type="time" value={draft.from} onChange={(event) => update('from', event.target.value)} />
          <TextField label={t('scheduling.block.to')} type="time" value={draft.to} onChange={(event) => update('to', event.target.value)} />
        </div>}
        {errors.hours && <p className="mova-field__error" role="alert">{error('hours')}</p>}
        <label className="mova-field"><span className="mova-field__label">{t('scheduling.block.repeats')}</span><select className="mova-input" value={repeatWeeks} onChange={(event) => { setConflicts(null); setRepeatWeeks(Number(event.target.value)); }}><option value={1}>{t('scheduling.block.repeatOnce')}</option>{[2,4,8,12].map((count)=><option key={count} value={count}>{t('scheduling.block.repeatWeeklyCount',{count})}</option>)}</select></label>
      </section>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.block.where')}</legend>
        <div className="mova-scheduling__pair mova-scheduling__where-options">
          <RadioCard name="where" value="all" label={t('scheduling.block.allLocations')} checked={where === 'all'} onChange={(value) => setWhere(value)} />
          {locations.map((row) => <RadioCard key={row.id} name="where" value={row.id} label={row.name} checked={where === row.id} onChange={(value) => setWhere(value)} />)}
        </div>
        {errors.locations && <p className="mova-field__error" role="alert">{t('scheduling.block.error.locations')}</p>}
      </fieldset>

      <p className="mova-scheduling__note">{t('scheduling.block.note')}</p>
      {conflicts !== null && <p className="mova-field__error" role="alert">{t('scheduling.block.conflicts', { count: conflicts })}</p>}
      {saveError && <p className="mova-field__error" role="alert">{t('scheduling.block.saveError')}</p>}
      <div className="mova-actions mova-scheduling__footer-actions">
        <Button type="submit" loading={busy}>{conflicts !== null ? t('scheduling.block.blockAnyway') : t('scheduling.block.submit')}</Button>
      </div>
    </form>
  </main>;
}

export default BlockTimePage;
