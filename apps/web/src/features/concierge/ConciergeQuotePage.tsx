import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, ScreenHeader, StatusChip, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { displayId } from '../../lib/display-ids';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Quote = {
  id: string;
  conversation_id: string;
  appointment_id: string | null;
  appointment_number: number | null;
  service_category: string;
  details: Record<string, unknown>;
  media_count: number;
  risk_flags: string[];
  quoted_minor: number | null;
  status: string;
  created_at: string;
  client_name: string | null;
  channel: string;
  locale: string;
};

async function invoke(client: ReturnType<typeof useArtistBusiness>['client'], businessId: string | null, payload: Record<string, unknown>) {
  if (!client || !businessId) throw new Error('IDENTITY_MISSING');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('UNAUTHENTICATED');
  const response = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/concierge-artist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, 'x-mova-artist-business-id': businessId },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.code ?? 'REQUEST_FAILED');
  return result.data;
}

function displayDetail(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : fallback;
}

export default function ConciergeQuotePage() {
  const { t, i18n } = useTranslation();
  const { quoteId = '' } = useParams();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId || !quoteId) return;
    setLoading(true);
    setError(false);
    try {
      const result = await invoke(client, businessId, { action: 'quote-detail', id: quoteId });
      const row = result.quote as Quote;
      setQuote(row);
      setAmount(row.quoted_minor == null ? '' : (row.quoted_minor / 100).toFixed(2));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, client, quoteId]);

  useEffect(() => {
    if (!identityLoading) void load();
  }, [identityLoading, load]);

  const saveEstimate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(minor) || minor <= 0) {
      setValidationError(true);
      return;
    }
    setSaving(true);
    setValidationError(false);
    setSaved(false);
    try {
      await invoke(client, businessId, { action: 'save-quote-estimate', id: quoteId, quoted_minor: minor });
      setQuote(current => current ? { ...current, quoted_minor: minor } : current);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const channelLabel = quote?.channel === 'sms' ? t('concierge.channelLabels.sms')
    : quote?.channel === 'web_chat' ? t('concierge.channelLabels.webChat')
      : quote?.channel === 'missed_call' ? t('concierge.channelLabels.missedCall')
        : quote?.channel === 'instagram' ? t('concierge.channelLabels.instagram') : t('concierge.channelLabels.unknown');
  const quoteStatusLabel = quote?.status === 'open' ? t('concierge.quoteStatuses.open')
    : quote?.status === 'quoted' ? t('concierge.quoteStatuses.quoted')
      : quote?.status === 'consult_offered' ? t('concierge.quoteStatuses.consultOffered')
        : quote?.status === 'booked' ? t('concierge.quoteStatuses.booked')
          : quote?.status === 'closed' ? t('concierge.quoteStatuses.closed') : t('concierge.quoteStatuses.unknown');
  const details = [
    { label: t('concierge.hair_now'), value: quote?.details.hair_now },
    { label: t('concierge.goal'), value: quote?.details.goal },
    { label: t('concierge.budget'), value: quote?.details.budget },
    { label: t('concierge.availability'), value: quote?.details.availability },
  ];

  return <main lang={quote?.locale ?? i18n.resolvedLanguage} className="mova-page mova-concierge-page mova-concierge-quote">
    <ScreenHeader
      title={t('concierge.quoteDetailTitle')}
      backLabel={t('messaging.back')}
      onBack={() => navigate(operatorUrl(businessId, quote ? 'growth/concierge/' + quote.conversation_id : 'growth/concierge'))}
      trailing={quote ? <Link to={operatorUrl(businessId, 'growth/concierge/' + quote.conversation_id)}>{t('concierge.quoteConversation')}</Link> : undefined}
    />
    {identityLoading || loading ? <p role="status" aria-busy="true">{t('concierge.loading')}</p> : error || !quote
      ? <ErrorState title={t('concierge.quoteLoadError')} retryLabel={t('concierge.retry')} onRetry={() => void load()} />
      : <>
        <div className="mova-concierge-quote__heading">
          <StatusChip status={quote.status === 'open' ? 'needs-approval' : 'info'}>{quoteStatusLabel}</StatusChip>
          <h1>{t('concierge.quote')} · {quote.client_name ?? t('concierge.quoteClientUnknown')} · {quote.service_category}</h1>
          <p>{channelLabel} · {t(quote.locale === 'es-US' ? 'onboarding.spanish' : 'onboarding.english')}</p>
        </div>

        {quote.appointment_number !== null && <Card><Link to={operatorUrl(businessId, `appointments/${displayId('AID', quote.appointment_number)}`)}>{t('concierge.linkedAppointment')}</Link></Card>}

        {quote.media_count > 0
          ? <Card className="mova-concierge-quote__media"><p>{t('concierge.quotePhotosUnavailable')}</p></Card>
          : <Card className="mova-concierge-quote__media"><p>{t('concierge.quoteNoPhotos')}</p></Card>}

        <Card className="mova-concierge-quote__details">
          <dl>{details.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{displayDetail(item.value, t('concierge.notSet'))}</dd></div>)}</dl>
        </Card>

        {quote.risk_flags.length > 0 && <Card tone="warm" className="mova-concierge-quote__risk"><p>{t('concierge.quoteRiskNeedsReview')}</p></Card>}

        <form className="mova-concierge-form" onSubmit={event => void saveEstimate(event)}>
          <TextField
            label={t('concierge.quoteEstimateLabel')}
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={event => { setAmount(event.currentTarget.value); setSaved(false); }}
            {...(validationError ? { error: t('concierge.quoteEstimateInvalid') } : {})}
            required
          />
          <p>{t('concierge.quoteNotSent')}</p>
          <Button type="submit" loading={saving} disabled={quote.status !== 'open'}>{t('concierge.quoteSaveEstimate')}</Button>
          {saved && <p role="status">{t('concierge.quoteEstimateSaved')}</p>}
        </form>
      </>}
  </main>;
}
