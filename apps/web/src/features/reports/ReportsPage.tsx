import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, ErrorState, Segmented } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';
import './reports-board.css';

type Summary = { start: string; end: string; current: Record<string, number>; previous: Record<string, number>; series: Array<{ date: string; service_value_minor: number; completed_count: number; page_views: number; qr_scans: number }> };

// Board 37 (Reports). Numbers come from reports-summary. Rebook rate and the "new reviews" count are
// not in that summary yet, so they show a dash rather than a guess.
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [period, setPeriod] = useState('30');
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) { setData(null); setError(true); setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const { data: envelope, error: functionError } = await client.functions.invoke<{ data?: Summary }>('reports-summary', { body: { period: Number(period) }, headers: { 'x-mova-artist-business-id': businessId } });
      if (functionError || !envelope?.data?.current) throw new Error();
      setData(envelope.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, client, period]);

  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  const fmt = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 0 }).format(value);
  const money = (minor: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(minor / 100);
  const c = data?.current ?? {};
  const p = data?.previous ?? {};
  const change = (key: string) => {
    const now = c[key] ?? 0;
    const before = p[key] ?? 0;
    if (before === 0) return now === 0 ? null : { text: '+100%', up: true };
    const pct = Math.round((now - before) / before * 100);
    return { text: `${Math.abs(pct)}%`, up: pct >= 0 };
  };
  const ratingCount = Number(c.rating_count ?? 0) + Number(c.google_rating_count ?? 0);
  const rating = ratingCount ? ((Number(c.rating_sum ?? 0) + Number(c.google_rating_sum ?? 0)) / ratingCount).toFixed(1) : '—';
  const revenueChange = change('service_value_minor');
  const sources = Object.entries((c.source_counts ?? {}) as Record<string, number>).sort((left, right) => right[1] - left[1]).slice(0, 3);
  const revenueBuckets = useMemo(() => {
    const series = data?.series ?? [];
    return Array.from({ length: 4 }, (_, index) => {
      const start = Math.floor(index * series.length / 4);
      const end = Math.floor((index + 1) * series.length / 4);
      return series.slice(start, end).reduce((total, day) => total + day.service_value_minor, 0);
    });
  }, [data?.series]);
  const maxRevenueBucket = Math.max(1, ...revenueBuckets);
  const periodOptions = [{ key: '7', label: t('reports.days7') }, { key: '30', label: t('reports.days30') }, { key: '90', label: t('reports.days90') }];
  const periodLabel = periodOptions.find((item) => item.key === period)?.label ?? periodOptions[1]!.label;

  return <main className="mova-page mova-reports-page">
    <div className="mova-report-heading">
      <h1>{t('reports.title')}</h1>
      <Segmented label={t('reports.period')} options={periodOptions.map((item) => item.label)} value={periodLabel} onChange={(value) => setPeriod(periodOptions.find((item) => item.label === value)?.key ?? '30')} />
    </div>
    {identityLoading || loading ? <p role="status" aria-busy="true">{t('reports.loading')}</p>
      : error ? <ErrorState title={t('reports.error')} retryLabel={t('reports.retry')} onRetry={() => void load()} />
      : <div className="mova-reports-board">
        <Link className="mova-report-card mova-report-card--revenue" to={operatorUrl(businessId, 'money')} aria-label={t('screens.reports.openMoney')}>
          <span className="mova-report-card__label">{t('reports.revenue')}</span>
          <strong className="mova-report-card__metric">{money(c.service_value_minor ?? 0)}</strong>
          <span className="mova-report-card__detail">
            {t('screens.reports.serviceValueChange', { value: revenueChange ? `${revenueChange.up ? '↑' : '↓'} ${revenueChange.text}` : '—', days: period })}
          </span>
          <span className="mova-report-chart" aria-hidden="true">
            {revenueBuckets.map((value, index) => <span key={index} data-current={index === revenueBuckets.length - 1 || undefined} style={{ height: `${Math.max(14, Math.round(value / maxRevenueBucket * 100))}%` }} />)}
          </span>
        </Link>

        <div className="mova-reports-board__pair">
          <Card className="mova-report-card mova-report-card--bookings">
            <span className="mova-report-card__label">{t('reports.bookings')}</span>
            <strong className="mova-report-card__metric">{fmt(c.completed_count ?? 0)}</strong>
            <ul className="mova-report-lines">
              <li>{t('screens.reports.rebookedLine', { rate: '—' })}</li>
              <li>{t('screens.reports.averageTicketLine', { value: c.completed_count ? money(Math.round((c.service_value_minor ?? 0) / c.completed_count)) : '—' })}</li>
              <li>{t('screens.reports.noShowsLine', { count: c.no_show_count ?? 0 })}</li>
            </ul>
          </Card>

          <Link className="mova-report-card mova-report-card--reputation" to={operatorUrl(businessId, 'reports/reputation')} aria-label={t('screens.reports.reputationLink', { rating, count: ratingCount })}>
            <span className="mova-report-card__label">{t('reports.reputation')}</span>
            <strong className="mova-report-card__metric">{rating === '—' ? '—' : <>{rating} <span className="mova-report-star" aria-hidden="true">★</span></>}</strong>
            <ul className="mova-report-lines">
              <li>{t('reports.ratingCount', { count: ratingCount })}</li>
              <li>{t('reports.ratingSources', { mova: fmt(c.rating_count ?? 0), google: fmt(c.google_rating_count ?? 0) })}</li>
              <li>{t('reports.awaitingReplyCount', { count: c.awaiting_reply ?? 0 })}</li>
            </ul>
          </Link>
        </div>

        <Card className="mova-report-card mova-report-card--traffic">
          <h2 className="mova-report-card__label">{t('reports.profileTraffic')}</h2>
          <div className="mova-report-trio">
            <div><strong>{fmt(c.page_views ?? 0)}</strong><span>{t('reports.views')}</span></div>
            <div><strong>{fmt(c.qr_scans ?? 0)}</strong><span>{t('reports.qrScans')}</span></div>
            <div><strong>{c.page_views ? `${Math.round((c.booking_completions ?? 0) / c.page_views * 100)}%` : '—'}</strong><span>{t('reports.viewToBook')}</span></div>
          </div>
          <p className="mova-report-note">{sources.length
            ? t('screens.reports.topSources', { sources: sources.map(([source, count]) => `${t(`reports.sourcesMap.${source}`)} ${c.page_views ? Math.round(count / c.page_views * 100) : 0}%`).join(' · ') })
            : t('screens.reports.noSources')}</p>
        </Card>

        <Card className="mova-report-card mova-report-card--marketing">
          <h2 className="mova-report-card__label">{t('reports.marketing')}</h2>
          <Link className="mova-report-row" to={operatorUrl(businessId, 'growth/slots')}>
            <span>{t('screens.reports.seatFillerRow', { count: c.slot_fills ?? 0 })}</span><strong>{money(c.slot_recovered_minor ?? 0)}</strong>
          </Link>
          <Link className="mova-report-row" to={operatorUrl(businessId, 'growth/pipeline')}>
            <span>{t('screens.reports.rebookingRow', { booked: c.rebooking_count ?? 0, sent: c.rebooking_reminders_sent ?? 0 })}</span><strong>{money(c.rebooking_value_minor ?? 0)}</strong>
          </Link>
          <div className="mova-report-row">
            <span>{t('reports.socialShares')}</span><strong>{fmt(c.social_shares ?? 0)}</strong>
          </div>
        </Card>
      </div>}
  </main>;
}

export default ReportsPage;
