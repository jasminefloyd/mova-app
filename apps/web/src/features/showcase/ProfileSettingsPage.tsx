import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, ErrorState, ScreenHeader, TextArea, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Profile = { display_name: string; bio: string; specialties: string[]; handle: string; preferred_locale: 'en-US' | 'es-US'; profile_photo_path: string | null; photo_url: string | null };

export function ProfileSettingsPage() {
  const { t } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtyDraft, setSpecialtyDraft] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setError(false);
    const { data, error: readError } = await client.from('mova_artist_profiles')
      .select('display_name,bio,specialties,handle,preferred_locale,profile_photo_path')
      .eq('artist_business_id', businessId).maybeSingle();
    if (readError || !data) { setError(true); return; }
    const value = data as Omit<Profile, 'photo_url'>;
    const { data: signed } = value.profile_photo_path
      ? await client.storage.from('mova_profile_photos').createSignedUrl(value.profile_photo_path, 300)
      : { data: null };
    setProfile({ ...value, photo_url: signed?.signedUrl ?? null }); setDisplayName(value.display_name); setBio(value.bio ?? ''); setSpecialties(value.specialties ?? []);
  }, [businessId, client]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  const addSpecialty = () => {
    const value = specialtyDraft.trim();
    if (!value || specialties.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase()) || specialties.length >= 5) return;
    setSpecialties((items) => [...items, value]); setSpecialtyDraft('');
  };
  const uploadPhoto = async () => {
    if (!client || !photo || !businessId) return;
    const { data: result, error: requestError } = await client.functions.invoke('photo-upload-url', {
      body: { kind: 'profile', size: photo.size, contentType: photo.type },
    });
    if (requestError) throw requestError;
    const upload = result?.data;
    if (typeof upload?.path !== 'string' || typeof upload?.token !== 'string' || upload.bucket !== 'mova_profile_photos') throw new Error('UPLOAD_RESPONSE_INVALID');
    const { error: storageError } = await client.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, photo, { contentType: photo.type });
    if (storageError) throw storageError;
    const { error: processError } = await client.functions.invoke('photo-process', { body: { path: upload.path, kind: 'profile', zoom: 1 } });
    if (processError) throw processError;
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !businessId || !profile || specialties.length < 1) return;
    setBusy(true); setError(false); setSaved(false);
    try {
      if (photo) await uploadPhoto();
      const { error: updateError } = await client.rpc('mova_update_artist_profile', {
        p_artist_business_id: businessId, p_display_name: displayName.trim(), p_handle: profile.handle,
        p_specialties: specialties, p_bio: bio, p_preferred_locale: profile.preferred_locale,
      });
      if (updateError) throw updateError;
      setPhoto(null); setPhotoPreview(null); setSaved(true); await load();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const selectPhoto = (event: ChangeEvent<HTMLInputElement>) => { if (photoPreview) URL.revokeObjectURL(photoPreview); const next = event.currentTarget.files?.[0] ?? null; setPhoto(next); setPhotoPreview(next ? URL.createObjectURL(next) : null); event.currentTarget.value = ''; };

  if (identityLoading) return <main className="mova-page"><p role="status">{t('settings.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page"><ErrorState title={t('settings.identityError')} retryLabel={t('settings.retry')} onRetry={() => void load()} /></main>;
  return <main className="mova-page mova-settings-page">
    <ScreenHeader title={t('settings.profileEditTitle')} />
    <h1>{t('settings.profileEditTitle')}</h1>
    {error && <ErrorState title={t('settings.saveError')} retryLabel={t('settings.retry')} onRetry={() => void load()} />}
    {profile && <form className="mova-form-stack" onSubmit={(event) => void save(event)}>
      <Card className="mova-profile-edit-photo">
        {(photoPreview || profile.photo_url) && <img src={photoPreview ?? profile.photo_url ?? ''} alt={profile.display_name} />}
        <label className="mova-field"><span className="mova-field__label">{t('settings.profilePhoto')}</span><input className="mova-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={selectPhoto} /></label>
      </Card>
      <TextField label={t('onboarding.displayName')} required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
      <TextArea label={t('onboarding.bio')} maxLength={500} value={bio} onChange={(event) => setBio(event.currentTarget.value)} />
      <fieldset className="mova-specialty-fieldset"><legend>{t('onboarding.specialties')} · {t('onboarding.upToFive')}</legend>
        <div className="mova-chip-list">{specialties.map((item) => <Chip key={item} selected onClick={() => setSpecialties((values) => values.filter((value) => value !== item))}>{item} ×</Chip>)}</div>
        <div className="mova-inline-field"><TextField label={t('onboarding.addSpecialty')} value={specialtyDraft} maxLength={40} disabled={specialties.length >= 5} onChange={(event) => setSpecialtyDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSpecialty(); } }} /><Button type="button" variant="secondary" disabled={!specialtyDraft.trim() || specialties.length >= 5} onClick={addSpecialty}>{t('onboarding.add')}</Button></div>
      </fieldset>
      <div className="mova-photo-actions"><Button type="submit" loading={busy} disabled={!displayName.trim() || specialties.length < 1}>{t('settings.saveProfile')}</Button><Link to={operatorUrl(businessId, 'settings/portfolio')}>{t('settings.managePortfolio')}</Link></div>
      {saved && <p role="status">{t('settings.profileSaved')}</p>}
    </form>}
  </main>;
}

export default ProfileSettingsPage;
