import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, ErrorState, ScreenHeader, Segmented } from '../../../components';
import { operatorUrl } from '../../../app/operator-url';
import { usePricePilotDetail, usePricePilotOverview } from './api';
import { PriceBar, duration, money } from './shared';

/** PP5: the menus behind a suggestion, and nearby salons whose menu Mova hasn't read yet. */
export function PricePilotComparePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload, businessId } = usePricePilotOverview();
  const base = operatorUrl(businessId, 'growth/price-pilot');
  const rows = data?.available ? data.rows : [];
  const locationId = params.get('location') ?? rows[0]?.location_id ?? undefined;
  const choices = rows.filter((r) => r.location_id === locationId && r.evidence.count > 0);
  const serviceId = params.get('service') ?? choices[0]?.service_id ?? undefined;
  const row = rows.find((r) => r.service_id === serviceId && r.location_id === locationId);
  const { detail, error: detailError } = usePricePilotDetail(row?.service_id, row?.location_id);
  const header = <ScreenHeader onBack={() => (row ? navigate(`${base}/${row.service_id}/${row.location_id}`) : navigate(base))} backLabel={t('revenue.pricePilot.back')} />;
  if (loading) return <main className="mova-page mova-pp" aria-busy="true">{header}<p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (error || !data) return <main className="mova-page mova-pp">{header}<ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void reload()} /></main>;
  if (!row || !data.available) return <main className="mova-page mova-pp">{header}<EmptyState title={t('revenue.pricePilot.compare.noMenus')} /></main>;
  const e = row.evidence;
  const place = row.current_minor < e.range_low ? 'below' : row.current_minor > e.range_high ? 'above' : 'within';
  const date = (iso: string) => new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(new Date(iso));
  const miles = (value: number | null) => (value == null ? null : new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value));
  const labels = choices.map((c) => c.service_name);
  return <main className="mova-page mova-pp">
    {header}
    <div className="mova-pp-head"><h1>{t('revenue.pricePilot.compare.title')}</h1><p className="mova-pp-sub">{t('revenue.pricePilot.compare.subtitle', { service: row.service_name, duration: duration(row.duration_minutes, t), miles: data.settings.radius_miles })}</p></div>
    {choices.length > 1 && <Segmented label={t('revenue.pricePilot.compare.servicesLabel')} options={labels} value={row.service_name} onChange={(name) => { const next = choices.find((c) => c.service_name === name); if (next) setParams({ service: next.service_id, location: next.location_id }, { replace: true }); }} />}
    {e.count > 0 && <Card className="mova-pp-card">
      <div className="mova-pp-row"><div><span className="mova-pp-label">{t('revenue.pricePilot.compare.middleRange')}</span><b className="mova-pp-num">{money(e.range_low, lang)}–{money(e.range_high, lang)}</b></div>
        <div className="mova-pp-right"><span className="mova-pp-label">{t('revenue.pricePilot.compare.median')}</span><b className="mova-pp-num">{money(e.median, lang)}</b></div></div>
      <PriceBar row={row} showMedian showSuggested={false} label={t('revenue.pricePilot.barLabel', { current: money(row.current_minor, lang), low: money(e.range_low, lang), high: money(e.range_high, lang) })} />
      <p className="mova-pp-sub mova-pp-small">{t(`revenue.pricePilot.compare.youAre_${place}`, { price: money(row.current_minor, lang) })}</p>
    </Card>}
    <h2 className="mova-pp-h2">{t('revenue.pricePilot.compare.menusUsed', { count: detail?.menus.length ?? e.count })}</h2>
    {detailError ? <p className="mova-pp-sub">{t('revenue.pricePilot.errors.generic')}</p> : !detail ? <p className="mova-pp-sub" role="status">{t('revenue.pricePilot.loading')}</p> : detail.menus.length === 0 ? <p className="mova-pp-sub">{t('revenue.pricePilot.compare.noMenus')}</p> :
      <Card className="mova-pp-card mova-pp-rows">{detail.menus.map((m) => <div key={m.source_id} className="mova-pp-listrow"><span><strong>{m.name}</strong><small>{miles(m.distance_miles) ? t('revenue.pricePilot.compare.menuLine', { miles: miles(m.distance_miles), date: date(m.checked_at) }) : t('revenue.pricePilot.compare.menuLineNoMiles', { date: date(m.checked_at) })}</small></span><b className="mova-pp-num-s">{money(m.price_minor, lang)}</b></div>)}</Card>}
    {detail && detail.without_menu.length > 0 && <>
      <h2 className="mova-pp-h2">{t('revenue.pricePilot.compare.foundNoMenu', { count: detail.without_menu.length })}</h2>
      <Card className="mova-pp-card mova-pp-rows">{detail.without_menu.map((s) => <div key={s.source_id} className="mova-pp-listrow"><span><strong>{s.name}</strong><small>{[miles(s.distance_miles) ? t('revenue.pricePilot.compare.miles', { miles: miles(s.distance_miles) }) : null, s.rating != null ? `${s.rating.toFixed(1)}★` : null, t('revenue.pricePilot.compare.google')].filter(Boolean).join(' · ')}</small></span>
        <Link className="mova-pp-pill" to={`${base}/settings${s.website_url ? `?url=${encodeURIComponent(s.website_url)}` : ''}#add-menu`}>{t('revenue.pricePilot.compare.addMenu')}</Link></div>)}</Card>
    </>}
    <p className="mova-pp-sub mova-pp-tiny">{t('revenue.pricePilot.compare.footnote')}</p>
  </main>;
}

export default PricePilotComparePage;
