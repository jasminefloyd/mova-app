import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, ScreenHeader } from '../../../components';
import { operatorUrl } from '../../../app/operator-url';
import { PilotError, rowKey, usePricePilotOverview } from './api';
import { Tick, money } from './shared';

/** PP4: pick which suggested prices to update, then update them in one go. */
export function PricePilotReviewPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const navigate = useNavigate();
  const { data, error, loading, reload, call, businessId } = usePricePilotOverview();
  const base = operatorUrl(businessId, 'growth/price-pilot');
  const raises = useMemo(() => (data?.available ? data.rows.filter((r) => r.action === 'raise') : []), [data]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // High and medium confidence start ticked; low confidence waits for the stylist.
  useEffect(() => { if (picked === null && raises.length) setPicked(new Set(raises.filter((r) => r.evidence.confidence !== 'low').map(rowKey))); }, [raises, picked]);
  const selected = raises.filter((r) => picked?.has(rowKey(r)));
  const total = selected.reduce((sum, r) => sum + r.impact.change_minor, 0);
  const toggle = (key: string) => setPicked((current) => { const next = new Set(current ?? []); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const header = <ScreenHeader onBack={() => navigate(base)} backLabel={t('revenue.pricePilot.back')} />;
  if (loading) return <main className="mova-page mova-pp" aria-busy="true">{header}<p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (error || !data) return <main className="mova-page mova-pp">{header}<ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void reload()} /></main>;

  const update = async () => {
    setBusy(true); setFailure(null);
    try {
      await call({ action: 'apply', changes: selected.map((r) => ({ service_id: r.service_id, location_id: r.location_id, new_price_minor: r.suggested_minor, expected_current_minor: r.current_minor, reference_median_minor: r.evidence.median, evidence_count: r.evidence.count })) });
      await reload();
      navigate(base);
    } catch (err) {
      setFailure(t(err instanceof PilotError && err.code === 'PRICE_CHANGED' ? 'revenue.pricePilot.apply.changedError' : 'revenue.pricePilot.apply.saveError'));
      void reload();
    } finally { setBusy(false); }
  };

  return <main className="mova-page mova-pp">
    {header}
    <div className="mova-pp-head"><h1>{t('revenue.pricePilot.review.title')}</h1><p className="mova-pp-sub">{t('revenue.pricePilot.review.subtitle')}</p></div>
    {raises.length === 0 ? <EmptyState title={t('revenue.pricePilot.review.none')} /> : <>
      <Card className="mova-pp-card mova-pp-rows">
        {raises.map((r) => {
          const key = rowKey(r);
          const on = picked?.has(key) ?? false;
          return <label key={key} className="mova-pp-pick">
            <input type="checkbox" checked={on} onChange={() => toggle(key)} />
            <span className="mova-pp-pick__box" aria-hidden="true">{on && <Tick />}</span>
            <span className="mova-pp-pick__copy"><strong>{raises.filter((x) => x.service_id === r.service_id).length > 1 ? t('revenue.pricePilot.overview.serviceAt', { service: r.service_name, location: r.location_name }) : r.service_name}</strong>
              <small>{money(r.current_minor, lang)} → {money(r.suggested_minor, lang)}{r.evidence.confidence === 'low' ? ` · ${t('revenue.pricePilot.review.lowConfidence')}` : ''}</small></span>
            {r.impact.change_minor > 0 && <span className={`mova-pp-chip ${r.evidence.confidence === 'low' ? 'mova-pp-chip--hold' : 'mova-pp-chip--raise'}`}>{t('revenue.pricePilot.review.perMonth', { amount: money(r.impact.change_minor, lang) })}</span>}
          </label>;
        })}
      </Card>
      <Card className="mova-pp-card mova-pp-total">
        <div className="mova-pp-row"><span className="mova-pp-sub">{t('revenue.pricePilot.review.selected')}</span><b>{t('revenue.pricePilot.review.services', { count: selected.length })}</b></div>
        <div className="mova-pp-row"><span className="mova-pp-sub">{t('revenue.pricePilot.review.estimated')}</span><b className="mova-pp-total__big">{t('revenue.pricePilot.review.perMonthTotal', { amount: money(total, lang) })}</b></div>
      </Card>
      <p className="mova-pp-sub mova-pp-small">{t('revenue.pricePilot.review.note')}</p>
      {failure && <p className="mova-field__error" role="alert">{failure}</p>}
      <Button loading={busy} disabled={!selected.length} onClick={() => void update()}>{t('revenue.pricePilot.review.update', { count: selected.length })}</Button>
      <Button variant="secondary" onClick={() => navigate(base)}>{t('revenue.pricePilot.review.cancel')}</Button>
    </>}
  </main>;
}

export default PricePilotReviewPage;
