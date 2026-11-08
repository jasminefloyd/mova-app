import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button, Chip, ErrorState, ScreenHeader, TextArea, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Profile = { display_name: string; bio: string; specialties: string[]; handle: string; preferred_locale: 'en-US' | 'es-US'; profile_photo_path: string | null; cover_photo_path: string | null };
type Looks = { total: number; shown: number; thumbs: string[] };
type Draft = { displayName: string; handle: string; bio: string; specialties: string[] };

export const BIO_LIMIT = 280;
export const SPECIALTY_LIMIT = 5;
const PRESET_KEYS = ['silkPress', 'naturalHair', 'braids', 'locs', 'color', 'cuts', 'wigs', 'kids'] as const;
const HANDLE_PATTERN = /^[a-z0-9-]{3,30}$/;

/** Maps an RPC error from mova_update_artist_profile to a handle message key, or null for other errors. */
export function handleErrorKey(message: string | undefined): 'reserved' | 'taken' | 'invalid' | null {
  if (message?.includes('HANDLE_RESERVED')) return 'reserved';
  if (message?.includes('HANDLE_TAKEN')) return 'taken';
  if (message?.includes('HANDLE_INVALID')) return 'invalid';
  return null;
}

/** Selected specialties first, then presets, with case-insensitive de-duplication. */
export function specialtyOptions(selected: string[], presets: string[]) {
  const seen = new Set<string>();
  return [...selected, ...presets].filter((item) => { const key = item.toLocaleLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

async function signed(client: SupabaseClient, bucket: string, path: string | null) {
  if (!path) return null;
  const { data } = await client.storage.from(bucket).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export function ProfileSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [looks, setLooks] = useState<Looks | null>(null);
  const [draft, setDraft] = useState<Draft>({ displayName: '', handle: '', bio: '', specialties: [] });
  const [photo, setPhoto] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [handleError, setHandleError] = useState<'reserved' | 'taken' | 'invalid' | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoadError(false);
    const [{ data, error }, items] = await Promise.all([
      client.from('mova_artist_profiles').select('display_name,bio,specialties,handle,preferred_locale,profile_photo_path,cover_photo_path').eq('artist_business_id', businessId).maybeSingle(),
      client.from('mova_portfolio_items').select('media_path,is_published,sort_order').eq('artist_business_id', businessId).order('sort_order'),
    ]);
    if (error || !data) { setLoadError(true); return; }
    const value = data as Profile;
    setProfile(value);
    setDraft({ displayName: value.display_name, handle: value.handle, bio: value.bio ?? '', specialties: value.specialties ?? [] });
    const rows = (items.data ?? []) as { media_path: string; is_published: boolean }[];
    const [photoSigned, coverSigned, ...thumbs] = await Promise.all([
      signed(client, 'mova_profile_photos', value.profile_photo_path),
      signed(client, 'mova_profile_photos', value.cover_photo_path),
      ...rows.slice(0, 3).map((row) => signed(client, 'mova_portfolio_media', row.media_path)),
    ]);
    setPhotoUrl(photoSigned); setCoverUrl(coverSigned);
    setLooks({ total: rows.length, shown: rows.filter((row) => row.is_published).length, thumbs: thumbs.filter((url): url is string => Boolean(url)) });
  }, [businessId, client]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  const presets = useMemo(() => PRESET_KEYS.map((key) => t(`settings.specialtyPresets.${key}`)), [t]);
  const options = specialtyOptions(profile?.specialties ?? [], presets);
  const full = draft.specialties.length >= SPECIALTY_LIMIT;
  const dirty = Boolean(profile) && (photo !== null || cover !== null || draft.displayName !== profile?.display_name || draft.handle !== profile?.handle
    || draft.bio !== (profile?.bio ?? '') || !sameList(draft.specialties, profile?.specialties ?? []));
  const valid = draft.displayName.trim().length > 0 && HANDLE_PATTERN.test(draft.handle) && draft.specialties.length >= 1 && draft.bio.length <= BIO_LIMIT;

  const edit = (patch: Partial<Draft>) => { setSaved(false); setDraft((old) => ({ ...old, ...patch })); };
  const toggleSpecialty = (item: string) => {
    const on = draft.specialties.includes(item);
    if (on) edit({ specialties: draft.specialties.filter((value) => value !== item) });
    else if (!full) edit({ specialties: [...draft.specialties, item] });
  };

  const upload = async (file: File, kind: 'profile' | 'cover') => {
    if (!client) return;
    const { data: result, error: requestError } = await client.functions.invoke('photo-upload-url', { body: { kind, size: file.size, contentType: file.type } });
    if (requestError) throw requestError;
    const target = result?.data;
    if (typeof target?.path !== 'string' || typeof target?.token !== 'string' || target.bucket !== 'mova_profile_photos') throw new Error('UPLOAD_RESPONSE_INVALID');
    const { error: storageError } = await client.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
    if (storageError) throw storageError;
    const { error: processError } = await client.functions.invoke('photo-process', { body: { path: target.path, kind, zoom: 1 } });
    if (processError) throw processError;
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !businessId || !profile || !dirty || !valid) return;
    setBusy(true); setSaveError(false); setHandleError(null); setSaved(false);
    try {
      // Handle changes go through the 0038 function, which keeps the reserved-handle and uniqueness checks.
      const { error } = await client.rpc('mova_update_artist_profile', {
        p_artist_business_id: businessId, p_display_name: draft.displayName.trim(), p_handle: draft.handle,
        p_specialties: draft.specialties, p_bio: draft.bio, p_preferred_locale: profile.preferred_locale,
      });
      if (error) {
        const key = handleErrorKey(error.message);
        if (key) { setHandleError(key); return; }
        throw error;
      }
      if (photo) await upload(photo, 'profile');
      if (cover) await upload(cover, 'cover');
      setPhoto(null); setCover(null); setPhotoPreview(null); setCoverPreview(null); setSaved(true);
      await load();
    } catch { setSaveError(true); } finally { setBusy(false); }
  };

  const pick = (kind: 'profile' | 'cover') => (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setSaved(false);
    if (kind === 'profile') { if (photoPreview) URL.revokeObjectURL(photoPreview); setPhoto(next); setPhotoPreview(next ? URL.createObjectURL(next) : null); }
    else { if (coverPreview) URL.revokeObjectURL(coverPreview); setCover(next); setCoverPreview(next ? URL.createObjectURL(next) : null); }
  };

  if (identityLoading) return <main className="mova-page"><p role="status">{t('settings.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page"><ErrorState title={t('settings.identityError')} retryLabel={t('settings.retry')} onRetry={() => void load()} /></main>;
  const accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
  const coverImage = coverPreview ?? coverUrl;
  const avatar = photoPreview ?? photoUrl;
  return <main className="mova-page mova-settings-page mova-profile-edit">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('settings.close')}
      trailing={<Link className="mova-profile-edit__preview" to={operatorUrl(businessId, 'settings/profile/preview')}>{t('settings.preview')}</Link>} />
    <h1>{t('settings.profileEditTitle')}</h1>
    {loadError && <ErrorState title={t('settings.saveError')} retryLabel={t('settings.retry')} onRetry={() => void load()} />}
    {profile && <form className="mova-form-stack" onSubmit={(event) => void save(event)}>
      <section className="mova-profile-edit__photos" aria-label={t('settings.photos')}>
        <div className="mova-profile-edit__cover" role="img" aria-label={t('settings.coverPhoto')} style={coverImage ? { backgroundImage: `url("${coverImage}")` } : undefined}>
          <label className="mova-profile-edit__cover-button">{t('settings.changeCover')}<input type="file" accept={accept} onChange={pick('cover')} /></label>
        </div>
        <div className="mova-profile-edit__avatar-row">
          <span className="mova-profile-edit__avatar">{avatar && <img src={avatar} alt={t('settings.profilePhotoAlt', { name: draft.displayName || profile.display_name })} />}</span>
          <label className="mova-button mova-button--secondary mova-profile-edit__photo-button">{t('settings.changeProfilePhoto')}<input type="file" accept={accept} onChange={pick('profile')} /></label>
        </div>
      </section>

      <TextField label={t('settings.nameClientsSee')} required maxLength={80} value={draft.displayName} onChange={(event) => edit({ displayName: event.currentTarget.value })} />

      <label className="mova-field mova-profile-edit__handle">
        <span className="mova-field__label">{t('onboarding.handleLabel')}</span>
        <span className={`mova-input mova-profile-edit__handle-box${handleError ? ' is-invalid' : ''}`}>
          <span aria-hidden="true">{t('settings.handlePrefix')}</span>
          <input aria-label={t('onboarding.handleLabel')} value={draft.handle} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(handleError)} aria-describedby="profile-handle-note"
            onChange={(event) => { setHandleError(null); edit({ handle: event.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }); }} />
        </span>
        {handleError ? <span className="mova-field__error" id="profile-handle-note" role="alert">{t(`onboarding.handleStatus.${handleError}`)}</span>
          : <span className="mova-field__hint" id="profile-handle-note">{draft.handle !== profile.handle ? t('settings.handleChangeWarning') : t('settings.handleWarning')}</span>}
      </label>

      <TextArea label={t('onboarding.bio')} maxLength={BIO_LIMIT} rows={3} value={draft.bio} onChange={(event) => edit({ bio: event.currentTarget.value })} />

      <fieldset className="mova-specialty-fieldset">
        <legend>{t('onboarding.specialties')} <span>· {t('settings.specialtyCount', { count: draft.specialties.length, limit: SPECIALTY_LIMIT })}</span></legend>
        <div className="mova-chip-list">{options.map((item) => {
          const on = draft.specialties.includes(item);
          return <Chip key={item} selected={on} disabled={!on && full} onClick={() => toggleSpecialty(item)}>{item}</Chip>;
        })}</div>
      </fieldset>

      <Link className="mova-card mova-profile-edit__looks" to={operatorUrl(businessId, 'settings/portfolio')}>
        <span className="mova-profile-edit__looks-head">
          <span><strong>{t('settings.portfolio')}</strong><small>{looks ? t('settings.looksSummary', { count: looks.total, shown: looks.shown }) : ''}</small></span>
          <span className="mova-profile-edit__manage">{t('settings.manage')}</span>
        </span>
        {looks && looks.total > 0 && <span className="mova-profile-edit__thumbs" aria-hidden="true">
          {looks.thumbs.map((url) => <img key={url} src={url} alt="" />)}
          {looks.total > 3 && <span>+{looks.total - 3}</span>}
        </span>}
      </Link>

      {saveError && <p role="alert">{t('settings.saveError')}</p>}
      {saved && <p role="status" className="mova-visually-hidden">{t('settings.profileSaved')}</p>}
      <footer className="mova-profile-edit__actions">
        <Button type="submit" loading={busy} disabled={!dirty || !valid}>{saved && !dirty ? t('settings.savedShort') : t('settings.saveProfile')}</Button>
      </footer>
    </form>}
  </main>;
}

export default ProfileSettingsPage;
