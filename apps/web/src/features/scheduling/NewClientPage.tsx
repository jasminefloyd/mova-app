import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ErrorState, ScreenHeader, TextArea, TextField } from '../../components';
import { displayId } from '../../lib/display-ids';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { callFunction, errorCode } from './api';
import { DEFAULT_CONSENT_CHOICES, consentWrites, validateNewClient, type ConsentChoices, type NewClientDraft, type NewClientField } from './rules';
import './scheduling.css';

// Board 08d: New client. Creates the client, then records only the consent boxes the stylist ticked.
export function NewClientPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [draft, setDraft] = useState<NewClientDraft>({ firstName: '', lastName: '', mobile: '', email: '', locale: 'en-US', consent: DEFAULT_CONSENT_CHOICES });
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<NewClientField, true>>>({});
  const [busy, setBusy] = useState<'save' | 'book' | null>(null);
  const [saveError, setSaveError] = useState('');
  const [savedId, setSavedId] = useState<{ id: string; client_number: number } | null>(null);

  const update = <K extends keyof NewClientDraft>(key: K, value: NewClientDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setConsent = (key: keyof ConsentChoices, value: boolean) => setDraft((current) => ({ ...current, consent: { ...current.consent, [key]: value } }));

  const save = async (mode: 'save' | 'book') => {
    if (!businessId) return;
    const found = validateNewClient(draft);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length > 0) return;
    setBusy(mode);
    const mobile = draft.mobile.trim();
    const email = draft.email.trim();
    const name = [draft.firstName.trim(), draft.lastName.trim()].filter(Boolean).join(' ');
    let created: { id: string; client_number: number } | null = savedId;
    try {
      if (!created) {
        created = await callFunction<{ id: string; client_number: number }>(client, businessId, 'client-crud', {
          action: 'create', display_name: name, email, phone: mobile, preferred_locale: draft.locale,
        });
        setSavedId(created);
      }
      const writes = consentWrites(draft.consent, { hasPhone: Boolean(mobile), hasEmail: Boolean(email) });
      for (const write of writes) {
        await callFunction(client, businessId, 'client-consents', { action: 'set', client_id: created.id, purpose: write.purpose, channel: write.channel, granted: true, locale: draft.locale });
      }
      if (notes.trim()) {
        try {
          await callFunction(client, businessId, 'client-notes', { action: 'save', client_id: created.id, category: 'free', body: notes.trim(), is_sensitive: false });
        } catch {
          setSaveError('notes');
          setBusy(null);
          return;
        }
      }
      const path = mode === 'book'
        ? `calendar/new-appointment?client=${created.id}`
        : `clients/${displayId('CID', created.client_number)}`;
      navigate(operatorUrl(businessId, path));
    } catch (error) {
      setSaveError(created ? 'partial' : errorCode(error));
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void save('save'); };

  if (identityLoading) return <main className="mova-page mova-scheduling"><p role="status">{t('scheduling.client.loading')}</p></main>;
  if (!businessId) return <main className="mova-page mova-scheduling"><ErrorState title={t('scheduling.identityError')} retryLabel={t('scheduling.retry')} onRetry={() => window.location.reload()} /></main>;

  const error = (key: NewClientField) => errors[key] ? t(`scheduling.client.error.${key}`) : '';
  const closeTo = operatorUrl(businessId, 'clients');

  return <main className="mova-page mova-scheduling">
    <ScreenHeader title={t('scheduling.client.title')} onBack={() => navigate(closeTo)} backLabel={t('scheduling.client.close')} trailing={<Link to={operatorUrl(businessId, 'clients/import')}>{t('scheduling.client.import')}</Link>} />
    <h1>{t('scheduling.client.title')}</h1>
    <form className="mova-scheduling__form" onSubmit={submit} noValidate>
      <div className="mova-form-grid">
        <TextField label={t('scheduling.client.first')} autoComplete="given-name" maxLength={80} value={draft.firstName} error={error('firstName')} onChange={(event) => update('firstName', event.target.value)} />
        <TextField label={t('scheduling.client.last')} autoComplete="family-name" maxLength={80} value={draft.lastName} onChange={(event) => update('lastName', event.target.value)} />
      </div>
      <TextField label={t('scheduling.client.mobile')} type="tel" autoComplete="tel" placeholder={t('scheduling.client.mobilePlaceholder')} value={draft.mobile} error={error('mobile') || error('contact')} onChange={(event) => update('mobile', event.target.value)} />
      <TextField label={`${t('scheduling.client.email')} ${t('scheduling.client.optional')}`} type="email" autoComplete="email" value={draft.email} error={error('email')} onChange={(event) => update('email', event.target.value)} />

      <fieldset className="mova-choice-fieldset">
        <legend>{t('scheduling.client.langLegend')}</legend>
        <div className="mova-scheduling__pair">
          <label className="mova-radio-card mova-radio-card--outlined"><input type="radio" name="client-locale" value="en-US" checked={draft.locale === 'en-US'} onChange={() => update('locale', 'en-US')} /><span><strong>{t('scheduling.client.langEn')}</strong></span><span className="mova-radio-card__dot" aria-hidden="true" /></label>
          <label className="mova-radio-card mova-radio-card--outlined"><input type="radio" name="client-locale" value="es-US" checked={draft.locale === 'es-US'} onChange={() => update('locale', 'es-US')} /><span><strong>{t('scheduling.client.langEs')}</strong></span><span className="mova-radio-card__dot" aria-hidden="true" /></label>
        </div>
      </fieldset>

      <fieldset className="mova-choice-fieldset mova-scheduling__consent">
        <legend>{t('scheduling.client.consentLegend')}</legend>
        <p className="mova-field__hint">{t('scheduling.client.consentHint')}</p>
        <Checkbox label={t('scheduling.client.consentAppointments')} checked={draft.consent.appointmentUpdates} onChange={(event) => setConsent('appointmentUpdates', event.currentTarget.checked)} />
        <p className="mova-field__hint mova-scheduling__consent-hint">{t('scheduling.client.consentAppointmentsHint')}</p>
        <Checkbox label={t('scheduling.client.consentRebooking')} checked={draft.consent.rebookingAndOffers} onChange={(event) => setConsent('rebookingAndOffers', event.currentTarget.checked)} />
        <p className="mova-field__hint mova-scheduling__consent-hint">{t('scheduling.client.consentRebookingHint')}</p>
        {errors.consentChannel && <p className="mova-field__error" role="alert">{t('scheduling.client.error.consentChannel')}</p>}
      </fieldset>

      <TextArea label={`${t('scheduling.client.notes')} ${t('scheduling.client.notesHint')}`} rows={3} maxLength={2000} placeholder={t('scheduling.client.notesPlaceholder')} value={notes} onChange={(event) => setNotes(event.target.value)} />

      {saveError === 'notes' && <p className="mova-field__error" role="alert">{t('scheduling.client.notesError')}</p>}
      {saveError === 'partial' && <p className="mova-field__error" role="alert">{t('scheduling.client.partialError')}</p>}
      {saveError && saveError !== 'notes' && saveError !== 'partial' && <p className="mova-field__error" role="alert">{t('scheduling.client.saveError')}</p>}
      <div className="mova-actions">
        <Button type="submit" loading={busy === 'save'} disabled={busy !== null}>{t('scheduling.client.saveClient')}</Button>
        <Button type="button" variant="secondary" loading={busy === 'book'} disabled={busy !== null} onClick={() => void save('book')}>{t('scheduling.client.saveBook')}</Button>
      </div>
    </form>
  </main>;
}

export default NewClientPage;
