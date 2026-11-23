import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, OfflineBanner, ScreenHeader, Segmented } from '../../../components';
import { operatorUrl } from '../../../app/operator-url';
import { UnlockSheet } from '../../billing/UnlockSheet';
import { useOnline } from './useOnline';
import { rowKey, usePricePilotOverview, type PriceRow } from './api';
import { ActionChip, Chevron, PriceBar, ago, confidenceKey, duration, money } from './shared';

type Filter = 'all' | 'raise' | 'hold' | 'needs_data';
const ORDER: Record<PriceRow['action'], number> = { raise: 0, hold: 1, needs_data: 2 };
const SURE: Record<PriceRow['evidence']['confidence'], number> = { high: 0, medium: 1, low: 2 };

/** PP8: PricePilot is off (not turned on yet, or the plan doesn't include it). */
function OffState({ onTurnOn, busy, error }: { onTurnOn: () => void; busy: boolean; error: string | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  return <>
    <div className="mova-pp-head"><h1>{t('revenue.pricePilot.title')}</h1><p className="mova-pp-sub">{t('revenue.pricePilot.off.subtitle')}</p></div>
    <Card tone="inverse" className="mova-pp-hero">
      <h2>{t('revenue.pricePilot.off.title')}</h2>
      <p>{t('revenue.pricePilot.off.body')}</p>
      <Button variant="on-dark" loading={busy} onClick={onTurnOn}>{t('revenue.pricePilot.off.turnOn')}</Button>
      {error && <p className="mova-pp-hero__error" role="alert">{error}</p>}
    </Card>
    <Card className="mova-pp-preview">
      <span className="mova-pp-label">{t('revenue.pricePilot.off.preview')}</span>
      <div className="mova-pp-card mova-pp-service" aria-label={t('revenue.pricePilot.off.sampleData')}>
        <span className="mova-pp-row"><span><strong>{t('revenue.pricePilot.off.sampleService')}</strong><small>{t('revenue.pricePilot.off.sampleDuration')}</small></span><span className="mova-pp-chip mova-pp-chip--raise">{t('revenue.pricePilot.chip.raise')}</span></span>
        <span className="mova-pp-prices"><span><small>{t('revenue.pricePilot.youCharge')}</small><b>{money(9500, lang)}</b></span><span><small>{t('revenue.pricePilot.suggested')}</small><b>{money(11000, lang)}</b></span></span>
        <div className="mova-pp-bar" aria-hidden="true"><span className="mova-pp-bar__band" style={{ left: '41.7%', width: '25%' }} /><span className="mova-pp-bar__suggested" style={{ left: '50%' }} /><span className="mova-pp-bar__you" style={{ left: '25%' }} /></div>
        <span className="mova-pp-row"><small>{t('revenue.pricePilot.off.sampleData')}</small><Chevron /></span>
      </div>
    </Card>
    <Card className="mova-pp-card mova-pp-how">
      <h2>{t('revenue.pricePilot.off.howTitle')}</h2>
      <ol>{[1, 2, 3].map((n) => <li key={n}><b>{n}</b>{t(`revenue.pricePilot.off.step${n}`)}</li>)}</ol>
    </Card>
    <p className="mova-pp-sub mova-pp-tiny">{t('revenue.pricePilot.never')}</p>
  </>;
}

function RowCard({ row, base }: { row: PriceRow; base: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const href = `${base}/${rowKey(row)}`;
  if (row.action === 'needs_data') {
    return <Link className="mova-pp-card mova-pp-service mova-pp-service--thin" to={href}>
      <span className="mova-pp-row"><strong>{t('revenue.pricePilot.overview.serviceAt', { service: row.service_name, location: row.location_name })}</strong><ActionChip action={row.action} t={t} /></span>
      <span className="mova-pp-sub">{t('revenue.pricePilot.overview.needsDataLine', { count: row.evidence.count })}</span>
      <span className="mova-pp-link">{t('revenue.pricePilot.overview.addCompetitorMenu')}</span>
    </Link>;
  }
  return <Link className="mova-pp-card mova-pp-service" to={href}>
    <span className="mova-pp-row"><span><strong>{row.service_name}</strong><small>{duration(row.duration_minutes, t)} · {row.location_name}</small></span><ActionChip action={row.action} t={t} /></span>
    <span className="mova-pp-prices"><span><small>{t('revenue.pricePilot.youCharge')}</small><b>{money(row.current_minor, lang)}</b></span><span><small>{t('revenue.pricePilot.suggested')}</small><b>{money(row.suggested_minor, lang)}</b></span></span>
    <PriceBar row={row} label={t('revenue.pricePilot.barLabel', { current: money(row.current_minor, lang), low: money(row.evidence.range_low, lang), high: money(row.evidence.range_high, lang) })} />
    <span className="mova-pp-row"><small>{t(confidenceKey(row.evidence.confidence))} · {t('revenue.pricePilot.menus', { count: row.evidence.count })}</small><Chevron /></span>
  </Link>;
}

export function PricePilotOverviewPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const { data, error, loading, reload, call, businessId, signedIn } = usePricePilotOverview();
  const [filter, setFilter] = useState<Filter>('all');
  const [unlock, setUnlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turnOnError, setTurnOnError] = useState<string | null>(null);
  const lang = i18n.resolvedLanguage;
  const base = operatorUrl(businessId, 'growth/price-pilot');
  const rows = useMemo(() => (data?.available ? [...data.rows].sort((a, b) => ORDER[a.action] - ORDER[b.action] || SURE[a.evidence.confidence] - SURE[b.evidence.confidence] || a.service_name.localeCompare(b.service_name) || a.location_name.localeCompare(b.location_name)) : []), [data]);
  const count = (action: Filter) => (action === 'all' ? rows.length : rows.filter((r) => r.action === action).length);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.action === filter);

  const turnOn = async () => {
    if (!data?.available) { setUnlock(true); return; }
    setBusy(true); setTurnOnError(null);
    try { await call({ action: 'enable' }); await reload(); }
    catch { setTurnOnError(t('revenue.pricePilot.off.turnOnError')); }
    finally { setBusy(false); }
  };

  const header = <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'growth'))} backLabel={t('revenue.pricePilot.back')}
    trailing={data?.available && data.settings.enabled ? <span className="mova-pp-chip mova-pp-chip--raise">{t('revenue.pricePilot.earlyAccess')}</span> : undefined} />;
  if (loading) return <main className="mova-page mova-pp" aria-busy="true">{header}<p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (!signedIn) return <main className="mova-page mova-pp">{header}<EmptyState title={t('revenue.pricePilot.signIn')} /></main>;
  if (error || !data) return <main className="mova-page mova-pp">{header}<ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void reload()} /></main>;

  if (!data.available || !data.settings.enabled) return <main className="mova-page mova-pp mova-pp--off">
    {header}
    {!online && <OfflineBanner>{t('revenue.pricePilot.offline')}</OfflineBanner>}
    <OffState onTurnOn={() => void turnOn()} busy={busy} error={turnOnError} />
    <UnlockSheet open={unlock} onClose={() => setUnlock(false)} initialPlan="pro" featureName={t('revenue.pricePilot.title')} onUnlocked={() => { setUnlock(false); void reload(); }} />
  </main>;

  const { summary } = data;
  const filters: Array<[Filter, string]> = [
    ['all', t('revenue.pricePilot.overview.all', { count: count('all') })],
    ['raise', t('revenue.pricePilot.overview.raise', { count: count('raise') })],
    ['hold', t('revenue.pricePilot.overview.hold', { count: count('hold') })],
    ['needs_data', t('revenue.pricePilot.overview.needsData', { count: count('needs_data') })],
  ];
  return <main className="mova-page mova-pp">
    {header}
    {!online && <OfflineBanner>{t('revenue.pricePilot.offline')}</OfflineBanner>}
    <div className="mova-pp-head">
      <h1>{t('revenue.pricePilot.overview.title')}</h1>
      <p className="mova-pp-sub">{summary.salons > 0 ? t('revenue.pricePilot.overview.checked', { count: summary.salons, ago: ago(summary.updated_at, t) }) : summary.searching ? t('revenue.pricePilot.overview.searching') : t('revenue.pricePilot.overview.noSalonsYet')}</p>
    </div>
    {summary.suggestions > 0 && <Card tone="inverse" className="mova-pp-hero">
      <span className="mova-pp-hero__label">{t('revenue.pricePilot.overview.readyToReview')}</span>
      <strong className="mova-pp-hero__big">{t('revenue.pricePilot.overview.suggestions', { count: summary.suggestions })}</strong>
      {summary.monthly_change_minor > 0 && <p>{t('revenue.pricePilot.overview.heroBefore')} <b>{t('revenue.pricePilot.overview.heroAmount', { amount: money(summary.monthly_change_minor, lang) })}</b> {t('revenue.pricePilot.overview.heroAfter')}</p>}
      <Button variant="on-dark" onClick={() => navigate(`${base}/review`)}>{t('revenue.pricePilot.overview.reviewAll')}</Button>
    </Card>}
    {rows.length === 0 ? <EmptyState title={t('revenue.pricePilot.overview.noServices')} /> : <>
      <Segmented label={t('revenue.pricePilot.overview.filterLabel')} options={filters.map(([, label]) => label)} value={filters.find(([key]) => key === filter)?.[1] ?? ''} onChange={(label) => setFilter(filters.find(([, l]) => l === label)?.[0] ?? 'all')} />
      <div className="mova-pp-list">{shown.map((row) => <RowCard key={rowKey(row)} row={row} base={base} />)}</div>
      {shown.length === 0 && <p className="mova-pp-sub">{t('revenue.pricePilot.overview.noneInFilter')}</p>}
    </>}
    <div className="mova-pp-row mova-pp-foot"><p className="mova-pp-sub">{t('revenue.pricePilot.never')}</p><Link className="mova-pp-link" to={`${base}/settings`}>{t('revenue.pricePilot.overview.sourcesSettings')}<Chevron /></Link></div>
  </main>;
}

export default PricePilotOverviewPage;
