import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, ErrorState, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { GoogleActionError, invokeGoogle } from '../google/googleApi';
import './cover-picker.css';

// Board 16f: choose a profile cover from free Unsplash photos, or upload one. Photos come from the
// profile-cover function, which keeps the credit and the download call on the server.
export type CoverPhoto = { id: string; alt: string; thumbUrl: string; imageUrl: string; photographerName: string; photographerUrl: string; photoUrl: string };

export const UNSPLASH_HOME = 'https://unsplash.com/?utm_source=mova&utm_medium=referral';
export const COVER_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
export const COVER_IDEAS = [
  { key: 'botanical', query: 'botanical' },
  { key: 'salon', query: 'salon' },
  { key: 'texture', query: 'texture' },
  { key: 'warmNeutrals', query: 'warm neutrals' },
] as const;

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unconfigured';

export function CoverPickerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [query, setQuery] = useState('botanical');
  const [idea, setIdea] = useState<string>('botanical');
  const [photos, setPhotos] = useState<CoverPhoto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'uploading' | null>(null);
  const [error, setError] = useState('');

  const search = useCallback(async (text: string) => {
    const term = text.trim();
    if (!client || !businessId || !term) return;
    setStatus('loading');
    setError('');
    try {
      const result = await invokeGoogle<{ photos: CoverPhoto[]; live: boolean }>(client, businessId, 'profile-cover', { action: 'search', query: term });
      setPhotos(result.photos);
      setSandbox(!result.live);
      setSelected(null);
      setStatus(result.photos.length ? 'ready' : 'empty');
    } catch (cause) {
      setPhotos([]);
      setStatus(cause instanceof GoogleActionError && cause.code === 'UNSPLASH_NOT_CONFIGURED' ? 'unconfigured' : 'error');
    }
  }, [client, businessId]);

  useEffect(() => { if (!identityLoading) void search('botanical'); }, [identityLoading, search]);

  const chooseIdea = (key: string, term: string) => {
    setIdea(key);
    setQuery(term);
    void search(term);
  };

  const useCover = async () => {
    if (!client || !businessId || !selected) return;
    setBusy('saving');
    setError('');
    try {
      await invokeGoogle(client, businessId, 'profile-cover', { action: 'use', photo_id: selected });
      navigate(operatorUrl(businessId, 'settings/profile'));
    } catch {
      setError(t('coverPicker.saveError'));
    } finally {
      setBusy(null);
    }
  };

  // Upload uses the same two steps as the profile page, then marks the cover as an upload.
  const upload = async (file: File) => {
    if (!client || !businessId) return;
    setBusy('uploading');
    setError('');
    try {
      const { data: result, error: requestError } = await client.functions.invoke('photo-upload-url', { body: { kind: 'cover', size: file.size, contentType: file.type, artist_business_id: businessId } });
      if (requestError) throw requestError;
      const target = result?.data;
      if (typeof target?.path !== 'string' || typeof target?.token !== 'string' || target.bucket !== 'mova_profile_photos') throw new Error('UPLOAD_RESPONSE_INVALID');
      const { error: storageError } = await client.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (storageError) throw storageError;
      const { error: processError } = await client.functions.invoke('photo-process', { body: { path: target.path, kind: 'cover', zoom: 1 } });
      if (processError) throw processError;
      await invokeGoogle(client, businessId, 'profile-cover', { action: 'clear' });
      navigate(operatorUrl(businessId, 'settings/profile'));
    } catch {
      setError(t('coverPicker.uploadError'));
    } finally {
      setBusy(null);
    }
  };

  const chosen = photos.find((photo) => photo.id === selected) ?? null;

  return <main className="mova-page mova-cover-picker">
    <ScreenHeader title={t('coverPicker.title')} onBack={() => navigate(operatorUrl(businessId, 'settings/profile'))} backLabel={t('coverPicker.close')}
      trailing={<label className="mova-button mova-button--secondary mova-cover-picker__upload">{t('coverPicker.upload')}<input type="file" accept={COVER_ACCEPT} disabled={busy !== null} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file); }} /></label>} />
    {busy === 'uploading' && <p role="status">{t('coverPicker.uploading')}</p>}

    <div role="img" aria-label={t('coverPicker.preview')} className="mova-cover-picker__preview" style={chosen ? { backgroundImage: `url("${chosen.imageUrl}")` } : undefined} />
    {chosen && <p className="mova-cover-picker__credit">{t('coverPicker.photoCredit')} <a href={chosen.photographerUrl} target="_blank" rel="noopener noreferrer">{chosen.photographerName}</a> / <a href={chosen.photoUrl} target="_blank" rel="noopener noreferrer">{t('coverPicker.unsplash')}</a></p>}

    <form role="search" className="mova-cover-picker__search" onSubmit={(event) => { event.preventDefault(); setIdea(''); void search(query); }}>
      <input type="search" aria-label={t('coverPicker.searchLabel')} value={query} maxLength={80} onChange={(event) => setQuery(event.currentTarget.value)} />
      <Button type="submit" variant="secondary" disabled={!query.trim() || status === 'loading'}>{t('coverPicker.search')}</Button>
    </form>

    <div role="group" aria-label={t('coverPicker.ideas')} className="mova-cover-picker__ideas">
      {COVER_IDEAS.map((item) => <button key={item.key} type="button" aria-pressed={idea === item.key} className={idea === item.key ? 'is-selected' : ''} onClick={() => chooseIdea(item.key, item.query)}>{t(`coverPicker.idea.${item.key}`)}</button>)}
    </div>

    {status === 'loading' && <p role="status" aria-busy="true">{t('coverPicker.loading')}</p>}
    {status === 'error' && <ErrorState title={t('coverPicker.error')} retryLabel={t('coverPicker.retry')} onRetry={() => void search(query)} />}
    {status === 'unconfigured' && <p role="status" className="mova-cover-picker__notice">{t('coverPicker.notConfigured')}</p>}
    {status === 'empty' && <EmptyState title={t('coverPicker.empty')} />}
    {status === 'ready' && <>
      {sandbox && <p role="note" className="mova-cover-picker__notice">{t('coverPicker.sandbox')}</p>}
      <div role="radiogroup" aria-label={t('coverPicker.photos')} className="mova-cover-picker__grid">
        {photos.map((photo, index) => <label key={photo.id} className={`mova-cover-picker__tile${selected === photo.id ? ' is-selected' : ''}`}>
          <input type="radio" name="cover" value={photo.id} checked={selected === photo.id} aria-label={t('coverPicker.photoLabel', { number: index + 1, name: photo.photographerName })} onChange={() => setSelected(photo.id)} />
          <img src={photo.thumbUrl} alt="" loading="lazy" />
          <span>{photo.photographerName}</span>
        </label>)}
      </div>
      <p className="mova-cover-picker__credit">{t('coverPicker.freeFrom')} <a href={UNSPLASH_HOME} target="_blank" rel="noopener noreferrer">{t('coverPicker.unsplash')}</a></p>
    </>}

    {error && <p role="alert" className="mova-cover-picker__notice is-error">{error}</p>}
    <div className="mova-cover-picker__footer">
      <Button loading={busy === 'saving'} disabled={!selected || busy !== null} onClick={() => void useCover()}>{t('coverPicker.useCover')}</Button>
    </div>
  </main>;
}

export default CoverPickerPage;
