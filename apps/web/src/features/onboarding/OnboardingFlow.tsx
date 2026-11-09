import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, StepperProgress, TextArea, TextField } from '../../components';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { operatorLocation } from '../../app/operator-url';
import { displayId } from '../../lib/display-ids';
import { useLocale } from '../../app/LocaleProvider';

type Step = 'profile' | 'photo' | 'services' | 'publish';
const stepOrder: Step[] = ['profile', 'photo', 'services', 'publish'];
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
  const [serviceName, setServiceName] = useState('');
  const [serviceCategory, setServiceCategory] = useState('');
  const [serviceDuration, setServiceDuration] = useState('');
  const [serviceBuffer, setServiceBuffer] = useState('0');
  const [servicePrice, setServicePrice] = useState('');
  const [depositType, setDepositType] = useState<'none' | 'fixed' | 'percent'>('none');
  const [depositValue, setDepositValue] = useState('');
  const [searchIndexEnabled, setSearchIndexEnabled] = useState(true);

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
        const mapped = progress.current_step === 'location' || progress.current_step === 'payments' ? 'publish' : progress.current_step;
        if (mapped === 'profile' || mapped === 'photo' || mapped === 'services' || mapped === 'publish') setStep(mapped);
      }
    })();
    return () => { active = false; };
  }, [location.pathname, navigate, supabase]);

  useEffect(() => {
    if (!supabase || !businessId) return;
    let active = true;
    void supabase.from('mova_services').select('id, name, category, duration_minutes, buffer_minutes, base_price_minor, deposit_type, deposit_value')
      .eq('artist_business_id', businessId).order('created_at')
      .then(({ data }) => { if (active && data) setServices(data as ServiceRow[]); });
    return () => { active = false; };
  }, [businessId, supabase]);

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

  const setProgress = async (next: Step | 'location' | 'payments', complete?: Step | 'location' | 'payments') => {
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
    try { await setProgress('services', 'photo'); setStep('services'); }
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
        body: { kind: 'profile', size: photoFile.size, contentType: photoFile.type },
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
      await setProgress('services', 'photo');
      setStep('services');
    } catch { setError(t('onboarding.photoUploadError')); }
    finally { setLoading(false); }
  };

  const addService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !businessId) { setError(t('onboarding.configurationError')); return; }
    setError(''); setLoading(true);
    const basePrice = parseMinorUnits(servicePrice);
    const parsedDeposit = parseMinorUnits(depositValue);
    if (basePrice === null || (depositType === 'fixed' && parsedDeposit === null) ||
      (depositType === 'percent' && (parsedDeposit === null || parsedDeposit < 1 || parsedDeposit > 10_000))) {
      setError(t('onboarding.serviceValuesInvalid')); setLoading(false); return;
    }
    const { data, error: insertError } = await supabase.from('mova_services').insert({
      artist_business_id: businessId, name: serviceName.trim(), category: serviceCategory.trim(),
      duration_minutes: Number(serviceDuration), buffer_minutes: Number(serviceBuffer), base_price_minor: basePrice,
      status: 'active', deposit_type: depositType, deposit_value: parsedDeposit ?? 0,
    }).select('id, name, category, duration_minutes, buffer_minutes, base_price_minor, deposit_type, deposit_value').single();
    if (insertError) setError(t('onboarding.serviceSaveError'));
    else if (data) {
      setServices((rows) => [...rows, data as ServiceRow]);
      setServiceName(''); setServiceCategory(''); setServiceDuration(''); setServiceBuffer('0'); setServicePrice(''); setDepositValue(''); setDepositType('none');
    }
    setLoading(false);
  };

  const continueServices = async () => {
    if (!supabase || !businessId) return;
    setLoading(true); setError('');
    try { await setProgress('location', 'services'); setStep('publish'); }
    catch { setError(t('onboarding.saveProgressError')); }
    finally { setLoading(false); }
  };

  const publish = async () => {
    if (!supabase || !businessId) return;
    setError(''); setLoading(true);
    try {
      const { error: publishError } = await supabase.rpc('mova_publish_artist_profile', { p_artist_business_id: businessId, p_search_index_enabled: searchIndexEnabled });
      if (publishError) throw publishError;
      const { data: business } = await supabase.from('mova_artist_businesses').select('business_number').eq('id',businessId).maybeSingle();
      if (!business?.business_number) throw new Error('BUSINESS_DISPLAY_ID_MISSING');
      window.sessionStorage.setItem('mova_active_artist_business_id',businessId);
      window.sessionStorage.setItem('mova_active_artist_business_display_id',displayId('BID',business.business_number));
      const target=operatorLocation(businessId,'');
      if(target.startsWith('https://'))window.location.assign(target);else navigate(target,{replace:true});
    } catch { setError(t('onboarding.publishError')); }
    finally { setLoading(false); }
  };

  // Step 1 is the account step, now on /signup, so onboarding starts at 2.
  const current = step === 'publish' ? 6 : stepOrder.indexOf(step) + 2;
  return <div className="mova-onboarding-page">
    <header className="mova-onboarding-header">
      <span className="mova-wordmark" aria-label="mova">mova</span>
      <p>{t('onboarding.tagline')}</p>
      {signedIn && <Button type="button" variant="on-dark" onClick={signOut}>{t('onboarding.signOut')}</Button>}
    </header>
    <main className="mova-page mova-onboarding-content">
      <StepperProgress current={current} total={6} label={t('onboarding.step')} />
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

      {step === 'services' && <section className="mova-form-stack">
        <h1>{t('onboarding.servicesTitle')}</h1>
        <p>{t('onboarding.servicesDescription')}</p>
        <ul className="mova-service-list">{services.map((service) => <li key={service.id}>
          <strong>{service.name}</strong>
          <span>{service.duration_minutes} {t('onboarding.minutes')} · {formatMoney(service.base_price_minor)}</span>
          <small>{service.deposit_type === 'none' ? t('onboarding.noDeposit') : `${t('onboarding.deposit')}: ${service.deposit_type === 'fixed' ? formatMoney(service.deposit_value) : `${service.deposit_value / 100}%`}`}</small>
        </li>)}</ul>
        <form className="mova-form-stack mova-service-form" onSubmit={addService}>
          <TextField label={t('onboarding.serviceName')} required maxLength={100} value={serviceName} onChange={(event) => setServiceName(event.currentTarget.value)} />
          <TextField label={t('onboarding.serviceCategory')} required maxLength={80} value={serviceCategory} onChange={(event) => setServiceCategory(event.currentTarget.value)} />
          <div className="mova-service-numbers">
            <TextField label={t('onboarding.duration')} type="number" min="5" max="1440" step="5" required value={serviceDuration} onChange={(event) => setServiceDuration(event.currentTarget.value)} />
            <TextField label={t('onboarding.buffer')} type="number" min="0" max="1440" step="5" required value={serviceBuffer} onChange={(event) => setServiceBuffer(event.currentTarget.value)} />
          </div>
          <TextField label={t('onboarding.price')} inputMode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required value={servicePrice} onChange={(event) => setServicePrice(event.currentTarget.value)} />
          <label className="mova-field"><span className="mova-field__label">{t('onboarding.deposit')}</span><select className="mova-input" value={depositType} onChange={(event) => setDepositType(event.currentTarget.value as typeof depositType)}><option value="none">{t('onboarding.noDeposit')}</option><option value="fixed">{t('onboarding.fixedDeposit')}</option><option value="percent">{t('onboarding.percentDeposit')}</option></select></label>
          {depositType !== 'none' && <TextField label={depositType === 'fixed' ? t('onboarding.depositAmount') : t('onboarding.depositPercent')} inputMode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required value={depositValue} onChange={(event) => setDepositValue(event.currentTarget.value)} />}
          {error && <p role="alert">{error}</p>}
          <Button type="submit" loading={loading}>{t('onboarding.addService')}</Button>
        </form>
        <p>{t('onboarding.locationOverridesLater')}</p>
        {error && services.length > 0 && <p role="alert">{error}</p>}
        <Button type="button" loading={loading} onClick={continueServices}>{t('onboarding.continue')}</Button>
      </section>}

      {step === 'publish' && <div className="mova-form-stack">
        <h1>{t('onboarding.publishTitle')}</h1>
        <Card><h2>{displayName}</h2><p>{handle ? `/${handle}` : ''}</p><p>{specialties.join(' · ')}</p>{bio && <p>{bio}</p>}</Card>
        <ul className="mova-setup-checklist"><li>{t('onboarding.profileSaved')}</li><li>{t('onboarding.photoOptional')}</li><li>{services.length} {t('onboarding.servicesConfigured')}</li><li>{t('onboarding.bookingLater')}</li></ul>
        <label className="mova-check-row"><input type="checkbox" checked={searchIndexEnabled} onChange={(event) => setSearchIndexEnabled(event.currentTarget.checked)} /><span>{t('onboarding.searchIndex')}</span></label>
        {error && <p role="alert">{error}</p>}
        <Button type="button" loading={loading} onClick={publish}>{t('onboarding.publish')}</Button>
      </div>}
    </main>
  </div>;
}

function routeStep(pathname: string): Step {
  const segment = pathname.split('/').filter(Boolean).at(-1);
  return segment && stepOrder.includes(segment as Step) ? segment as Step : 'profile';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

function parseMinorUnits(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(`${match[2] ?? ''}00`.slice(0, 2));
  const amount = Number(match[1]) * 100 + cents;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amountMinor / 100);
}
