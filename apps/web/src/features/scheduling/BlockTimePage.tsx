import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ErrorState, RadioCard, ScreenHeader, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { loadBookingOptions, loadBusy, type LocationRow } from './api';
import { BLOCK_REASONS, blockDefaults, blockWindow, buildBlockRows, overlaps, validateBlockTime, type BlockDraft, type BlockField, type BlockReason } from './rules';
import './scheduling.css';

// Board 08e: Block time. Writes one availability block per chosen location. Repeats are not built yet.
export function BlockTimePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const today = new Date().toLocaleDateString('en-CA');
  const [draft, setDraft] = useState<BlockDraft>(() => blockDefaults(today));
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [where, setWhere] = useState<'all' | string>('all');
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
    const rows = buildBlockRows({ ...draft, locationIds: chosen }, zoneByLocation, businessId);
    setBusy(true);
    try {
      if (conflicts === null) {
        // Board 08e: if an appointment already falls inside the block, ask before saving.
        const windowByLocation = Object.fromEntries(chosen.map((locationId) => [locationId, blockWindow({ ...draft, locationIds: [locationId] }, zoneByLocation[locationId] ?? 'UTC')]));
        const windows = Object.values(windowByLocation);
        const from = windows.reduce((min, window) => (window.startsAt < min ? window.startsAt : min), windows[0]!.startsAt);
        const to = windows.reduce((max, window) => (window.endsAt > max ? window.endsAt : max), windows[0]!.endsAt);
        const busyRows = await loadBusy(client, businessId, chosen, from, to);
        const hits = busyRows.filter((row) => {
          const window = windowByLocation[row.location_id];
          return window !== undefined && overlaps({ startsAt: row.starts_at, endsAt: row.ends_at }, window);
        });
        if (hits.length > 0) { setConflicts(hits.length); setBusy(false); return; }
      }
      const { error } = await client.from('mova_availability_blocks').insert(rows);
      if (error) throw error;
      navigate(operatorUrl(businessId, 'calendar'));
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

  return <main className="mova-page mova-scheduling">
    <ScreenHeader title={t('scheduling.block.title')} onBack={() => navigate(operatorUrl(businessId, 'calendar'))} backLabel={t('scheduling.block.close')} />
    <h1>{t('scheduling.block.title')}</h1>
    <form className="mova-scheduling__form" onSubmit={(event) => void save(event)} noValidate>
      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.block.whatFor')}</legend>
        <div className="mova-scheduling__stack">
          {BLOCK_REASONS.map((reason) => <RadioCard key={reason} name="reason" value={reason} label={t(`scheduling.blockReasons.${reason}`)} checked={draft.reason === reason} onChange={(value) => update('reason', value as BlockReason)} />)}
        </div>
        {errors.reason && <p className="mova-field__error" role="alert">{error('reason')}</p>}
      </fieldset>

      <TextField label={`${t('scheduling.block.label')} ${t('scheduling.block.labelHint')}`} placeholder={t('scheduling.block.labelPlaceholder')} maxLength={120} value={draft.label} error={error('label')} onChange={(event) => update('label', event.target.value)} />

      <section className="mova-scheduling__when" aria-label={t('scheduling.block.when')}>
        <Checkbox label={t('scheduling.block.allDay')} checked={draft.allDay} onChange={(event) => update('allDay', event.currentTarget.checked)} />
        <TextField label={t('scheduling.block.date')} type="date" value={draft.date} error={error('date')} onChange={(event) => update('date', event.target.value)} />
        {!draft.allDay && <div className="mova-form-grid">
          <TextField label={t('scheduling.block.from')} type="time" value={draft.from} onChange={(event) => update('from', event.target.value)} />
          <TextField label={t('scheduling.block.to')} type="time" value={draft.to} onChange={(event) => update('to', event.target.value)} />
        </div>}
        {errors.hours && <p className="mova-field__error" role="alert">{error('hours')}</p>}
      </section>

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.block.where')}</legend>
        <div className="mova-scheduling__pair">
          <RadioCard name="where" value="all" label={t('scheduling.block.allLocations')} checked={where === 'all'} onChange={(value) => setWhere(value)} />
          {locations.map((row) => <RadioCard key={row.id} name="where" value={row.id} label={row.name} checked={where === row.id} onChange={(value) => setWhere(value)} />)}
        </div>
        {errors.locations && <p className="mova-field__error" role="alert">{t('scheduling.block.error.locations')}</p>}
      </fieldset>

      <p className="mova-scheduling__note">{t('scheduling.block.note')}</p>
      {conflicts !== null && <p className="mova-field__error" role="alert">{t('scheduling.block.conflicts', { count: conflicts })}</p>}
      {saveError && <p className="mova-field__error" role="alert">{t('scheduling.block.saveError')}</p>}
      <div className="mova-actions">
        <Button type="submit" loading={busy}>{conflicts !== null ? t('scheduling.block.blockAnyway') : t('scheduling.block.submit')}</Button>
      </div>
    </form>
  </main>;
}

export default BlockTimePage;
