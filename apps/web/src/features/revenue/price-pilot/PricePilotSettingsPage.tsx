import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, ScreenHeader, Segmented, TextField, Toggle } from '../../../components';
import { operatorUrl } from '../../../app/operator-url';
import { PilotError, usePricePilotOverview, type Settings } from './api';
import { Tick } from './shared';

const RADII = [3, 5, 10, 25];
const ERRORS = ['PRICE_PILOT_LIMIT_REACHED', 'AUTHORIZATION_REQUIRED', 'MENU_URL_INVALID', 'NO_MENU_PRICES_FOUND', 'FIRECRAWL_NOT_CONFIGURED', 'MENU_READ_FAILED', 'COMPETITOR_MENUS_OFF'];

/** PP7: comparison radius, where PricePilot looks, adding a competitor menu, and this month's checks. */
export function PricePilotSettingsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data, error, loading, reload, call, businessId } = usePricePilotOverview();
  const base = operatorUrl(businessId, 'growth/price-pilot');
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const addRef = useRef<HTMLElement>(null);
  useEffect(() => { if (window.location.hash === '#add-menu') addRef.current?.scrollIntoView({ block: 'start' }); }, [loading]);
  const header = <ScreenHeader onBack={() => navigate(base)} backLabel={t('revenue.pricePilot.back')} />;
  if (loading) return <main className="mova-page mova-pp" aria-busy="true">{header}<p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (error || !data || !data.available) return <main className="mova-page mova-pp">{header}<ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void reload()} /></main>;
  const { settings, usage } = data;
  const resets = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${usage.resets_on}T00:00:00Z`));

  const save = async (patch: Partial<Settings>) => {
    setSaving(true); setMessage(null);
    try { await call({ action: 'settings_save', ...patch }); await reload(); }
    catch { setMessage({ kind: 'error', text: t('revenue.pricePilot.errors.generic') }); }
    finally { setSaving(false); }
  };
  const check = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await call<{ imported: number; name: string }>({ action: 'add_menu', url: url.trim(), authorized: allowed, location_id: data.locations[0]?.id });
      setMessage({ kind: 'ok', text: t('revenue.pricePilot.settings.added', { name: result.name, count: result.imported }) });
      setUrl(''); setAllowed(false);
      await reload();
    } catch (failure) {
      const code = failure instanceof PilotError && ERRORS.includes(failure.code) ? failure.code : 'generic';
      setMessage({ kind: 'error', text: t(`revenue.pricePilot.errors.${code}`, { date: resets }) });
    } finally { setBusy(false); }
  };
  const radiusLabels = RADII.map((r) => t('revenue.pricePilot.settings.radiusOption', { count: r }));
  const usedPct = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 100;

  return <main className="mova-page mova-pp">
    {header}
    <div className="mova-pp-head"><h1>{t('revenue.pricePilot.settings.title')}</h1></div>
    <Card className="mova-pp-card">
      <div className="mova-pp-row"><h2>{t('revenue.pricePilot.settings.radiusTitle')}</h2><b>{t('revenue.pricePilot.settings.radiusValue', { count: settings.radius_miles })}</b></div>
      <Segmented label={t('revenue.pricePilot.settings.radiusTitle')} options={radiusLabels} disabled={saving} value={radiusLabels[RADII.indexOf(settings.radius_miles)] ?? ''} onChange={(label) => { const radius = RADII[radiusLabels.indexOf(label)]; if (radius) void save({ radius_miles: radius }); }} />
      <p className="mova-pp-sub mova-pp-small">{t('revenue.pricePilot.settings.radiusNote')}</p>
    </Card>
    <Card className="mova-pp-card mova-pp-where">
      <h2>{t('revenue.pricePilot.settings.whereTitle')}</h2>
      <Toggle label={t('revenue.pricePilot.settings.nearby')} description={t('revenue.pricePilot.settings.nearbyNote')} checked={settings.use_nearby_salons} disabled={saving} onChange={(value) => void save({ use_nearby_salons: value })} />
      <Toggle label={t('revenue.pricePilot.settings.menus')} description={t('revenue.pricePilot.settings.menusNote')} checked={settings.use_competitor_menus} disabled={saving} onChange={(value) => void save({ use_competitor_menus: value })} />
      <Toggle label={t('revenue.pricePilot.settings.bls')} description={t('revenue.pricePilot.settings.blsNote')} checked={settings.show_industry_context} disabled={saving} onChange={(value) => void save({ show_industry_context: value })} />
    </Card>
    <Card className="mova-pp-card" >
      <section id="add-menu" ref={addRef} className="mova-pp-add">
        <h2>{t('revenue.pricePilot.settings.addTitle')}</h2>
        <TextField label={t('revenue.pricePilot.settings.menuLink')} type="url" inputMode="url" value={url} placeholder={t('revenue.pricePilot.settings.menuPlaceholder')} onChange={(event) => setUrl(event.currentTarget.value)} disabled={!settings.use_competitor_menus} />
        <label className="mova-pp-consent">
          <input type="checkbox" checked={allowed} onChange={(event) => setAllowed(event.currentTarget.checked)} disabled={!settings.use_competitor_menus} />
          <span className="mova-pp-pick__box" aria-hidden="true">{allowed && <Tick />}</span>
          <span>{t('revenue.pricePilot.settings.allowed')}</span>
        </label>
        <Button loading={busy} disabled={!settings.use_competitor_menus || !url.trim() || !allowed || usage.used >= usage.limit} onClick={() => void check()}>{t('revenue.pricePilot.settings.check')}</Button>
        {message && <p className={message.kind === 'error' ? 'mova-field__error' : 'mova-pp-sub'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      </section>
    </Card>
    <Card className="mova-pp-card">
      <div className="mova-pp-row"><h2>{t('revenue.pricePilot.settings.checksTitle')}</h2><b>{t('revenue.pricePilot.settings.checksValue', { used: usage.used, limit: usage.limit })}</b></div>
      <div className="mova-pp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used}><i style={{ width: `${usedPct}%` }} /></div>
      <p className="mova-pp-sub mova-pp-small">{t('revenue.pricePilot.settings.checksNote', { date: resets })}</p>
    </Card>
  </main>;
}

export default PricePilotSettingsPage;
