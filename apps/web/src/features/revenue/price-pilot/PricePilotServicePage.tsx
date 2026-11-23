import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, ScreenHeader, Sheet, TextField } from '../../../components';
import { operatorUrl } from '../../../app/operator-url';
import { PilotError, usePricePilotDetail, usePricePilotOverview, type PriceRow } from './api';
import { ActionChip, Chevron, PriceBar, Tick, duration, money } from './shared';

const RADII = [3, 5, 10, 25];
const CHECKS = ['enough_menus', 'fresh', 'clear', 'agree', 'same_length', 'own_bookings'] as const;

/** PP3: confirm a price change, or pick your own price first. */
export function ApplySheet({ row, siblings, open, custom, onClose, onApplied }: {
  row: PriceRow; siblings: PriceRow[]; open: boolean; custom: boolean; onClose: () => void; onApplied: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const { call, reload } = usePricePilotOverview(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Math.round(Number(draft.replace(/[$,\s]/g, '')) * 100);
  const next = custom ? (Number.isFinite(parsed) && parsed >= 100 ? parsed : null) : row.suggested_minor;
  const apply = async () => {
    if (next == null) { setError(t('revenue.pricePilot.apply.priceInvalid')); return; }
    setBusy(true); setError(null);
    try {
      await call({ action: 'apply', changes: [{ service_id: row.service_id, location_id: row.location_id, new_price_minor: next, expected_current_minor: row.current_minor, reference_median_minor: row.evidence.median, evidence_count: row.evidence.count }] });
      await reload();
      onApplied();
    } catch (failure) {
      setError(t(failure instanceof PilotError && failure.code === 'PRICE_CHANGED' ? 'revenue.pricePilot.apply.changedError' : 'revenue.pricePilot.apply.saveError'));
      if (failure instanceof PilotError && failure.code === 'PRICE_CHANGED') void reload();
    } finally { setBusy(false); }
  };
  const others = row.own_location_price ? [] : siblings.filter((s) => s.location_id !== row.location_id);
  return <Sheet open={open} title={custom ? t('revenue.pricePilot.apply.chooseTitle', { service: row.service_name }) : t('revenue.pricePilot.apply.title', { service: row.service_name })} closeLabel={t('revenue.pricePilot.apply.cancel')} onClose={onClose}>
    <div className="mova-pp-apply">
      {custom && <TextField label={t('revenue.pricePilot.apply.priceLabel')} inputMode="decimal" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder={(row.suggested_minor / 100).toFixed(0)} />}
      <div className="mova-pp-apply__compare">
        <span><small>{t('revenue.pricePilot.apply.now')}</small><s>{money(row.current_minor, lang)}</s></span>
        <Chevron />
        <span><small>{t('revenue.pricePilot.apply.new')}</small><b>{next == null ? '—' : money(next, lang)}</b></span>
      </div>
      <ul className="mova-pp-rules">
        <li><Tick />{t('revenue.pricePilot.apply.rule1', { price: next == null ? '—' : money(next, lang) })}</li>
        <li><Tick />{t('revenue.pricePilot.apply.rule2')}</li>
        {others.map((s) => <li key={s.location_id}><Tick />{s.own_location_price ? t('revenue.pricePilot.apply.ruleKeeps', { location: s.location_name, price: money(s.current_minor, lang) }) : t('revenue.pricePilot.apply.ruleAlso', { location: s.location_name, price: next == null ? '—' : money(next, lang) })}</li>)}
      </ul>
      {error && <p className="mova-field__error" role="alert">{error}</p>}
      <Button loading={busy} disabled={next == null} onClick={() => void apply()}>{t('revenue.pricePilot.apply.updatePrice')}</Button>
      <Button variant="secondary" onClick={onClose}>{t('revenue.pricePilot.apply.cancel')}</Button>
    </div>
  </Sheet>;
}

function ThinState({ row, radius, base }: { row: PriceRow; radius: number; base: string }) {
  const { t } = useTranslation();
  const { call, reload } = usePricePilotOverview(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const wider = RADII.find((r) => r > radius);
  const find = async () => {
    setBusy(true); setNote(null);
    try { await call({ action: 'find_salons', location_id: row.location_id }); setNote(t('revenue.pricePilot.thin.searchQueued')); void reload(); }
    catch (failure) { setNote(t(failure instanceof PilotError && failure.code === 'PRICE_PILOT_LIMIT_REACHED' ? 'revenue.pricePilot.errors.PRICE_PILOT_LIMIT_REACHED_short' : 'revenue.pricePilot.errors.generic')); }
    finally { setBusy(false); }
  };
  return <>
    <Card className="mova-pp-card mova-pp-main">
      <div><h2 className="mova-pp-title-m">{t('revenue.pricePilot.thin.title')}</h2><p className="mova-pp-sub">{t('revenue.pricePilot.thin.body', { count: row.evidence.count })}</p></div>
      <div><div className="mova-pp-row"><span className="mova-pp-label">{t('revenue.pricePilot.thin.menusFound')}</span><b>{t('revenue.pricePilot.thin.ofFive', { count: row.evidence.count })}</b></div>
        <div className="mova-pp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={row.evidence.count}><i style={{ width: `${Math.min(100, row.evidence.count * 20)}%` }} /></div></div>
      <Button loading={busy} onClick={() => void find()}>{t('revenue.pricePilot.thin.findSalons')}</Button>
      <Link className="mova-button mova-button--secondary" to={`${base}/settings#add-menu`}>{t('revenue.pricePilot.thin.addMenuLink')}</Link>
      {note && <p className="mova-pp-sub" role="status">{note}</p>}
    </Card>
    <Card className="mova-pp-card">
      <h2>{t('revenue.pricePilot.thin.helpsTitle')}</h2>
      <p className="mova-pp-sub">{t('revenue.pricePilot.thin.helps1')}</p>
      {wider && <p className="mova-pp-sub">{t('revenue.pricePilot.thin.helps2', { from: radius, to: wider })}</p>}
      <Link className="mova-pp-link" to={`${base}/settings`}>{t('revenue.pricePilot.thin.changeRadius')}<Chevron /></Link>
    </Card>
  </>;
}

export function PricePilotServicePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const navigate = useNavigate();
  const { serviceId, locationId } = useParams();
  const { data, error, loading, reload, call, businessId } = usePricePilotOverview();
  const { detail } = usePricePilotDetail(serviceId, locationId);
  const [sheet, setSheet] = useState<'suggested' | 'custom' | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const base = operatorUrl(businessId, 'growth/price-pilot');
  const row = data?.available ? data.rows.find((r) => r.service_id === serviceId && r.location_id === locationId) : undefined;
  const back = () => navigate(base);
  const header = <ScreenHeader onBack={back} backLabel={t('revenue.pricePilot.back')} trailing={row ? <ActionChip action={row.action} t={t} /> : undefined} />;
  if (loading) return <main className="mova-page mova-pp" aria-busy="true">{header}<p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (error || !data) return <main className="mova-page mova-pp">{header}<ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void reload()} /></main>;
  if (!row || !data.available) return <main className="mova-page mova-pp">{header}<EmptyState title={t('revenue.pricePilot.detail.notFound')} /></main>;

  const siblings = data.rows.filter((r) => r.service_id === row.service_id);
  const e = row.evidence;
  const head = <div className="mova-pp-head"><h1>{row.service_name}</h1><p className="mova-pp-sub">{t('revenue.pricePilot.detail.youChargeLine', { duration: duration(row.duration_minutes, t), location: row.location_name, price: money(row.current_minor, lang) })}</p></div>;
  if (row.action === 'needs_data') return <main className="mova-page mova-pp">{header}{head}<ThinState row={row} radius={data.settings.radius_miles} base={base} /></main>;

  const serviceLower = row.service_name.toLocaleLowerCase(lang);
  const why: string[] = [];
  if (row.action === 'raise') why.push(t('revenue.pricePilot.detail.whyBelow', { count: e.below_count, total: e.count, duration: duration(row.duration_minutes, t), service: serviceLower }));
  else why.push(t(row.above_range ? 'revenue.pricePilot.detail.whyAbove' : 'revenue.pricePilot.detail.whyWithin', { total: e.count }));
  if (row.bookings_90d >= 3) {
    const lead = row.avg_lead_days ?? 0;
    const ahead = lead >= 14 ? t('revenue.pricePilot.detail.aheadWeeks', { count: Math.round(lead / 7) }) : t('revenue.pricePilot.detail.aheadDays', { count: Math.max(1, Math.round(lead)) });
    why.push(t(row.bookings_90d >= 6 ? 'revenue.pricePilot.detail.whyCalendarSteady' : 'revenue.pricePilot.detail.whyCalendar', { count: row.bookings_90d, ahead }));
  }
  const nearby = detail?.ratings.nearby_average;
  const own = detail?.ratings.own_average;
  if (nearby != null) {
    const rating = nearby.toFixed(1);
    why.push(own == null ? t('revenue.pricePilot.detail.whyRatings', { rating }) : Math.abs(own - nearby) <= 0.2 ? t('revenue.pricePilot.detail.whyRatingsClose', { rating }) : own > nearby ? t('revenue.pricePilot.detail.whyRatingsHigher', { rating }) : t('revenue.pricePilot.detail.whyRatingsLower', { rating }));
  }
  const oldest = detail?.menus.reduce<number | null>((min, m) => { const v = Date.parse(m.checked_at); return Number.isFinite(v) && (min === null || v < min) ? v : min; }, null);
  const days = oldest == null ? null : Math.max(1, Math.ceil((Date.now() - oldest) / 86400000));
  const minEdge = Math.min(e.min, row.current_minor, row.suggested_minor);
  const maxEdge = Math.max(e.max, row.current_minor, row.suggested_minor);
  const dismiss = async () => {
    setDismissing(true);
    try { await call({ action: 'dismiss', service_id: row.service_id, location_id: row.location_id }); await reload(); back(); } finally { setDismissing(false); }
  };

  return <main className="mova-page mova-pp">
    {header}{head}
    <Card className="mova-pp-card mova-pp-main">
      <div><span className="mova-pp-label">{t('revenue.pricePilot.detail.suggestedPrice')}</span>
        <div className="mova-pp-suggested"><strong>{money(row.suggested_minor, lang)}</strong><span className="mova-pp-sub">{t('revenue.pricePilot.detail.range', { low: money(e.range_low, lang), high: money(e.range_high, lang) })}</span></div></div>
      <PriceBar row={row} showMedian label={t('revenue.pricePilot.barLabel', { current: money(row.current_minor, lang), low: money(e.range_low, lang), high: money(e.range_high, lang) })} />
      <div className="mova-pp-row mova-pp-edges"><span>{money(minEdge, lang)}</span><span>{t('revenue.pricePilot.detail.marketMedian', { price: money(e.median, lang) })}</span><span>{money(maxEdge, lang)}</span></div>
      <div className="mova-pp-legend"><span><i className="is-you" />{t('revenue.pricePilot.detail.legendYou')}</span><span><i className="is-suggested" />{t('revenue.pricePilot.detail.legendSuggested')}</span><span><i className="is-range" />{t('revenue.pricePilot.detail.legendRange')}</span></div>
      {row.action === 'raise' && <Button onClick={() => setSheet('suggested')}>{t('revenue.pricePilot.detail.update', { price: money(row.suggested_minor, lang) })}</Button>}
      {row.above_range && <p className="mova-pp-sub">{t('revenue.pricePilot.detail.aboveNote')}</p>}
      <div className="mova-pp-row mova-pp-actions">
        <button type="button" className="mova-pp-textbtn" onClick={() => setSheet('custom')}>{t('revenue.pricePilot.detail.chooseAnother')}</button>
        {row.action === 'raise' && <button type="button" className="mova-pp-textbtn is-muted" disabled={dismissing} onClick={() => void dismiss()}>{t('revenue.pricePilot.detail.notNow')}</button>}
      </div>
    </Card>
    <Card className="mova-pp-card"><h2>{t('revenue.pricePilot.detail.whyTitle')}</h2>
      <ul className="mova-pp-why">{why.map((line) => <li key={line}><span className="mova-pp-tickdot"><Tick /></span><span>{line}</span></li>)}</ul></Card>
    {row.action === 'raise' && <Card className="mova-pp-card"><h2>{t('revenue.pricePilot.detail.impactTitle')}</h2>
      {row.bookings_90d > 0 ? <>
        <div className="mova-pp-impact"><div><span className="mova-pp-label">{t('revenue.pricePilot.detail.now')}</span><b>{money(row.impact.now_minor, lang)}</b><small>{t('revenue.pricePilot.detail.aMonth')}</small></div>
          <div className="is-new"><span className="mova-pp-label">{t('revenue.pricePilot.detail.at', { price: money(row.suggested_minor, lang) })}</span><b>{money(row.impact.then_minor, lang)}</b><small>{t('revenue.pricePilot.detail.plusMonth', { amount: money(row.impact.change_minor, lang) })}</small></div></div>
        <p className="mova-pp-sub mova-pp-small">{t('revenue.pricePilot.detail.impactNote', { count: row.impact.per_month, service: serviceLower })}</p>
      </> : <p className="mova-pp-sub">{t('revenue.pricePilot.detail.impactNone')}</p>}
    </Card>}
    <Card className="mova-pp-card mova-pp-rows">
      <button type="button" className="mova-pp-linkrow" aria-expanded={showChecks} onClick={() => setShowChecks((v) => !v)}><span><strong>{t('revenue.pricePilot.detail.sure')}</strong><small>{t('revenue.pricePilot.detail.sureLine', { level: t(`revenue.pricePilot.level.${e.confidence}`), passed: e.passed })}</small></span><Chevron /></button>
      {showChecks && <ul className="mova-pp-checks">{CHECKS.map((key) => <li key={key} className={e.checks[key] ? 'is-pass' : 'is-fail'}><span aria-hidden="true">{e.checks[key] ? '✓' : '–'}</span>{t(`revenue.pricePilot.checks.${key}`)}<span className="mova-visually-hidden">{e.checks[key] ? t('revenue.pricePilot.checks.passed') : t('revenue.pricePilot.checks.notPassed')}</span></li>)}</ul>}
      <Link className="mova-pp-linkrow" to={`${base}/compare?service=${row.service_id}&location=${row.location_id}`}><span><strong>{t('revenue.pricePilot.detail.comparedWith', { count: e.count })}</strong><small>{days == null ? t('revenue.pricePilot.detail.comparedWithin', { miles: data.settings.radius_miles }) : t('revenue.pricePilot.detail.comparedLine', { miles: data.settings.radius_miles, count: days })}</small></span><Chevron /></Link>
    </Card>
    {detail?.bls && <p className="mova-pp-sub mova-pp-small mova-pp-center">{t(`revenue.pricePilot.detail.bls_${detail.bls.area}`, { wage: new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(detail.bls.hourly_median) })}</p>}
    <ApplySheet row={row} siblings={siblings} open={sheet !== null} custom={sheet === 'custom'} onClose={() => setSheet(null)} onApplied={() => { setSheet(null); back(); }} />
  </main>;
}

export default PricePilotServicePage;
