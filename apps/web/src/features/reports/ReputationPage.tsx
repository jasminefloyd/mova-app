import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, ScreenHeader, TextArea, TextField, Toggle } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';

type Review = { id: string; rating: number; tags: string[]; body: string; display_name: string; moderation_status: string; artist_reply: string | null; created_at: string; mova_appointments?: { service_name_snapshot: string } | null };
type GoogleReview = { id: string; rating: number; body: string; display_name: string; provider_created_at: string | null };
type Settings = { ask_after_visit: boolean; google_review_url: string | null };
type RatingSummary = { count: number; average: number | null; awaiting_reply: number; stars: Record<string, number>; mova_count: number; mova_average: number | null; google_count: number; google_average: number | null };
type ReviewResponse = { reviews?: Review[]; google_reviews?: GoogleReview[]; summary?: RatingSummary | null; settings?: Settings; email_delivery_enabled?: boolean };

export function ReputationPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isSettings = location.pathname.endsWith('/settings/reviews');
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [googleReviews, setGoogleReviews] = useState<GoogleReview[]>([]);
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [settings, setSettings] = useState<Settings>({ ask_after_visit: false, google_review_url: null });
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [filter, setFilter] = useState('all');
  const [replyId, setReplyId] = useState('');
  const [reply, setReply] = useState('');
  const [googleUrl, setGoogleUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');

  const call = useCallback(async (payload: Record<string, unknown>): Promise<ReviewResponse> => {
    if (!client || !businessId) throw new Error('IDENTITY_REQUIRED');
    const { data: envelope, error } = await client.functions.invoke<{ data?: ReviewResponse }>('review-management', {
      body: payload,
      headers: { 'x-mova-artist-business-id': businessId },
    });
    if (error || !envelope?.data) throw new Error('REVIEW_ACTION_FAILED');
    return envelope.data;
  }, [businessId, client]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await call({ action: 'get' });
      setReviews(data.reviews ?? []);
      setGoogleReviews(data.google_reviews ?? []);
      setSummary(data.summary ?? null);
      const next = data.settings ?? { ask_after_visit: false, google_review_url: null };
      setSettings(next);
      setGoogleUrl(next.google_review_url ?? '');
      setEmailEnabled(data.email_delivery_enabled === true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [call]);
  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const saveSettings = async (patch: Partial<Settings>) => {
    setBusy(true);
    setNotice('');
    try {
      const next = { ...settings, ...patch };
      await call({ action: 'save_settings', ask_after_visit: next.ask_after_visit, google_review_url: next.google_review_url });
      setSettings(next);
      setNotice(t('reviews.saved'));
    } catch {
      setNotice(t('reviews.saveError'));
    } finally {
      setBusy(false);
    }
  };
  const saveReply = async () => {
    setBusy(true);
    try {
      await call({ action: 'reply', review_id: replyId, reply });
      setReplyId('');
      setReply('');
      await load();
    } catch {
      setNotice(t('reviews.saveError'));
    } finally {
      setBusy(false);
    }
  };
  const report = async (review: Review) => {
    setBusy(true);
    try {
      await call({ action: 'report', review_id: review.id, reason: 'other', details: '' });
      setNotice(t('reviews.reported'));
    } catch {
      setNotice(t('reviews.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const filteredMova = filter === 'google' ? [] : reviews.filter((review) => filter === 'needs_reply' ? !review.artist_reply : true);
  const filteredGoogle = filter === 'google' || filter === 'all' ? googleReviews : [];
  const totalCount = summary?.count ?? 0;
  const startReply = (review: Review) => { setReplyId(review.id); setReply(review.artist_reply ?? ''); };

  return <main className={`mova-page mova-reputation-page${isSettings ? ' is-settings' : ''}`}>
    <ScreenHeader title={t('reviews.title')} onBack={() => navigate(operatorUrl(businessId, isSettings ? 'settings' : 'reports'))} backLabel={isSettings ? t('privacy.back') : t('reviews.back')} />
    <div className="mova-reputation-heading"><h1>{t('reviews.title')}</h1>{!isSettings && <p>{t('reviews.verifiedVisitOnly')}</p>}</div>
    {identityLoading || loading
      ? <p role="status" aria-busy="true">{t('reviews.loading')}</p>
      : error
        ? <ErrorState title={t('reviews.error')} retryLabel={t('reviews.retry')} onRetry={() => void load()} />
        : <>
          <Card className="mova-reputation-summary">
            <div className="mova-reputation-score">
              <strong>{summary?.average == null ? '—' : summary.average.toFixed(1)}</strong>
              <span className="mova-reputation-stars" aria-label={summary?.average == null ? t('reviews.noRatings') : t('reviews.stars', { count: Math.round(summary.average) })}>
                {'★'.repeat(Math.round(summary?.average ?? 0))}{'☆'.repeat(5 - Math.round(summary?.average ?? 0))}
              </span>
              <span>{t('reviews.reviewCount', { count: totalCount })}</span>
              <span>{t('reviews.sourceAverage', { source: 'Mova', count: summary?.mova_count ?? 0, rating: summary?.mova_average?.toFixed(1) ?? '—' })}</span>
              <span>{t('reviews.sourceAverage', { source: 'Google', count: summary?.google_count ?? 0, rating: summary?.google_average?.toFixed(1) ?? '—' })}</span>
            </div>
            <div className="mova-rating-breakdown" aria-label={t('reviews.ratingBreakdown')}>
              {[5, 4, 3, 2, 1].map((star) => {
                const count = summary?.stars?.[String(star)] ?? 0;
                const width = totalCount ? `${count / totalCount * 100}%` : '0%';
                return <div key={star}><span>{star}</span><div aria-hidden="true"><i style={{ width }} /></div><b>{count}</b></div>;
              })}
            </div>
          </Card>
          {isSettings && <Card className="mova-google-guidance">
            <h2>{t('reviews.googlePresence')}</h2><p>{t('reviews.googleGuidance')}</p>
            <TextField label={t('reviews.googleUrl')} type="url" value={googleUrl} onChange={(event) => setGoogleUrl(event.currentTarget.value)} maxLength={2048} placeholder="https://" />
            <Button variant="secondary" loading={busy} onClick={() => void saveSettings({ google_review_url: googleUrl.trim() || null })}>{t('reviews.saveGoogleUrl')}</Button>
            <p>{t('reviews.googleImportOff')}</p>
            {settings.google_review_url && <a href={settings.google_review_url} target="_blank" rel="noreferrer">{t('reviews.openGoogle')}</a>}
          </Card>}
          <div className="mova-reviews-filters" role="group" aria-label={t('reviews.filter')}>
            {['all', 'mova', 'google', 'needs_reply'].map((key) => <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? 'is-selected' : ''} onClick={() => setFilter(key)}>
              {key === 'needs_reply' ? `${t(`reviews.filters.${key}`)} · ${summary?.awaiting_reply ?? 0}` : t(`reviews.filters.${key}`)}
            </button>)}
          </div>
          {filteredMova.length + filteredGoogle.length === 0
            ? <EmptyState title={t('reviews.empty')} detail={t('reviews.emptyDetail')} />
            : <div className="mova-reviews-list">
              {filteredGoogle.map((review) => <Card key={`google-${review.id}`} className="mova-review-card">
                <header><div><strong>{review.display_name || t('reviews.googleReviewer')}</strong><time>{review.provider_created_at ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(new Date(review.provider_created_at)) : ''}</time></div>
                  <span aria-label={t('reviews.stars', { count: review.rating })}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></header>
                <p className="mova-review-source">Google</p>{review.body && <p>{review.body}</p>}
              </Card>)}
              {filteredMova.map((review) => <Card key={review.id} className="mova-review-card">
                <header><div><strong>{review.display_name}</strong><span className="mova-review-stars" aria-label={t('reviews.stars', { count: review.rating })}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div>
                  <time dateTime={review.created_at}>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(new Date(review.created_at))}</time></header>
                <p className="mova-review-verified">{t('reviews.verifiedService', { service: review.mova_appointments?.service_name_snapshot ?? t('reviews.completedVisit') })}</p>
                {review.tags.length > 0 && <p className="mova-review-tags">{review.tags.map((tag) => t(`reviews.tags.${tag}`)).join(' · ')}</p>}
                {review.body && <p>{review.body}</p>}
                <p className="mova-review-status">{t(`reviews.moderation.${review.moderation_status}`)}</p>
                {review.artist_reply
                  ? <blockquote><strong>{t('reviews.yourReply')}</strong><p>{review.artist_reply}</p><Button variant="secondary" onClick={() => startReply(review)}>{t('reviews.editReply')}</Button></blockquote>
                  : replyId === review.id
                    ? <div className="mova-review-reply"><TextArea label={t('reviews.replyLabel')} value={reply} maxLength={2000} onChange={(event) => setReply(event.currentTarget.value)} /><Button loading={busy} disabled={!reply.trim()} onClick={() => void saveReply()}>{t('reviews.saveReply')}</Button></div>
                    : <Button variant="secondary" onClick={() => startReply(review)}>{t('reviews.reply')}</Button>}
                <Button variant="ghost" disabled={busy} onClick={() => void report(review)}>{t('reviews.report')}</Button>
              </Card>)}
            </div>}
          <Card className="mova-review-settings">
            <h2>{t('reviews.requestSettings')}</h2>
            <Toggle label={t('reviews.askAfterVisit')} description={t('reviews.askDescription')} checked={settings.ask_after_visit} disabled={busy || !emailEnabled} onChange={(value) => void saveSettings({ ask_after_visit: value })} />
            {!emailEnabled && <p>{t('reviews.noEmailProvider')}</p>}
          </Card>
          {notice && <p role="status">{notice}</p>}
        </>}
  </main>;
}

export default ReputationPage;
