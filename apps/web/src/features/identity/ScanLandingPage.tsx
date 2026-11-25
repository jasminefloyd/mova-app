import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar, EmptyState, Icon } from '../../components';
import { clientProfilesEnabled, publicEnv } from '../../lib/env';
import type { PublicArtist } from '../showcase/PublicArtistPage';
import { trackProfileEvent } from '../reports/track';
import { PublicLocaleToggle } from '../../app/PublicLocaleToggle';

function post(functionName: string, body: Record<string, string>, signal?: AbortSignal) {
  return fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

export function ScanLandingPage() {
  const { handle = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [artist, setArtist] = useState<PublicArtist | null>(null);
  const [loadedHandle, setLoadedHandle] = useState<string | null>(null);
  const trackedHandle = useRef<string | null>(null);
  const locale = i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US';

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await post('public-artist', { handle, tab: 'looks', locale }, controller.signal);
        const envelope = await response.json() as { data?: PublicArtist };
        if (!response.ok || !envelope.data) throw new Error('Public profile unavailable');
        if (controller.signal.aborted) return;
        setArtist(envelope.data);
      } catch {
        if (!controller.signal.aborted) setArtist(null);
      } finally {
        if (!controller.signal.aborted) setLoadedHandle(handle);
      }
    }
    void load();
    return () => controller.abort();
  }, [handle, locale]);

  useEffect(() => {
    if (!artist || loadedHandle !== handle || trackedHandle.current === handle) return;
    trackedHandle.current = handle;
    const session = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    void post('scan-landing', { handle, scan_session: session }).catch(() => undefined);
    trackProfileEvent(handle, 'qr_scan');
  }, [artist, handle, loadedHandle]);

  if (loadedHandle !== handle) return <main className="mova-page mova-scan-landing" aria-busy="true"><p role="status">{t('identity.loading')}</p></main>;
  if (!artist) return <main className="mova-page mova-scan-landing"><EmptyState title={t('identity.artistUnavailable')} detail={t('identity.artistUnavailableDetail')} /></main>;

  const { display_name: displayName, photo_urls: photoUrls, specialties } = artist.profile;
  const name = displayName.trim().split(/\s+/)[0] || displayName;
  const profilePath = `/a/${encodeURIComponent(artist.profile.handle)}`;
  const signInQuery = new URLSearchParams({ artist: artist.profile.handle, returnTo: profilePath });
  const locationNames = artist.locations.map(location => location.name);

  return <main className="mova-page mova-scan-landing">
    <header className="mova-scan-landing__brand">
      <span className="mova-wordmark">mova</span>
      <PublicLocaleToggle />
    </header>
    <section className="mova-scan-landing__hero" aria-labelledby="scan-artist-name">
      <Avatar size={148} placeholder label={t('settings.profilePhotoAlt', { name: displayName })} src={photoUrls.profile?.['512'] ?? null} />
      <div className="mova-scan-landing__identity">
        <h1 id="scan-artist-name">{displayName}</h1>
        {specialties.length > 0 && <p>{specialties.join(' · ')}</p>}
      </div>
      {locationNames.length > 0 && <p className="mova-scan-landing__locations">
        <Icon name="location" size={16} />
        <span>{locationNames.join(' · ')}</span>
      </p>}
    </section>
    <Link className="mova-button mova-button--primary" to={`${profilePath}/book`}>{t('identity.bookWith', { name })}</Link>
    <section className="mova-scan-landing__card" aria-labelledby="scan-save-card">
      <div>
        <h2 id="scan-save-card">{t('identity.saveArtistCard', { name })}</h2>
        <p>{t('identity.scanHomeScreen')}</p>
      </div>
      {clientProfilesEnabled && <Link className="mova-button mova-button--secondary" to={`/signin?${signInQuery}`}>
        <Icon name="user" size={16} />
        {t('identity.scanAddToStylists', { name })}
      </Link>}
    </section>
    <Link className="mova-scan-landing__profile" to={profilePath}>{t('identity.scanLooksAndServices', { name })}</Link>
  </main>;
}
export default ScanLandingPage;
