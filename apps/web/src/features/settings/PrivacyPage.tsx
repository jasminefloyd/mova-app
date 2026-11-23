import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorState, ScreenHeader, Sheet } from '../../components';
import { useArtistBusiness } from './useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import { clearOfflineData } from '../../pwa/offline-data';
import { clearMovaSessionState } from '../../lib/session-cleanup';

type Closure = { state: 'active' | 'scheduled' | 'archived'; ends_at: string | null };

export function PrivacyPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { client, businessId, loading } = useArtistBusiness();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<Closure | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);

  const run = async (action: 'export' | 'preview_delete' | 'request_delete') => {
    if (!client || !businessId || busy) return;
    setBusy(true);
    setError(false);
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) throw new Error('SESSION_REQUIRED');
      const fn = action === 'export' ? 'artist-data-export' : 'privacy-management';
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, 'x-mova-artist-business-id': businessId },
        body: JSON.stringify(action === 'export' ? {} : { action }),
      });
      const { data } = await response.json();
      if (!response.ok || !data) throw new Error('PRIVACY_ACTION_FAILED');
      if (action === 'export') {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mova-business-data.json';
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
      const closure = data as Closure;
      setPreview(action === 'preview_delete' && closure.state === 'active' ? closure : null);
      if (closure.state === 'scheduled') setScheduled(closure.ends_at);
      if (closure.state === 'archived') {
        await client.auth.signOut({ scope: 'local' });
        await Promise.allSettled([clearMovaSessionState(queryClient), clearOfflineData()]);
        sessionStorage.removeItem('mova_active_artist_business_id');
        sessionStorage.removeItem('mova_active_artist_business_display_id');
        navigate('/account-closure?ended=1', { replace: true });
      }
    } catch {
      setError(true);
    } finally { setBusy(false); }
  };

  const format = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'long', timeStyle: 'short',
  }).format(new Date(value));

  return <main className="mova-page mova-privacy-page">
    <ScreenHeader title={t('privacy.title')} onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('privacy.back')} />
    <h1>{t('privacy.title')}</h1>
    {loading ? <p role="status" aria-busy="true">{t('privacy.loading')}</p> : <>
      <Card className="mova-privacy-card">
        <h2>{t('privacy.exportTitle')}</h2><p>{t('privacy.exportDetail')}</p>
        <Button disabled={busy} onClick={() => void run('export')}>{t('privacy.exportBusiness')}</Button>
      </Card>
      <Card className="mova-privacy-card mova-privacy-card--delete">
        <h2>{t('privacy.deleteTitle')}</h2><p>{t('privacy.deleteDetail')}</p>
        {scheduled
          ? <p role="status">{t('privacy.deletionScheduled', { date: format(scheduled) })}</p>
          : <Button variant="destructive" disabled={busy} onClick={() => void run('preview_delete')}>{t('privacy.requestDelete')}</Button>}
      </Card>
      {error && !preview && <ErrorState title={t('privacy.error')} retryLabel={t('privacy.retry')} onRetry={() => setError(false)} />}
    </>}
    <Sheet open={preview !== null} title={t('privacy.confirmDeletion')} onClose={() => { if (!busy) setPreview(null); }}>
      {preview && <>
        <p>{preview.ends_at ? t('privacy.paidEnds', { date: format(preview.ends_at) }) : t('privacy.freeEnds')}</p>
        <p>{t('privacy.closureEmail')}</p>
        {error && <p role="alert">{t('privacy.error')}</p>}
        <Button variant="destructive" loading={busy} onClick={() => void run('request_delete')}>{t('privacy.confirmRequest')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>{t('privacy.keepAccount')}</Button>
      </>}
    </Sheet>
  </main>;
}

export default PrivacyPage;
