import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, OfflineBanner, ScreenHeader, StatusChip } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { buildPriceEvidence, type PriceEvidence, type PricePilotObservation } from './price-pilot-model';

type Service = { id: string; name: string; category: string; duration_minutes: number; base_price_minor: number };
type Location = { id: string; name: string; address: Record<string, unknown> };
type Override = { service_id: string; location_id: string; price_minor_override: number | null; duration_minutes_override: number | null };
type EntitlementResponse = { features?: Record<string, boolean> };
type DirectoryResult = { name: string; address: string; website: string; url: string; provider: string; attribution: string };

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [observations, setObservations] = useState<PricePilotObservation[]>([]);
  const [menuUrl, setMenuUrl] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [marketLocation, setMarketLocation] = useState('');
  const [directoryResults, setDirectoryResults] = useState<DirectoryResult[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true);
    setError(false);
    try {
      const [serviceResult, locationResult, planResult] = await Promise.all([
        client.from('mova_services').select('id,name,category,duration_minutes,base_price_minor').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
        client.from('mova_locations').select('id,name,address').eq('artist_business_id', businessId).eq('is_active', true).order('name'),
        client.functions.invoke<{ data?: EntitlementResponse }>('plan-management', { body: { action: 'get' }, headers: { 'x-mova-artist-business-id': businessId } }),
      ]);
      if (serviceResult.error || locationResult.error || planResult.error) throw new Error('PRICE_PILOT_LOAD_FAILED');
      const serviceRows = (serviceResult.data ?? []) as Service[];
      const locationRows = (locationResult.data ?? []) as Location[];
      const serviceLocations = serviceRows.length
        ? await client.from('mova_service_locations').select('service_id,location_id,price_minor_override,duration_minutes_override').in('service_id', serviceRows.map((service) => service.id))
        : { data: [], error: null };
      if (serviceLocations.error) throw new Error('PRICE_PILOT_LOAD_FAILED');
      setServices(serviceRows);
      setLocations(locationRows);
      setOverrides((serviceLocations.data ?? []) as Override[]);
      setFeatureEnabled(planResult.data?.data?.features?.ai_price_pilot === true);
      if (planResult.data?.data?.features?.ai_price_pilot === true) {
        const market = await client.functions.invoke<{ data?: { observations?: PricePilotObservation[] } }>('price-pilot', { body: { action: 'list' }, headers: { 'x-mova-artist-business-id': businessId } });
        if (market.error) throw new Error('PRICE_PILOT_MARKET_LOAD_FAILED');
        setObservations(market.data?.data?.observations ?? []);
      } else setObservations([]);
      setServiceId((current) => serviceRows.some((service) => service.id === current) ? current : serviceRows[0]?.id ?? '');
      setLocationId((current) => locationRows.some((location) => location.id === current) ? current : locationRows[0]?.id ?? '');
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, client]);

  const invokePilot = async (body: Record<string, unknown>) => {
    if (!client || !businessId) return null;
    const result = await client.functions.invoke<{ data?: Record<string, unknown>; error?: { code?: string }; request_id?: string }>('price-pilot', { body, headers: { 'x-mova-artist-business-id': businessId } });
    if (result.error || result.data?.error) throw new Error(`${result.data?.error?.code ?? 'PRICE_PILOT_ACTION_FAILED'}::${result.data?.request_id ?? ''}`);
    return result.data?.data ?? null;
  };
  const discover = async () => {
    setActionBusy(true); setActionError(''); setDirectoryResults([]);
    try {
      const data = await invokePilot({ action: 'discover', location: marketLocation });
      const providers = (data?.results ?? []) as Array<{ provider: string; results: DirectoryResult[] }>;
      setDirectoryResults(providers.flatMap((provider) => provider.results));
    } catch (error) { const ref = String(error).split('::')[1] ?? ''; setActionError(`${t('revenue.pricePilot.actionError')}${ref ? ` ${t('revenue.pricePilot.reference', { id: ref })}` : ''}`); }
    finally { setActionBusy(false); }
  };
  const importMenu = async () => {
    setActionBusy(true); setActionError('');
    try {
      await invokePilot({ action: 'import_menu', url: menuUrl, authorization_confirmed: authorized });
      setMenuUrl(''); setAuthorized(false); await load();
    } catch (error) { const ref = String(error).split('::')[1] ?? ''; setActionError(`${t('revenue.pricePilot.importError')}${ref ? ` ${t('revenue.pricePilot.reference', { id: ref })}` : ''}`); }
    finally { setActionBusy(false); }
  };
  const removeSource = async (sourceId: string) => {
    setActionBusy(true); setActionError('');
    try { await invokePilot({ action: 'remove_source', source_id: sourceId }); await load(); }
    catch (error) { const ref = String(error).split('::')[1] ?? ''; setActionError(`${t('revenue.pricePilot.actionError')}${ref ? ` ${t('revenue.pricePilot.reference', { id: ref })}` : ''}`); }
    finally { setActionBusy(false); }
  };

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setOffline(!navigator.onLine);
    const online = () => setOffline(false);
    const offlineEvent = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offlineEvent);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineEvent); };
  }, []);

  const selectedService = services.find((service) => service.id === serviceId);
  const selectedLocation = locations.find((location) => location.id === locationId);
  const selectedOverride = overrides.find((item) => item.service_id === serviceId && item.location_id === locationId);
  const priceMinor = selectedOverride?.price_minor_override ?? selectedService?.base_price_minor;
  const duration = selectedOverride?.duration_minutes_override ?? selectedService?.duration_minutes;
  const currency = useMemo(() => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD' }), [i18n.resolvedLanguage]);
  const marketLabel = selectedLocation?.name ?? t('revenue.pricePilot.chooseLocation');
  const priceEvidence = useMemo<PriceEvidence>(() => {
    if (!selectedService || !priceMinor) return null;
    return buildPriceEvidence(observations, { name: selectedService.name, category: selectedService.category, durationMinutes: duration ?? null, currency: 'USD' });
  }, [duration, observations, priceMinor, selectedService]);

  if (identityLoading || loading) return <main className="mova-page mova-price-pilot" aria-busy="true"><p role="status">{t('revenue.pricePilot.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page mova-price-pilot"><EmptyState title={t('revenue.pricePilot.signIn')} /></main>;

  return <main className="mova-page mova-revenue-page mova-price-pilot">
    <ScreenHeader title={t('revenue.pricePilot.title')} onBack={() => navigate(operatorUrl(businessId, 'growth'))} backLabel={t('revenue.backToCenter')} />
    <h1>{t('revenue.pricePilot.title')}</h1>
    {offline && <OfflineBanner>{t('revenue.pricePilot.offline')}</OfflineBanner>}
    {error ? <ErrorState title={t('revenue.pricePilot.error')} retryLabel={t('revenue.pricePilot.retry')} onRetry={() => void load()} /> : <>
      <Card tone="inverse" className="mova-price-pilot__hero">
        <div className="mova-price-pilot__hero-top"><p className="mova-price-pilot__eyebrow">{t('revenue.pricePilot.eyebrow')}</p><StatusChip status={featureEnabled ? 'live' : 'info'}>{featureEnabled ? t('revenue.pricePilot.enabled') : t('revenue.pricePilot.comingSoon')}</StatusChip></div>
        <h2>{t('revenue.pricePilot.heroTitle')}</h2>
        <p>{t('revenue.pricePilot.heroBody')}</p>
      </Card>

      {services.length === 0 ? <EmptyState title={t('revenue.pricePilot.noServices')} detail={t('revenue.pricePilot.addServices')} /> : <>
        <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-service-heading">
          <div className="mova-price-pilot__section-heading"><div><p className="mova-section-overline">{t('revenue.pricePilot.yourPrices')}</p><h2 id="mova-price-pilot-service-heading">{t('revenue.pricePilot.chooseService')}</h2></div></div>
          <label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.service')}</span><select className="mova-input" value={serviceId} onChange={(event) => setServiceId(event.currentTarget.value)}>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
          <label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.location')}</span><select className="mova-input" value={locationId} onChange={(event) => setLocationId(event.currentTarget.value)}>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
          {selectedService && <Card className="mova-price-pilot__current"><div><span>{selectedService.name}</span><strong>{priceMinor == null ? '—' : currency.format(priceMinor / 100)}</strong></div><p>{selectedService.category || t('revenue.pricePilot.serviceCategory')} · {duration ?? selectedService.duration_minutes} {t('revenue.pricePilot.minutes')} · {marketLabel}</p></Card>}
        </section>

        <section className="mova-price-pilot__section" aria-labelledby="mova-price-pilot-evidence-heading">
          <div className="mova-price-pilot__section-heading"><div><p className="mova-section-overline">{t('revenue.pricePilot.marketEvidence')}</p><h2 id="mova-price-pilot-evidence-heading">{t('revenue.pricePilot.evidenceTitle')}</h2></div><StatusChip status={observations.length ? 'live' : 'info'}>{observations.length ? t('revenue.pricePilot.observationCount', { count: observations.length }) : t('revenue.pricePilot.noVerifiedData')}</StatusChip></div>
          {observations.length === 0 ? <Card className="mova-price-pilot__empty-evidence"><EmptyState title={t('revenue.pricePilot.noComparables')} detail={t('revenue.pricePilot.noComparablesDetail', { location: marketLabel })} /></Card> : <div className="mova-price-pilot__observations">{observations.map((item) => <Card key={item.id} className="mova-price-pilot__observation"><div><strong>{item.service_name}</strong><StatusChip status="info">{Math.round(item.extraction_confidence * 100)}% {t('revenue.pricePilot.confidence')}</StatusChip></div><p>{item.category || t('revenue.pricePilot.serviceCategory')} · {item.duration_minutes ? `${item.duration_minutes} ${t('revenue.pricePilot.minutes')}` : t('revenue.pricePilot.durationNotListed')}</p><strong>{new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: item.currency }).format(item.price_min_minor / 100)}{item.price_max_minor > item.price_min_minor ? `–${new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: item.currency }).format(item.price_max_minor / 100)}` : ''}</strong><small>{item.mova_price_pilot_sources.normalized_host} · {new Date(item.observed_at).toLocaleDateString(i18n.resolvedLanguage)}</small><Button variant="ghost" disabled={actionBusy} onClick={() => void removeSource(item.source_id)}>{t('revenue.pricePilot.removeSource')}</Button></Card>)}</div>}
          {featureEnabled && selectedService && <Card tone="inverse" className="mova-price-pilot__insight"><p className="mova-price-pilot__eyebrow">{t('revenue.pricePilot.insightLabel')}</p><h3>{t('revenue.pricePilot.insightTitle')}</h3>{priceEvidence ? <><strong>{currency.format(priceEvidence.low / 100)}–{currency.format(priceEvidence.high / 100)}</strong><p>{t('revenue.pricePilot.insightBody', { count: priceEvidence.count, median: currency.format(priceEvidence.median / 100) })}</p></> : <p>{t('revenue.pricePilot.insufficientEvidence')}</p>}<small>{t('revenue.pricePilot.noAutoChanges')}</small></Card>}
          {featureEnabled && actionError && <p className="mova-field__error" role="alert">{actionError}</p>}
          {featureEnabled && <>
          <Card className="mova-price-pilot__source-form"><p className="mova-section-overline">{t('revenue.pricePilot.addMenu')}</p><h3>{t('revenue.pricePilot.menuUrlTitle')}</h3><p>{t('revenue.pricePilot.menuUrlBody')}</p><label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.menuUrl')}</span><input className="mova-input" type="url" inputMode="url" value={menuUrl} onChange={(event) => setMenuUrl(event.currentTarget.value)} placeholder="https://example.com/services" /></label><label className="mova-price-pilot__consent"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.currentTarget.checked)} />{t('revenue.pricePilot.authorization')}</label><Button loading={actionBusy} disabled={!menuUrl || !authorized} onClick={() => void importMenu()}>{t('revenue.pricePilot.importMenu')}</Button></Card>
          <Card className="mova-price-pilot__source-form"><p className="mova-section-overline">{t('revenue.pricePilot.discoverSources')}</p><p>{t('revenue.pricePilot.discoveryPrivacy')}</p><label className="mova-field"><span className="mova-field__label">{t('revenue.pricePilot.cityOrZip')}</span><input className="mova-input" value={marketLocation} onChange={(event) => setMarketLocation(event.currentTarget.value)} maxLength={100} /></label><Button variant="secondary" loading={actionBusy} disabled={marketLocation.trim().length < 2} onClick={() => void discover()}>{t('revenue.pricePilot.search')}</Button>{directoryResults.length > 0 && <ul className="mova-price-pilot__discovery">{directoryResults.map((item, index) => <li key={`${item.provider}-${item.url}-${index}`}><strong>{item.name}</strong>{item.address && <span>{item.address}</span>}<small>{item.attribution}</small>{item.website && <a href={item.website} target="_blank" rel="noreferrer">{t('revenue.pricePilot.openWebsite')}</a>}</li>)}</ul>}</Card>
          </>}
        </section>

        <Card className="mova-price-pilot__method">
          <p className="mova-section-overline">{t('revenue.pricePilot.howItWorks')}</p>
          <h2>{t('revenue.pricePilot.methodTitle')}</h2>
          <ol><li>{t('revenue.pricePilot.methodOne')}</li><li>{t('revenue.pricePilot.methodTwo')}</li><li>{t('revenue.pricePilot.methodThree')}</li></ol>
          <p>{t('revenue.pricePilot.noAutoChanges')}</p>
        </Card>
        <p className="mova-price-pilot__gate-note" role="status">{featureEnabled ? t('revenue.pricePilot.integrationPending') : t('revenue.pricePilot.featureOff')}</p>
      </>}
    </>}
  </main>;
}
