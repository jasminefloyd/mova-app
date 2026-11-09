import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { GoogleActionError, invokeGoogle } from './googleApi';
import './google.css';

// Board 38b: one Google sign-in for Business Profile and Calendar. The sign-in opens in a new window,
// as the design says; the page stays here and the callback lands on the Google settings screen.
export function GoogleConnectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId } = useArtistBusiness();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    if (!client || !businessId) return;
    setBusy(true);
    setError('');
    // Opened before the request so browsers allow it; the sign-in address is set once Mova has it.
    const signIn = window.open('', '_blank');
    try {
      const result = await invokeGoogle<{ authorizationUrl: string }>(client, businessId, 'calendar-google-connect', { action: 'begin' });
      if (signIn) signIn.location.href = result.authorizationUrl;
      else window.location.assign(result.authorizationUrl);
      setBusy(false);
    } catch (cause) {
      signIn?.close();
      setError(cause instanceof GoogleActionError && cause.code === 'GOOGLE_CALENDAR_NOT_CONFIGURED' ? t('google.connect.unavailable') : t('google.connect.startError'));
      setBusy(false);
    }
  };

  const points: Array<{ key: 'listing' | 'reviews' | 'calendar'; icon: string }> = [
    { key: 'listing', icon: '⌂' },
    { key: 'reviews', icon: '★' },
    { key: 'calendar', icon: '▦' },
  ];

  return <main className="mova-page mova-google-page mova-google-connect">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/google'))} backLabel={t('google.back')} />
    <div className="mova-google-connect__intro">
      <h1>{t('google.connect.title')}</h1>
      <p>{t('google.connect.intro')}</p>
    </div>
    <section aria-label={t('google.connect.title')} className="mova-google-card mova-google-connect__points">
      {points.map((point) => <div key={point.key} className="mova-google-connect__point">
        <span className="mova-google-connect__icon" aria-hidden="true">{point.icon}</span>
        <span><strong>{t(`google.connect.${point.key}Title`)}</strong><span>{t(`google.connect.${point.key}Body`)}</span></span>
      </div>)}
    </section>
    <p className="mova-google-connect__privacy">{t('google.connect.privacy')}</p>
    {error && <p role="alert" className="mova-google-message is-error">{error}</p>}
    <div className="mova-google-connect__footer">
      <Button loading={busy} disabled={busy || !client} onClick={() => void connect()}>{t('google.connect.continue')}</Button>
      <span>{t('google.connect.opensNewWindow')}</span>
    </div>
  </main>;
}

export default GoogleConnectPage;
