import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Checkbox, EmptyState, ErrorState, OfflineBanner, ScreenHeader, StatusChip, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { buildPriceEvidenceDetails, findComparableObservations, type PriceEvidenceDetails, type PricePilotObservation } from './price-pilot-model';
import { PricePositionChart } from './PricePositionChart';

type Service = { id: string; name: string; category: string | null; duration_minutes: number; base_price_minor: number };
type Location = { id: string; name: string; address: Record<string, unknown> };
type Override = { service_id: string; location_id: string; price_minor_override: number | null; duration_minutes_override: number | null };
type EntitlementResponse = { features?: Record<string, boolean> };
type DirectoryResult = { name: string; address: string; website: string; url: string; provider: string; attribution: string };
type PlanRow = {
  id: string; location_id: string; service_id: string; current_price_minor: number; target_price_minor: number;
  reference_median_minor: number | null; evidence_count: number; mova_services: { name: string } | null; mova_locations: { name: string } | null;
};
type SavedPlan = { id: string; serviceName: string; locationName: string; current: number; target: number; median: number; evidenceCount: number };

const DEFAULT_RADIUS = 5;

/** Maps machine error codes from the price-pilot function to a translated message key. */
const FAILURE_KEYS: Record<string, string> = {
  OWN_WEBSITE_REQUIRED: 'revenue.pricePilot.ownWebsiteRequired',
  MENU_NOT_ON_OWN_WEBSITE: 'revenue.pricePilot.menuNotOnOwnWebsite',
  PRICE_PILOT_LIMIT_REACHED: 'revenue.pricePilot.limitReached',
  SOURCE_NOT_FOUND: 'revenue.pricePilot.sourceMissing',
  RADIUS_INVALID: 'revenue.pricePilot.radiusInvalid',
};

/** Host without a leading www., or null when the value is not a URL. */
function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** The error code and request reference that invokePilot packs into an Error message. */
function pilotFailure(error: unknown): { code: string; ref: string } {
  const message = error instanceof Error ? error.message : String(error);
  const [code = '', ref = ''] = message.split('::');
  return { code, ref };
}

function toSavedPlan(row: PlanRow): SavedPlan {
  return {
    id: row.id,
    serviceName: row.mova_services?.name ?? '',
    locationName: row.mova_locations?.name ?? '',
    current: row.current_price_minor,
    target: row.target_price_minor,
    median: row.reference_median_minor ?? 0,
    evidenceCount: row.evidence_count,
  };
}

function ComparableSources({ observations, locale, formatPrice, confidenceLabel, matchLabel, nearbyLabel, headingLabel, viewLabel, removeLabel, busy, onRemove }: {
  observations: PricePilotObservation[]; locale: string | undefined; formatPrice: (minor: number) => string;
  confidenceLabel: string; matchLabel: string; nearbyLabel: string; headingLabel: string; viewLabel: string; removeLabel: string; busy: boolean; onRemove: (sourceId: string) => void;
}) {
  if (!observations.length) return null;
  return <Card className="mova-price-pilot__sources"><h3>{headingLabel}</h3><ul>{observations.map((item) => <li key={item.id}><div><strong>{item.mova_price_pilot_sources.normalized_host}</strong><span>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.observed_at))} · {Math.round(item.extraction_confidence * 100)}% {confidenceLabel} · {item.geographic_match_scope === 'nearby_postal_code' ? nearbyLabel : matchLabel}</span></div><strong>{formatPrice(item.price_min_minor)}{item.price_max_minor > item.price_min_minor ? `–${formatPrice(item.price_max_minor)}` : ''}</strong><a href={item.mova_price_pilot_sources.submitted_url} target="_blank" rel="noreferrer">{viewLabel}</a><Button variant="ghost" disabled={busy} onClick={() => onRemove(item.source_id)}>{removeLabel}</Button></li>)}</ul></Card>;
}

function UnmatchedSources({ observations, heading, detail, removeLabel, busy, onRemove }: { observations: PricePilotObservation[]; heading: string; detail: string; removeLabel: string; busy: boolean; onRemove: (sourceId: string) => void }) {
  const sources = [...new Map(observations.filter((item) => !item.geographic_match).map((item) => [item.source_id, item])).values()];
  if (!sources.length) return null;
  return <Card className="mova-price-pilot__sources mova-price-pilot__sources--unmatched"><h3>{heading}</h3><p>{detail}</p><ul>{sources.map((item) => <li key={item.source_id}><strong>{item.mova_price_pilot_sources.normalized_host}</strong><Button variant="ghost" disabled={busy} onClick={() => onRemove(item.source_id)}>{removeLabel}</Button></li>)}</ul></Card>;
}

function csvCell(value: string | number) {
  const safe = String(value).replace(/[\r\n]+/g, ' ');
  return `"${(/^[=+\-@]/.test(safe) ? `'${safe}` : safe).replace(/"/g, '""')}"`;
}

export function PricePilotPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [services, setServices] = useState<Service[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [ownHostName, setOwnHostName] = useState<string | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [radiusDraft, setRadiusDraft] = useState(String(DEFAULT_RADIUS));
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [observations, setObservations] = useState<PricePilotObservation[]>([]);
  const [observationsLoading, setObservationsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [menuUrl, setMenuUrl] = useState('');
  const [marketLocation, setMarketLocation] = useState('');
  const [directoryResults, setDirectoryResults] = useState<DirectoryResult[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [opportunitiesOnly, setOpportunitiesOnly] = useState(false);
  const [planTarget, setPlanTarget] = useState('');

  const invokePilot = useCallback(async (body: Record<string, unknown>) => {
    if (!client || !businessId) throw new Error('PRICE_PILOT_ACTION_FAILED::');
    const result = await client.functions.invoke<{ data?: Record<string, unknown>; error?: { code?: string }; request_id?: string }>('price-pilot', { body, headers: { 'x-mova-artist-business-id': businessId } });
    if (result.error) {
      // Non-2xx responses keep the function's error code in the response body.
      const context = (result.error as { context?: Response }).context;
      const failed = context ? await context.json().catch(() => null) as { error?: { code?: string }; request_id?: string } | null : null;
      throw new Error(`${failed?.error?.code ?? 'PRICE_PILOT_ACTION_FAILED'}::${failed?.request_id ?? ''}`);
    }
    if (result.data?.error) throw new Error(`${result.data.error.code ?? 'PRICE_PILOT_ACTION_FAILED'}::${result.data.request_id ?? ''}`);
    return result.data?.data ?? null;
  }, [client, businessId]);

  const failureMessage = useCallback((failure: unknown, fallbackKey: 'actionError' | 'importError') => {
    const { code, ref } = pilotFailure(failure);
    const base = t(FAILURE_KEYS[code] ?? `revenue.pricePilot.${fallbackKey}`);
    return ref ? `${base} ${t('revenue.pricePilot.reference', { id: ref })}` : base;
  }, [t]);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await invokePilot({ action: 'settings_get' }) as { radius_miles?: number } | null;
      const next = Number(settings?.radius_miles ?? DEFAULT_RADIUS);
      setRadius(next);
      setRadiusDraft(String(next));
    } catch (failure) {
      setActionError(failureMessage(failure, 'actionError'));
    }
  }, [invokePilot, failureMessage]);

  const loadPlans = useCallback(async () => {
    try {
      const response = await invokePilot({ action: 'plan_list' }) as { plans?: PlanRow[] } | null;
      setSavedPlans((response?.plans ?? []).map(toSavedPlan));
    } catch (failure) {
      setActionError(failureMessage(failure, 'actionError'));
    }
  }, [invokePilot, failureMessage]);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true);
    setError(false);
    try {
      const [serviceResult, locationResult, planResult, profileResult] = await Promise.all([
        client.from('mova_services').select('id,name,category,duration_minutes,base_price_minor').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
        client.from('mova_locations').select('id,name,address').eq('artist_business_id', businessId).eq('is_active', true).order('name'),
        client.functions.invoke<{ data?: EntitlementResponse }>('plan-management', { body: { action: 'get' }, headers: { 'x-mova-artist-business-id': businessId } }),
        client.from('mova_artist_profiles').select('website_url').eq('artist_business_id', businessId).maybeSingle(),
      ]);
      if (serviceResult.error || locationResult.error || planResult.error || profileResult.error) throw new Error('PRICE_PILOT_LOAD_FAILED');
      const serviceRows = (serviceResult.data ?? []) as Service[];
      const locationRows = (locationResult.data ?? []) as Location[];
      const serviceLocations = serviceRows.length
        ? await client.from('mova_service_locations').select('service_id,location_id,price_minor_override,duration_minutes_override').in('service_id', serviceRows.map((service) => service.id))
        : { data: [], error: null };
      if (serviceLocations.error) throw new Error('PRICE_PILOT_LOAD_FAILED');
      setServices(serviceRows);
      setLocations(locationRows);
      setOverrides((serviceLocations.data ?? []) as Override[]);
      setOwnHostName(hostOf((profileResult.data as { website_url?: string | null } | null)?.website_url));
      const enabled = planResult.data?.data?.features?.ai_price_pilot === true;
      setFeatureEnabled(enabled);
      if (enabled) await Promise.all([loadSettings(), loadPlans()]);
      else { setObservations([]); setSavedPlans([]); }
      setServiceId((current) => serviceRows.some((service) => service.id === current) ? current : serviceRows[0]?.id ?? '');
      setLocationId((current) => locationRows.some((location) => location.id === current) ? current : locationRows[0]?.id ?? '');
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, client, loadSettings, loadPlans]);

  const discover = async () => {
    setActionBusy(true); setActionError(''); setDirectoryResults([]);
    try {
      const data = await invokePilot({ action: 'discover', location: marketLocation }) as { results?: Array<{ provider: string; results: DirectoryResult[] }> } | null;
      setDirectoryResults((data?.results ?? []).flatMap((provider) => provider.results));
    } catch (failure) { setActionError(failureMessage(failure, 'actionError')); }
    finally { setActionBusy(false); }
  };

  /** Checks a menu page. The function accepts only pages on the stylist's own website. */
  const importMenu = async (url: string) => {
    setActionBusy(true); setActionError('');
    try {
      await invokePilot({ action: 'import_menu', url });
      setMenuUrl('');
      setReloadKey((key) => key + 1);
    } catch (failure) { setActionError(failureMessage(failure, 'importError')); }
    finally { setActionBusy(false); }
  };

  const removeSource = async (sourceId: string) => {
    if (!window.confirm(t('revenue.pricePilot.removeSourceConfirm'))) return;
    setActionBusy(true); setActionError('');
    try {
      await invokePilot({ action: 'remove_source', source_id: sourceId });
      setReloadKey((key) => key + 1);
    } catch (failure) {
      setActionError(failureMessage(failure, 'actionError'));
      // A source that is already gone should disappear from the list rather than stay on screen.
      if (pilotFailure(failure).code === 'SOURCE_NOT_FOUND') setReloadKey((key) => key + 1);
    }
    finally { setActionBusy(false); }
  };

  const saveRadius = async () => {
    const value = Math.round(Number(radiusDraft));
    if (!Number.isInteger(value) || value < 1 || value > 15) { setActionError(t('revenue.pricePilot.radiusInvalid')); return; }
    setActionBusy(true); setActionError('');
    try {
      await invokePilot({ action: 'settings_save', radius_miles: value });
      setRadius(value);
      setRadiusDraft(String(value));
      setReloadKey((key) => key + 1);
    } catch (failure) { setActionError(failureMessage(failure, 'actionError')); }
    finally { setActionBusy(false); }
  };

  const removePlan = async (planId: string) => {
    setActionBusy(true); setActionError('');
    try {
      await invokePilot({ action: 'plan_remove', plan_id: planId });
      await loadPlans();
    } catch (failure) { setActionError(failureMessage(failure, 'actionError')); }
    finally { setActionBusy(false); }
  };

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    if (!client || !businessId || !featureEnabled || !locationId) { setObservations([]); setObservationsLoading(false); return; }
    setObservationsLoading(true);
    setObservations([]);
    void invokePilot({ action: 'list', location_id: locationId })
      .then((data) => { if (active) setObservations((data as { observations?: PricePilotObservation[] } | null)?.observations ?? []); })
      .catch((failure) => { if (active) { setActionError(failureMessage(failure, 'actionError')); setObservations([]); } })
      .finally(() => { if (active) setObservationsLoading(false); });
    return () => { active = false; };
  }, [client, businessId, featureEnabled, locationId, reloadKey, invokePilot, failureMessage]);
  useEffect(() => {
    setOffline(!navigator.onLine);
    const online = () => setOffline(false);
    const offlineEvent = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offlineEvent);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineEvent); };
  }, []);

  const selectedService = services.find((service) => service.id === serviceId);
  const selectedLocation = locations.find((location) => location.id === locationId);
  const priceFor = (service: Service) => overrides.find((item) => item.service_id === service.id && item.location_id === locationId)?.price_minor_override ?? service.base_price_minor;
  const durationFor = (service: Service) => overrides.find((item) => item.service_id === service.id && item.location_id === locationId)?.duration_minutes_override ?? service.duration_minutes;
  const priceMinor = selectedService ? priceFor(selectedService) : null;
  const duration = selectedService ? durationFor(selectedService) : null;
  const currency = useMemo(() => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD' }), [i18n.resolvedLanguage]);
  const marketLabel = selectedLocation?.name ?? t('revenue.pricePilot.chooseLocation');
  const evidenceByService = useMemo(() => new Map(services.map((service) => [service.id, buildPriceEvidenceDetails(observations, {
    name: service.name, category: service.category, durationMinutes: durationFor(service), currency: 'USD', currentPriceMinor: priceFor(service),
  })])), [services, observations, overrides, locationId]);
  const priceEvidence: PriceEvidenceDetails | null = selectedService ? evidenceByService.get(selectedService.id) ?? null : null;
  const comparableObservations = selectedService ? findComparableObservations(observations, {
    name: selectedService.name, category: selectedService.category, durationMinutes: duration ?? null, currency: 'USD',
  }) : [];
  const serviceRows = useMemo(() => services.map((service) => ({ service, price: priceFor(service), evidence: evidenceByService.get(service.id) ?? null }))
    .filter((item) => !opportunitiesOnly || (item.evidence && item.price < item.evidence.low))
    .sort((a, b) => Number(Boolean(b.evidence && b.price < b.evidence.low)) - Number(Boolean(a.evidence && a.price < a.evidence.low)) || a.service.name.localeCompare(b.service.name)),
  [services, evidenceByService, overrides, locationId, opportunitiesOnly]);

  useEffect(() => { setPlanTarget(''); }, [serviceId, locationId, priceEvidence?.median]);

  const addToPlan = async () => {
    if (!selectedService || !priceEvidence || priceMinor == null || !locationId) return;
    const target = Math.round(Number(planTarget) * 100);
    if (!Number.isFinite(target) || target < 1) return;
    setActionBusy(true); setActionError('');
    try {
      await invokePilot({
        action: 'plan_save', location_id: locationId, service_id: selectedService.id,
        current_price_minor: priceMinor, target_price_minor: target,
        reference_median_minor: priceEvidence.median, evidence_count: priceEvidence.count,
      });
      await loadPlans();
    } catch (failure) { setActionError(failureMessage(failure, 'actionError')); }
    finally { setActionBusy(false); }
  };

  const exportPlan = () => {
    const rows = [
      ['Service', 'Location', 'Current price (USD)', 'Planned price (USD)', 'Change (USD)', 'Observed median (USD)', 'Comparable menus'],
      ...savedPlans.map((item) => [item.serviceName, item.locationName, (item.current / 100).toFixed(2), (item.target / 100).toFixed(2), ((item.target - item.current) / 100).toFixed(2), (item.median / 100).toFixed(2), item.evidenceCount]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'mova-price-pilot-plan.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  if (identityLoading || loading) return <main className="mova-page mova-price-pilot" aria-busy="true"><p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page mova-price-pilot"><EmptyState title={t('revenue.pricePilot.signIn')} /></main>;

  return <main className="mova-page mova-revenue-page mova-price-pilot">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'growth'))} backLabel={t('revenue.backToCenter')} />
    <h1>{t('revenue.pricePilot.title')}</h1>
    {offline && <OfflineBanner>{t('revenue.pricePilot.offline')}</OfflineBanner>}
    {error ? <ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void load()} /> : <>
      <Card tone="inverse" className="mova-price-pilot__hero">
        <div className="mova-price-pilot__hero-top"><p className="mova-price-pilot__eyebrow">{t('revenue.pricePilot.eyebrow')}</p><StatusChip status={featureEnabled ? 'live' : 'info'}>{featureEnabled ? t('revenue.pricePilot.enabled') : t('revenue.pricePilot.comingSoon')}</StatusChip></div>
        <h2>{t('revenue.pricePilot.heroTitle')}</h2><p>{t('revenue.pricePilot.heroBody')}</p>
      </Card>

      {services.length === 0 ? <EmptyState title={t('revenue.pricePilot.noServices')} detail={t('revenue.pricePilot.addServices')} /> : <>
        <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-service-heading">
          <div className="mova-price-pilot__section-heading"><div><p className="mova-overline">{t('revenue.pricePilot.yourPrices')}</p><h2 id="mova-price-pilot-service-heading">{t('revenue.pricePilot.chooseService')}</h2></div></div>
          <label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.location')}</span><select className="mova-input" value={locationId} onChange={(event) => setLocationId(event.currentTarget.value)}>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
          <label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.service')}</span><select className="mova-input" value={serviceId} onChange={(event) => setServiceId(event.currentTarget.value)}>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
          {selectedService && <Card className="mova-price-pilot__current"><div><span>{selectedService.name}</span><strong>{priceMinor == null ? '—' : currency.format(priceMinor / 100)}</strong></div><p>{selectedService.category || t('revenue.pricePilot.serviceCategory')} · {duration ?? selectedService.duration_minutes} {t('revenue.pricePilot.minutes')} · {marketLabel}</p></Card>}
        </section>

        {featureEnabled && <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-opportunities-heading">
          <div className="mova-price-pilot__section-heading"><div><p className="mova-overline">{t('revenue.pricePilot.reviewServices')}</p><h2 id="mova-price-pilot-opportunities-heading">{t('revenue.pricePilot.opportunitiesTitle')}</h2></div></div>
          <Checkbox className="mova-price-pilot__filter" label={t('revenue.pricePilot.opportunitiesOnly')} checked={opportunitiesOnly} onChange={(event) => setOpportunitiesOnly(event.currentTarget.checked)} />
          <p className="mova-price-pilot__note">{t('revenue.pricePilot.opportunitiesNote')}</p>
          <div className="mova-price-pilot__service-list">{serviceRows.map(({ service, price, evidence }) => {
            const below = Boolean(evidence && price < evidence.low);
            return <Card key={service.id} className={`mova-price-pilot__service-row${service.id === serviceId ? ' is-selected' : ''}`}><div><strong>{service.name}</strong><span>{currency.format(price / 100)} · {evidence ? t(below ? 'revenue.pricePilot.belowObserved' : 'revenue.pricePilot.hasEvidence') : t('revenue.pricePilot.needsEvidence')}</span></div><div>{evidence && <strong>{currency.format(evidence.low / 100)}–{currency.format(evidence.high / 100)}</strong>}<Button variant="secondary" onClick={() => setServiceId(service.id)}>{service.id === serviceId ? t('revenue.pricePilot.selected') : t('revenue.pricePilot.review')}</Button></div></Card>;
          })}{serviceRows.length === 0 && <EmptyState title={t('revenue.pricePilot.noOpportunityServices')} />}</div>
        </section>}

        <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-evidence-heading">
          <div className="mova-price-pilot__section-heading"><div><p className="mova-overline">{t('revenue.pricePilot.marketEvidence')}</p><h2 id="mova-price-pilot-evidence-heading">{t('revenue.pricePilot.evidenceTitle')}</h2></div><StatusChip status={priceEvidence ? 'live' : 'info'}>{priceEvidence ? t('revenue.pricePilot.comparableCount', { count: priceEvidence.count }) : t('revenue.pricePilot.noVerifiedData')}</StatusChip></div>
          {observationsLoading ? <Card className="mova-price-pilot__empty-evidence"><p role="status">{t('revenue.pricePilot.loadingLocalEvidence')}</p></Card> : !priceEvidence ? <Card className="mova-price-pilot__empty-evidence"><EmptyState title={t('revenue.pricePilot.noComparables')} detail={t('revenue.pricePilot.insufficientEvidence')} /></Card> : <>
            {priceMinor != null && <Card className="mova-price-pilot__market-card"><PricePositionChart evidence={priceEvidence} current={priceMinor} rangeLabel={t('revenue.pricePilot.chartRange')} currentLabel={t('revenue.pricePilot.chartCurrent')} formatPrice={(minor) => currency.format(minor / 100)} label={t('revenue.pricePilot.chartLabel', { current: currency.format(priceMinor / 100), low: currency.format(priceEvidence.low / 100), median: currency.format(priceEvidence.median / 100), high: currency.format(priceEvidence.high / 100) })} /><div className="mova-price-pilot__market-summary"><span>{t('revenue.pricePilot.marketMedian')}</span><strong>{currency.format(priceEvidence.median / 100)}</strong><span>{t('revenue.pricePilot.marketQuartiles', { low: currency.format(priceEvidence.low / 100), high: currency.format(priceEvidence.high / 100) })}</span>{priceEvidence.currentPercentile !== null && <span>{priceEvidence.currentPercentile === 0 ? t('revenue.pricePilot.percentileLowest') : t('revenue.pricePilot.percentile', { value: priceEvidence.currentPercentile })}</span>}</div></Card>}
            <Card className="mova-price-pilot__confidence"><h3>{t('revenue.pricePilot.evidenceQuality')}</h3><div><span>{t('revenue.pricePilot.sampleFactor')}</span><strong>{t('revenue.pricePilot.independentMenus', { count: priceEvidence.count })}</strong></div><div><span>{t('revenue.pricePilot.freshnessFactor')}</span><strong>{t('revenue.pricePilot.daysAgo', { count: priceEvidence.latestAgeDays })}</strong></div><div><span>{t('revenue.pricePilot.extractionFactor')}</span><strong>{Math.round(priceEvidence.averageExtractionConfidence * 100)}%</strong></div><div><span>{t('revenue.pricePilot.variationFactor')}</span><strong>{t('revenue.pricePilot.spread', { value: priceEvidence.spreadPercent })}</strong></div><small>{t('revenue.pricePilot.confidenceExplanation')}</small></Card>
            <Card tone={priceMinor != null && priceMinor < priceEvidence.low ? 'warm' : 'default'} className="mova-price-pilot__recommendation"><p className="mova-overline">{t('revenue.pricePilot.consideration')}</p><h3>{priceMinor != null && priceMinor < priceEvidence.low ? t('revenue.pricePilot.considerReview') : t('revenue.pricePilot.noChangeSignal')}</h3><p>{t('revenue.pricePilot.recommendationCopy', { median: currency.format(priceEvidence.median / 100) })}</p><small>{t('revenue.pricePilot.noAutoChanges')}</small></Card>
            <Card className="mova-price-pilot__plan"><p className="mova-overline">{t('revenue.pricePilot.actionPlan')}</p><h3>{t('revenue.pricePilot.planTitle')}</h3><p>{t('revenue.pricePilot.planCopy')}</p><TextField type="number" min="0.01" step="0.01" label={t('revenue.pricePilot.targetPrice')} value={planTarget} onChange={(event) => setPlanTarget(event.currentTarget.value)} hint={t('revenue.pricePilot.targetHint', { median: currency.format(priceEvidence.median / 100) })} /><Button loading={actionBusy} disabled={!Number.isFinite(Number(planTarget)) || Number(planTarget) <= 0 || !priceEvidence} onClick={() => void addToPlan()}>{t('revenue.pricePilot.addToPlan')}</Button></Card>
          </>}
          <ComparableSources observations={comparableObservations} locale={i18n.resolvedLanguage} formatPrice={(minor) => currency.format(minor / 100)} confidenceLabel={t('revenue.pricePilot.confidence')} matchLabel={t('revenue.pricePilot.samePostalArea')} nearbyLabel={t('revenue.pricePilot.nearbyArea')} headingLabel={t('revenue.pricePilot.comparableSources')} viewLabel={t('revenue.pricePilot.viewSource')} removeLabel={t('revenue.pricePilot.removeSource')} busy={actionBusy} onRemove={(id) => void removeSource(id)} />
          <UnmatchedSources observations={observations} heading={t('revenue.pricePilot.unmatchedSources')} detail={t('revenue.pricePilot.unmatchedSourceDetail')} removeLabel={t('revenue.pricePilot.removeSource')} busy={actionBusy} onRemove={(id) => void removeSource(id)} />
        </section>

        {savedPlans.length > 0 && <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-plan-heading"><div className="mova-price-pilot__section-heading"><div><p className="mova-overline">{t('revenue.pricePilot.actionPlan')}</p><h2 id="mova-price-pilot-plan-heading">{t('revenue.pricePilot.planTitle')}</h2></div><Button variant="secondary" onClick={exportPlan}>{t('revenue.pricePilot.exportPlan')}</Button></div><p className="mova-price-pilot__note">{t('revenue.pricePilot.planSavedNote')}</p><ul className="mova-price-pilot__planned-list">{savedPlans.map((item) => <li key={item.id}><Card><div><strong>{item.serviceName}</strong><span>{item.locationName} · {item.evidenceCount} {t('revenue.pricePilot.comparableMenus')}</span></div><strong>{currency.format(item.current / 100)} → {currency.format(item.target / 100)}</strong><Button variant="ghost" disabled={actionBusy} onClick={() => void removePlan(item.id)}>{t('revenue.pricePilot.removeFromPlan')}</Button></Card></li>)}</ul></section>}

        {featureEnabled && <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-sources-heading"><div className="mova-price-pilot__section-heading"><div><p className="mova-overline">{t('revenue.pricePilot.dataSources')}</p><h2 id="mova-price-pilot-sources-heading">{t('revenue.pricePilot.addMenu')}</h2></div></div>
          {actionError && <p className="mova-field__error" role="alert">{actionError}</p>}
          <details className="mova-price-pilot__settings"><summary>{t('revenue.pricePilot.comparisonSettings')}</summary>
            <Card className="mova-price-pilot__source-form"><h3>{t('revenue.pricePilot.radiusTitle')}</h3><p>{t('revenue.pricePilot.radiusBody')}</p><TextField type="number" min="1" step="1" label={t('revenue.pricePilot.radiusLabel')} value={radiusDraft} onChange={(event) => setRadiusDraft(event.currentTarget.value)} hint={t('revenue.pricePilot.radiusHint', { miles: radius })} /><Button variant="secondary" loading={actionBusy} disabled={radiusDraft === String(radius)} onClick={() => void saveRadius()}>{t('revenue.pricePilot.saveRadius')}</Button></Card>
          </details>
          <Card className="mova-price-pilot__source-form"><h3>{t('revenue.pricePilot.menuUrlTitle')}</h3>{ownHostName ? <>
            <p>{t('revenue.pricePilot.menuUrlBody')}</p>
            <label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.menuUrl')}</span><input className="mova-input" type="url" inputMode="url" value={menuUrl} onChange={(event) => setMenuUrl(event.currentTarget.value)} placeholder={`https://${ownHostName}/services`} /></label>
            <Button loading={actionBusy} disabled={!menuUrl.trim()} onClick={() => void importMenu(menuUrl.trim())}>{t('revenue.pricePilot.checkMenu')}</Button>
          </> : <p>{t('revenue.pricePilot.ownWebsiteRequired')}</p>}</Card>
          <Card className="mova-price-pilot__source-form"><h3>{t('revenue.pricePilot.discoverSources')}</h3><p>{t('revenue.pricePilot.discoveryPrivacy')}</p><label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.cityOrZip')}</span><input className="mova-input" value={marketLocation} onChange={(event) => setMarketLocation(event.currentTarget.value)} maxLength={100} /></label><Button variant="secondary" loading={actionBusy} disabled={marketLocation.trim().length < 2} onClick={() => void discover()}>{t('revenue.pricePilot.search')}</Button>{directoryResults.length > 0 && <ul className="mova-price-pilot__discovery">{directoryResults.map((item, index) => {
            const own = Boolean(ownHostName) && hostOf(item.website) === ownHostName;
            const link = item.website || item.url;
            return <li key={`${item.provider}-${item.url}-${index}`}><strong>{item.name}</strong>{item.address && <span>{item.address}</span>}<small>{item.attribution}</small>{own && item.website ? <Button variant="secondary" loading={actionBusy} onClick={() => void importMenu(item.website)}>{t('revenue.pricePilot.checkMenu')}</Button> : link && <a href={link} target="_blank" rel="noreferrer">{t('revenue.pricePilot.openWebsite')}</a>}</li>;
          })}</ul>}</Card>
        </section>}

        <Card className="mova-price-pilot__method"><p className="mova-overline">{t('revenue.pricePilot.howItWorks')}</p><h2>{t('revenue.pricePilot.methodTitle')}</h2><ol><li>{t('revenue.pricePilot.methodOne')}</li><li>{t('revenue.pricePilot.methodTwo')}</li><li>{t('revenue.pricePilot.methodThree')}</li></ol><p>{t('revenue.pricePilot.noAutoChanges')}</p></Card>
        {!featureEnabled && <p className="mova-price-pilot__gate-note" role="status">{t('revenue.pricePilot.featureOff')}</p>}
      </>}
    </>}
  </main>;
}
