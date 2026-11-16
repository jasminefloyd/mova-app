import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Icon, TextArea, TextField } from '../../components';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { operatorLocation } from '../../app/operator-url';
import { displayId } from '../../lib/display-ids';
import { useLocale } from '../../app/LocaleProvider';
import { LocationNewPage } from '../scheduling/LocationNewPage';
import { ServiceSettingsPage } from '../services/ServiceSettingsPage';
import { PaymentSettingsPage } from '../money/PaymentSettingsPage';
import { WelcomeStep } from './WelcomeStep';
import './onboarding.css';

// Step 1 (account) lives at /signup. Steps 2–6 are here, then the welcome screen publishes the page.
type Step = 'profile' | 'photo' | 'location' | 'services' | 'payments' | 'welcome';
const stepOrder: Step[] = ['profile', 'photo', 'location', 'services', 'payments', 'welcome'];
type LocationSummary = { id: string; name: string; location_type: string; booking_mode: 'instant' | 'request'; payment_collector: 'artist' | 'salon' | null };
type ServiceRow = { id: string; name: string; category: string; duration_minutes: number; buffer_minutes: number; base_price_minor: number; deposit_type: 'none' | 'fixed' | 'percent'; deposit_value: number };

export function OnboardingFlow() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const supabase = useMemo(() => {
    try { return createMovaSupabaseClient(); } catch { return null; }
  }, []);
  const [step, setStep] = useState<Step>(routeStep(location.pathname));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const [originalHandle, setOriginalHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [specialtyDraft, setSpecialtyDraft] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [handleMessage, setHandleMessage] = useState('');
  const [handleAvailable, setHandleAvailable] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoZoom, setPhotoZoom] = useState(1);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [searchIndexEnabled, setSearchIndexEnabled] = useState(true);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [addingLocation, setAddingLocation] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [setupLoaded, setSetupLoaded] = useState(false);
  // Where to resume is decided once per visit; after that the stylist moves forward with the buttons.
  const resumed = useRef(false);

  useEffect(() => {
    try {
      const draft = JSON.parse(window.localStorage.getItem('mova_onboarding_draft') ?? 'null') as Partial<{
        displayName: string; handle: string; bio: string; specialties: string[];
      }> | null;
      if (!draft) return;
      if (typeof draft.displayName === 'string') setDisplayName(draft.displayName);
      if (typeof draft.handle === 'string') setHandle(draft.handle);
      if (typeof draft.bio === 'string') setBio(draft.bio);
      if (Array.isArray(draft.specialties)) setSpecialties(draft.specialties.filter((value): value is string => typeof value === 'string').slice(0, 5));
    } catch { window.localStorage.removeItem('mova_onboarding_draft'); }
  }, []);

  useEffect(() => {
    const draft = { displayName, handle, bio, specialties };
    try { window.localStorage.setItem('mova_onboarding_draft', JSON.stringify(draft)); } catch { /* Server progress remains available when local storage is unavailable. */ }
    if (!supabase || !businessId) return;
    void supabase.from('mova_onboarding_progress').update({ form_data: draft }).eq('artist_business_id', businessId);
  }, [displayName, handle, bio, specialties, businessId, supabase]);

  useEffect(() => {
    const nextStep = routeStep(location.pathname);
    setStep(nextStep);
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      // Onboarding needs a stylist account. Signed-out visitors start at sign-up.
      if (!session) { navigate('/signup', { replace: true }); return; }
      setSignedIn(true);
      const meta = session.user.user_metadata as Record<string, unknown> | undefined;
      const first = typeof meta?.first_name === 'string' ? meta.first_name.trim() : '';
      const last = typeof meta?.last_name === 'string' ? meta.last_name.trim() : '';
      setFirstName(first);
      // The private name only seeds the public display name; the stylist can change it.
      if (first || last) setDisplayName((current) => current || `${first} ${last}`.trim());
      const { data: membership } = await supabase.from('mova_artist_memberships')
        .select('artist_business_id').eq('user_id', session.user.id).eq('status', 'active').limit(1).maybeSingle();
      if (!active || !membership) return;
      const id = membership.artist_business_id;
      setBusinessId(id);
      const [{ data: profile }, { data: progress }] = await Promise.all([
        supabase.from('mova_artist_profiles').select('display_name, handle, bio, specialties, search_index_enabled').eq('artist_business_id', id).maybeSingle(),
        supabase.from('mova_onboarding_progress').select('current_step, form_data').eq('artist_business_id', id).maybeSingle(),
      ]);
      if (!active) return;
      if (profile) {
        setDisplayName(profile.display_name);
        setHandle(profile.handle);
        setOriginalHandle(profile.handle);
        setBio(profile.bio);
        setSpecialties(profile.specialties);
        setSearchIndexEnabled(profile.search_index_enabled);
      }
      const savedForm = progress?.form_data as Record<string, unknown> | undefined;
      if (savedForm) {
        if (typeof savedForm.displayName === 'string') setDisplayName(savedForm.displayName);
        if (typeof savedForm.handle === 'string') setHandle(savedForm.handle);
        if (typeof savedForm.bio === 'string') setBio(savedForm.bio);
        if (Array.isArray(savedForm.specialties)) setSpecialties(savedForm.specialties.filter((value): value is string => typeof value === 'string').slice(0, 5));
      }
      if (progress?.current_step === 'complete' && nextStep === 'welcome') { setStep('welcome'); return; }
      if (resumed.current && progress?.current_step !== 'complete') return;
      resumed.current = true;
      if (progress?.current_step === 'complete') {
        // A stylist who already finished onboarding belongs on Home, not on step 1 (task 2.1).
        const { data: business } = await supabase.from('mova_artist_businesses').select('business_number').eq('id', id).maybeSingle();
        if (!active || !business?.business_number) return;
        window.sessionStorage.setItem('mova_active_artist_business_id', id);
        window.sessionStorage.setItem('mova_active_artist_business_display_id', displayId('BID', business.business_number));
        const target = operatorLocation(id, '');
        if (target.startsWith('https://')) window.location.assign(target); else navigate(target, { replace: true });
        return;
      }
      if (progress?.current_step && progress.current_step !== 'complete') {
        if (progress.current_step === 'profile' || progress.current_step === 'photo') { setStep(progress.current_step); return; }
        // Location, services and payments resume from what is actually saved, so stylists who started
        // under the older order (services before location, a separate publish step) land on the right screen.
        const [{ count: locationCount }, { count: serviceCount }] = await Promise.all([
          supabase.from('mova_locations').select('id', { count: 'exact', head: true }).eq('artist_business_id', id).eq('is_active', true),
          supabase.from('mova_services').select('id', { count: 'exact', head: true }).eq('artist_business_id', id),
        ]);
        if (!active) return;
        setStep(!locationCount ? 'location' : !serviceCount ? 'services' : 'payments');
      }
    })();
    return () => { active = false; };
  }, [location.pathname, navigate, supabase]);

  const refreshSetup = useCallback(async () => {
    if (!supabase || !businessId) return;
    const [{ data: serviceRows }, { data: locationRows }] = await Promise.all([
      supabase.from('mova_services').select('id, name, category, duration_minutes, buffer_minutes, base_price_minor, deposit_type, deposit_value')
        .eq('artist_business_id', businessId).order('created_at'),
      supabase.from('mova_locations').select('id, name, location_type, booking_mode, payment_collector')
        .eq('artist_business_id', businessId).eq('is_active', true).order('created_at'),
    ]);
    if (serviceRows) setServices(serviceRows as ServiceRow[]);
    if (locationRows) setLocations(locationRows as LocationSummary[]);
    setSetupLoaded(true);
  }, [businessId, supabase]);

  useEffect(() => { void refreshSetup(); }, [refreshSetup, step]);

  useEffect(() => {
    navigate(`/onboarding/${step}`, { replace: true });
  }, [location.pathname, navigate, step]);

  useEffect(() => {
    if (!supabase || !handle) return;
    if (businessId && handle === originalHandle) {
      setHandleAvailable(true);
      setHandleMessage(t('onboarding.handleAvailable'));
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void supabase.rpc('mova_check_artist_handle', { p_handle: handle }).then(({ data, error: rpcError }) => {
        if (!active) return;
        if (rpcError) { setHandleMessage(t('onboarding.handleCheckFailed')); setHandleAvailable(false); return; }
        const result = Array.isArray(data) ? data[0] : data;
        const available = Boolean(result?.available);
        setHandleAvailable(available);
        setHandleMessage(available ? t('onboarding.handleAvailable') : t(`onboarding.handleStatus.${result?.reason ?? 'invalid'}`));
      });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [handle, businessId, originalHandle, supabase, t]);

  useEffect(() => {
    if (!photoFile) { setPhotoPreview(''); return; }
    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile]);

  const setProgress = async (next: Exclude<Step, 'welcome'> | 'complete', complete?: Exclude<Step, 'welcome'>) => {
    if (!supabase || !businessId) return;
    const { data: row } = await supabase.from('mova_onboarding_progress').select('completed_steps').eq('artist_business_id', businessId).maybeSingle();
    const completed = new Set<string>(row?.completed_steps ?? []);
    if (complete) completed.add(complete);
    const { error: updateError } = await supabase.from('mova_onboarding_progress').update({ current_step: next, completed_steps: [...completed] }).eq('artist_business_id', businessId);
    if (updateError) throw updateError;
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.sessionStorage.removeItem('mova_active_artist_business_id');
    window.sessionStorage.removeItem('mova_active_artist_business_display_id');
    window.sessionStorage.removeItem('mova_active_artist_business_id');
    window.sessionStorage.removeItem('mova_active_artist_business_display_id');
    setSignedIn(false); setBusinessId(''); setOriginalHandle('');
    navigate('/login', { replace: true });
  };

  const addSpecialty = () => {
    const value = specialtyDraft.trim().replace(/\s+/g, ' ');
    if (!value || specialties.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase()) || specialties.length >= 5) return;
    setSpecialties((current) => [...current, value]);
    setSpecialtyDraft('');
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setLoading(true);
    if (!supabase) { setError(t('onboarding.configurationError')); setLoading(false); return; }
    try {
      if (!businessId) {
        const { data, error: claimError } = await supabase.rpc('mova_claim_artist_profile', {
          p_display_name: displayName, p_handle: handle, p_specialties: specialties, p_bio: bio, p_preferred_locale: locale,
        });
        if (claimError) throw claimError;
        const claimed = Array.isArray(data) ? data[0] : data;
        if (!claimed?.artist_business_id) throw new Error('ARTIST_BUSINESS_MISSING');
        const { data: business, error: businessError } = await supabase.from('mova_artist_businesses')
          .select('business_number').eq('id', claimed.artist_business_id).maybeSingle();
        if (businessError || !business?.business_number) throw businessError ?? new Error('BUSINESS_DISPLAY_ID_MISSING');
        window.sessionStorage.setItem('mova_active_artist_business_id', claimed.artist_business_id);
        window.sessionStorage.setItem('mova_active_artist_business_display_id', displayId('BID', business.business_number));
        setBusinessId(claimed.artist_business_id);
      } else {
        const { error: profileError } = await supabase.rpc('mova_update_artist_profile', {
          p_artist_business_id: businessId, p_display_name: displayName, p_handle: handle,
          p_specialties: specialties, p_bio: bio, p_preferred_locale: locale,
        });
        if (profileError) throw profileError;
      }
      setStep('photo');
    } catch (saveError) {
      setError(errorMessage(saveError, t('onboarding.profileError')));
    } finally { setLoading(false); }
  };

  const continueWithoutPhoto = async () => {
    setError(''); setLoading(true);
    try { await setProgress('location', 'photo'); setStep('location'); }
    catch { setError(t('onboarding.saveProgressError')); }
    finally { setLoading(false); }
  };

  const selectPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setError('');
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError(t('onboarding.photoTooLarge')); return; }
    setPhotoFile(file);
  };

  const uploadPhoto = async () => {
    if (!supabase || !photoFile) return;
    setError(''); setLoading(true);
    try {
      const { data: upload, error: uploadError } = await supabase.functions.invoke('photo-upload-url', {
        body: { kind: 'profile', size: photoFile.size, contentType: photoFile.type, artist_business_id: businessId },
      });
      if (uploadError) throw uploadError;
      const path = upload?.data?.path;
      const token = upload?.data?.token;
      const bucket = upload?.data?.bucket;
      if (typeof path !== 'string' || typeof token !== 'string' || bucket !== 'mova_profile_photos') throw new Error('Upload URL response is invalid');
      const { error: storageError } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, photoFile, { contentType: photoFile.type });
      if (storageError) throw storageError;
      const { error: processError } = await supabase.functions.invoke('photo-process', { body: { path, kind: 'profile', zoom: photoZoom } });
      if (processError) throw processError;
      await setProgress('location', 'photo');
      setStep('location');
    } catch { setError(t('onboarding.photoUploadError')); }
    finally { setLoading(false); }
  };

  const continueTo = async (next: 'services' | 'payments', complete: 'location' | 'services') => {
    setLoading(true); setError('');
    try { await setProgress(next, complete); setStep(next); }
    catch { setError(t('onboarding.saveProgressError')); }
    finally { setLoading(false); }
  };

  // Last step: publish the page, then show the welcome screen while the account finishes setting up.
  const finishSetup = async () => {
    if (!supabase || !businessId) return;
    setError('');
    await setProgress('payments', 'payments').catch(() => undefined);
    const { error: publishError } = await supabase.rpc('mova_publish_artist_profile', { p_artist_business_id: businessId, p_search_index_enabled: searchIndexEnabled });
    if (publishError) { setError(t('onboarding.publishError')); return; }
    const { data: business } = await supabase.from('mova_artist_businesses').select('business_number').eq('id', businessId).maybeSingle();
    if (business?.business_number) {
      window.sessionStorage.setItem('mova_active_artist_business_id', businessId);
      window.sessionStorage.setItem('mova_active_artist_business_display_id', displayId('BID', business.business_number));
    }
    setStep('welcome');
  };

  const openWorkspacePath = (path: string) => {
    const target = operatorLocation(businessId, path);
    if (target.startsWith('https://')) window.location.assign(target); else navigate(target, { replace: true });
  };

  // Step 1 is the account step, now on /signup, so onboarding starts at 2.
  const current = stepOrder.indexOf(step) + 2;
  if (step === 'welcome') return <WelcomeStep name={firstName || displayName} handle={handle} locationName={locations[0]?.name ?? ''}
    onSettings={() => openWorkspacePath('settings')} onHome={() => openWorkspacePath('')} />;
  const previous = ({ photo: 'profile', location: 'photo', services: 'location', payments: 'services' } as Partial<Record<Step, Step>>)[step];
  return <div className="mova-onboarding-page">
    <header className="mova-onboarding-top">
      <div className="mova-onboarding-top__row">
        {previous && businessId
          ? <button type="button" className="mova-onboarding-top__back" aria-label={t('onboarding.back')} onClick={() => { setError(''); setAddingLocation(false); setAddingService(false); setStep(previous); }}><Icon name="back" size={22} /></button>
          : <span className="mova-onboarding-top__wordmark" aria-label="mova">mova</span>}
        <span className="mova-onboarding-top__step">{t('onboarding.stepOf', { current, total: 6 })}</span>
        {signedIn ? <button type="button" className="mova-onboarding-top__action" onClick={signOut}>{t('onboarding.signOut')}</button> : <span />}
      </div>
      <div className="mova-onboarding-top__bar" role="progressbar" aria-label={t('onboarding.stepOf', { current, total: 6 })} aria-valuemin={1} aria-valuemax={6} aria-valuenow={current}>
        {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < current ? 'is-done' : undefined} />)}
      </div>
    </header>
    <main className="mova-page mova-onboarding-content">
      {step === 'profile' && <form className="mova-form-stack" onSubmit={saveProfile}>
        <h1>{t('onboarding.profileTitle')}</h1>
        <p>{t('onboarding.profileDescription')}</p>
        <TextField label={t('onboarding.displayName')} autoComplete="name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
        <TextField label={t('onboarding.handleLabel')} required minLength={3} maxLength={30} pattern="[a-z0-9-]{3,30}" value={handle} onChange={(event) => { setHandle(event.currentTarget.value.toLowerCase()); setHandleMessage(''); setHandleAvailable(false); }} hint={`mova-beauty.co/a/${handle || ':handle'}`} />
        {handleMessage && <p role="status" aria-live="polite">{handleMessage}</p>}
        <fieldset className="mova-specialty-fieldset"><legend>{t('onboarding.specialties')} · {t('onboarding.upToFive')}</legend>
          <div className="mova-chip-list">{specialties.map((item) => <Chip key={item} selected onClick={() => setSpecialties((items) => items.filter((value) => value !== item))}>{item} ×</Chip>)}</div>
          <div className="mova-inline-field"><TextField label={t('onboarding.addSpecialty')} value={specialtyDraft} maxLength={40} disabled={specialties.length >= 5} onChange={(event) => setSpecialtyDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSpecialty(); } }} /><Button type="button" variant="secondary" disabled={!specialtyDraft.trim() || specialties.length >= 5} onClick={addSpecialty}>{t('onboarding.add')}</Button></div>
        </fieldset>
        <TextArea label={t('onboarding.bio')} maxLength={500} value={bio} onChange={(event) => setBio(event.currentTarget.value)} />
        {error && <p role="alert">{error}</p>}
        <Button type="submit" loading={loading} disabled={!handleAvailable || specialties.length < 1}>{t('onboarding.continue')}</Button>
      </form>}

      {step === 'photo' && <div className="mova-form-stack">
        <h1>{t('onboarding.photoTitle')}</h1>
        <p>{t('onboarding.photoDescription')}</p>
        {photoPreview ? <Card className="mova-photo-preview"><img src={photoPreview} alt={t('onboarding.photoPreviewAlt')} style={{ transform: `scale(${photoZoom})` }} /><span>{t('onboarding.cropPreview')}</span></Card> : <Card className="mova-photo-placeholder"><span aria-hidden="true">＋</span><strong>{t('onboarding.photoPlaceholder')}</strong><small>{t('onboarding.photoRequirements')}</small></Card>}
        {photoPreview && <label className="mova-zoom-control">{t('onboarding.zoom')}<input type="range" min="1" max="2" step="0.05" value={photoZoom} onChange={(event) => setPhotoZoom(Number(event.currentTarget.value))} /></label>}
        {error && <p role="alert">{error}</p>}
        <div className="mova-photo-actions">
          <Button type="button" variant="secondary" onClick={() => document.getElementById('onboarding-photo-camera')?.click()}>{t('onboarding.takePhoto')}</Button>
          <Button type="button" variant="secondary" onClick={() => document.getElementById('onboarding-photo')?.click()}>{t('onboarding.choosePhoto')}</Button>
        </div>
        <input id="onboarding-photo-camera" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="user" hidden onChange={selectPhoto} aria-label={t('onboarding.takePhoto')} />
        <input id="onboarding-photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={selectPhoto} aria-label={t('onboarding.choosePhoto')} />
        {photoFile && <Button type="button" loading={loading} onClick={uploadPhoto}>{t('onboarding.usePhoto')}</Button>}
        <Button type="button" loading={loading} variant="ghost" onClick={continueWithoutPhoto}>{t('onboarding.later')}</Button>
      </div>}

      {step === 'location' && <section className="mova-form-stack mova-onboarding-setup" aria-labelledby="onboarding-location-h">
        <h1 id="onboarding-location-h">{t('onboarding.locationTitle')}</h1>
        <p>{t('onboarding.locationDescription')}</p>
        {setupLoaded && (locations.length === 0 || addingLocation)
          ? <LocationNewPage embedded={{
            saveLabel: t('onboarding.saveLocation'),
            onSaved: () => { setAddingLocation(false); void refreshSetup(); },
            ...(locations.length ? { onCancel: () => setAddingLocation(false) } : {}),
          }} />
          : setupLoaded && <>
            <ul className="mova-onboarding-setup__list">{locations.map((item) => <li key={item.id}>
              <span className="mova-onboarding-setup__check" aria-hidden="true">✓</span>
              <span><strong>{item.name}</strong><small>{t(`scheduling.locationNew.kind.${item.location_type}`, { defaultValue: item.location_type })} · {t(`scheduling.mode.${item.booking_mode}`)}</small></span>
            </li>)}</ul>
            <Button type="button" variant="secondary" leadingIcon="plus" onClick={() => setAddingLocation(true)}>{t('onboarding.addAnotherLocation')}</Button>
            {error && <p role="alert">{error}</p>}
            <Button type="button" loading={loading} onClick={() => void continueTo('services', 'location')}>{t('onboarding.continue')}</Button>
          </>}
      </section>}

      {step === 'services' && <section className="mova-form-stack mova-onboarding-setup" aria-labelledby="onboarding-services-h">
        <h1 id="onboarding-services-h">{t('onboarding.servicesTitle')}</h1>
        <p>{t('onboarding.servicesDescription')}</p>
        {setupLoaded && (services.length === 0 || addingService)
          ? <ServiceSettingsPage embedded={{
            preselectLocationIds: locations.map((item) => item.id),
            onSaved: () => { setAddingService(false); void refreshSetup(); },
            ...(services.length ? { onCancel: () => setAddingService(false) } : {}),
          }} />
          : setupLoaded && <>
            <ul className="mova-onboarding-setup__list">{services.map((service) => <li key={service.id}>
              <span className="mova-onboarding-setup__check" aria-hidden="true">✓</span>
              <span><strong>{service.name}</strong><small>{service.duration_minutes} {t('onboarding.minutes')} · {formatMoney(service.base_price_minor)}</small></span>
            </li>)}</ul>
            <Button type="button" variant="secondary" leadingIcon="plus" onClick={() => setAddingService(true)}>{t('onboarding.addAnotherService')}</Button>
            {error && <p role="alert">{error}</p>}
            <Button type="button" loading={loading} onClick={() => void continueTo('payments', 'services')}>{t('onboarding.continue')}</Button>
          </>}
      </section>}

      {step === 'payments' && <section className="mova-form-stack mova-onboarding-setup" aria-labelledby="onboarding-payments-h">
        <h1 id="onboarding-payments-h">{t('onboarding.paymentsTitle')}</h1>
        <p>{t('onboarding.paymentsDescription')}</p>
        <PaymentSettingsPage embedded={{ continueLabel: t('onboarding.finishSetup'), onContinue: finishSetup }} />
        {error && <p role="alert">{error}</p>}
      </section>}
    </main>
  </div>;
}

function routeStep(pathname: string): Step {
  const segment = pathname.split('/').filter(Boolean).at(-1);
  if (segment === 'publish') return 'payments';
  return segment && stepOrder.includes(segment as Step) ? segment as Step : 'profile';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amountMinor / 100);
}
