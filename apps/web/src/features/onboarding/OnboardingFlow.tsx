import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, StepperProgress, TextArea, TextField } from '../../components';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { operatorLocation } from '../../app/operator-url';
import { displayId, parseDisplayId } from '../../lib/display-ids';

type Step = 'account' | 'profile' | 'photo' | 'services' | 'publish';
const stepOrder: Step[] = ['account', 'profile', 'photo', 'services', 'publish'];
type ServiceRow = { id: string; name: string; category: string; duration_minutes: number; buffer_minutes: number; base_price_minor: number; deposit_type: 'none' | 'fixed' | 'percent'; deposit_value: number };
type WorkspaceChoice = { id: string; label: string };

export function OnboardingFlow() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const supabase = useMemo(() => {
    try { return createMovaSupabaseClient(); } catch { return null; }
  }, []);
  const [step, setStep] = useState<Step>(routeStep(location.pathname));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteOnlyError, setInviteOnlyError] = useState(false);
  const [notice, setNotice] = useState('');
  const [signIn, setSignIn] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    if (location.pathname === '/auth' && nextStep === 'account') return;
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active || !session) return;
      setSignedIn(true);
      setEmail(session.user.email ?? '');
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
      if (progress?.current_step && progress.current_step !== 'complete') {
        const mapped = progress.current_step === 'location' || progress.current_step === 'payments' ? 'publish' : progress.current_step;
        if (mapped === 'profile' || mapped === 'photo' || mapped === 'services' || mapped === 'publish') setStep(mapped);
      }
    })();
    return () => { active = false; };
  }, [location.pathname, supabase]);

  useEffect(() => {
    if (!supabase || !businessId) return;
    let active = true;
    void supabase.from('mova_services').select('id, name, category, duration_minutes, buffer_minutes, base_price_minor, deposit_type, deposit_value')
      .eq('artist_business_id', businessId).order('created_at')
      .then(({ data }) => { if (active && data) setServices(data as ServiceRow[]); });
    return () => { active = false; };
  }, [businessId, supabase]);

  useEffect(() => {
    if (location.pathname === '/auth' && step === 'account') return;
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

  const submitAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(''); setNotice('');
    setInviteOnlyError(false);
    if (!supabase) { setError(t('onboarding.configurationError')); return; }
    if (password.length < 9) { setError(t('onboarding.passwordRule')); return; }
    setLoading(true);
    try {
      if (signIn) {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const returnTo = new URLSearchParams(location.search).get('returnTo') ?? '';
          const requestedId = returnTo.match(/^\/([^/]+)(?:\/|$)/)?.[1];
          let requestedBusinessId = requestedId ? decodeURIComponent(requestedId) : null;
          const requestedNumber = parseDisplayId('BID', requestedBusinessId ?? undefined);
          if (requestedNumber) {
            const { data: requestedBusiness } = await supabase.from('mova_artist_businesses').select('id').eq('business_number', requestedNumber).maybeSingle();
            requestedBusinessId = requestedBusiness?.id ?? null;
          }
          let membershipQuery = supabase.from('mova_artist_memberships').select('artist_business_id').eq('user_id',session.user.id).eq('status','active');
          if (requestedId) membershipQuery = membershipQuery.eq('artist_business_id',requestedBusinessId ?? '00000000-0000-0000-0000-000000000000');
          const { data: memberships, error: membershipError } = await membershipQuery.limit(requestedId ? 1 : 100);
          if (membershipError) throw membershipError;
          if (requestedId && !memberships?.length) throw new Error('WORKSPACE_ACCESS_DENIED');
          if (memberships?.length === 1) {
            const membership = memberships[0];
            if (membership) void chooseWorkspace(membership.artist_business_id, returnTo);
            return;
          }
          if ((memberships?.length ?? 0) > 1) {
            const ids=memberships!.map((item)=>item.artist_business_id);
            const {data:profiles}=await supabase.from('mova_artist_profiles').select('artist_business_id,display_name').in('artist_business_id',ids);
            setWorkspaces(ids.map((id)=>({id,label:profiles?.find((profile)=>profile.artist_business_id===id)?.display_name??id})));
            return;
          }
        }
        setSignedIn(true);
        setStep('profile');
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/onboarding/profile`, data: { preferred_locale: 'en-US' } },
        });
        if (authError?.message === 'Mova is invite-only for now; join the waitlist.') {
          setError(t('onboarding.inviteOnlyError'));
          setInviteOnlyError(true);
          return;
        }
        if (authError) throw authError;
        if (data.session) { setSignedIn(true); setStep('profile'); }
        else setNotice(t('onboarding.verifyEmail'));
      }
    } catch { setError(t('onboarding.accountError')); }
    finally { setLoading(false); }
  };

  const chooseWorkspace = async (id: string, returnTo = '') => {
    if (!supabase) return;
    const { data: business } = await supabase.from('mova_artist_businesses').select('business_number').eq('id',id).maybeSingle();
    if (!business?.business_number) { setError(t('onboarding.accountError')); return; }
    const routeId = displayId('BID', business.business_number);
    window.sessionStorage.setItem('mova_active_artist_business_id',id);
    window.sessionStorage.setItem('mova_active_artist_business_display_id',routeId);
    const prefix=`/${encodeURIComponent(routeId)}`;
    const legacyPrefix=`/${encodeURIComponent(id)}`;
    const matchedPrefix=returnTo===prefix||returnTo===`${prefix}/`?prefix:returnTo.startsWith(`${prefix}/`)?prefix:returnTo===legacyPrefix||returnTo===`${legacyPrefix}/`?legacyPrefix:returnTo.startsWith(`${legacyPrefix}/`)?legacyPrefix:'';
    const path=matchedPrefix?(returnTo===matchedPrefix||returnTo===`${matchedPrefix}/`?'':returnTo.slice(matchedPrefix.length+1)):'';
    const target=operatorLocation(id,path);
    if(target.startsWith('https://'))window.location.assign(target);else navigate(target,{replace:true});
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.sessionStorage.removeItem('mova_active_artist_business_id');
    window.sessionStorage.removeItem('mova_active_artist_business_display_id');
    window.sessionStorage.removeItem('mova_active_artist_business_id');
    window.sessionStorage.removeItem('mova_active_artist_business_display_id');
    setSignedIn(false); setBusinessId(''); setOriginalHandle('');
    setStep('account'); setSignIn(false);
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
          p_display_name: displayName, p_handle: handle, p_specialties: specialties, p_bio: bio, p_preferred_locale: 'en-US',
        });
        if (claimError) throw claimError;
        const claimed = Array.isArray(data) ? data[0] : data;
        setBusinessId(claimed.artist_business_id);
      } else {
        const { error: profileError } = await supabase.rpc('mova_update_artist_profile', {
          p_artist_business_id: businessId, p_display_name: displayName, p_handle: handle,
          p_specialties: specialties, p_bio: bio, p_preferred_locale: 'en-US',
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

  const current = step === 'publish' ? 6 : stepOrder.indexOf(step) + 1;
  return <div className="mova-onboarding-page">
    <header className="mova-onboarding-header">
      <span className="mova-wordmark" aria-label="mova">mova.</span>
      <p>{t('onboarding.tagline')}</p>
      {signedIn && <Button type="button" variant="on-dark" onClick={signOut}>{t('onboarding.signOut')}</Button>}
    </header>
    <main className="mova-page mova-onboarding-content">
      <StepperProgress current={current} total={6} label={t('onboarding.step')} />
      {step === 'account' && <form className="mova-form-stack" onSubmit={submitAccount}>
        <h1>{t(signIn ? 'onboarding.signInTitle' : 'onboarding.accountTitle')}</h1>
        <TextField label={t('onboarding.email')} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
        <TextField label={t('onboarding.password')} type="password" autoComplete={signIn ? 'current-password' : 'new-password'} required value={password} onChange={(event) => setPassword(event.currentTarget.value)} hint={t('onboarding.passwordRule')} />
        {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}{inviteOnlyError && <> <Link to="/">{t('onboarding.joinWaitlist')}</Link></>}</p>}
        <Button type="submit" loading={loading}>{t(signIn ? 'onboarding.signIn' : 'onboarding.createAccount')}</Button>
        {!signIn && <p className="mova-form-note">{t('onboarding.verifyEmail')}</p>}
        <p className="mova-form-note">{t(signIn ? 'onboarding.noAccount' : 'onboarding.haveAccount')} <button type="button" className="mova-link-button" onClick={() => setSignIn((current) => !current)}>{t(signIn ? 'onboarding.createAccount' : 'onboarding.signIn')}</button></p>
        {workspaces.length>0&&<section aria-label={t('onboarding.chooseWorkspace')}><h2>{t('onboarding.chooseWorkspace')}</h2>{workspaces.map((workspace)=><Button key={workspace.id} type="button" variant="secondary" onClick={()=>void chooseWorkspace(workspace.id,new URLSearchParams(location.search).get('returnTo')??'')}>{workspace.label}</Button>)}</section>}
      </form>}

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
  return segment && stepOrder.includes(segment as Step) ? segment as Step : 'account';
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
