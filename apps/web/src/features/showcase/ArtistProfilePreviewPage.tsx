import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ErrorState, HonestyBanner, ScreenHeader } from '../../components';
import { PublicArtistPage } from './PublicArtistPage';
import type { PublicArtist } from './PublicArtistPage';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { operatorUrl } from '../../app/operator-url';

type ProfileRow = { display_name: string; handle: string; specialties: string[]; bio: string; preferred_locale: string; search_index_enabled: boolean; photo_variants: Record<string, Record<string, string>> | null };
type ServiceRow = { id: string; name: string; category: string; duration_minutes: number; buffer_minutes: number; base_price_minor: number; deposit_type: 'none' | 'fixed' | 'percent'; deposit_value: number };
type LocationRow = { id: string; name: string; booking_mode: 'instant' | 'request'; time_zone: string; payment_collector: string };
type ServiceLocationRow = { service_id: string; location_id: string; price_minor_override: number | null; duration_minutes_override: number | null };
type PortfolioRow = { id: string; media_path: string; alt_text: string; sort_order: number };

export function ArtistProfilePreviewPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [artist, setArtist] = useState<PublicArtist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) { setError(true); setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const [profileResult, serviceResult, locationResult] = await Promise.all([
        client.from('mova_artist_profiles').select('display_name,handle,specialties,bio,preferred_locale,search_index_enabled,photo_variants').eq('artist_business_id', businessId).maybeSingle(),
        client.from('mova_services').select('id,name,category,duration_minutes,buffer_minutes,base_price_minor,deposit_type,deposit_value').eq('artist_business_id', businessId).eq('status', 'active').order('name'),
        client.from('mova_locations').select('id,name,booking_mode,time_zone,payment_collector').eq('artist_business_id', businessId).eq('is_active', true).order('name'),
      ]);
      if (profileResult.error || serviceResult.error || locationResult.error || !profileResult.data) throw new Error('PROFILE_PREVIEW_LOAD_FAILED');

      const profile = profileResult.data as ProfileRow;
      const services = (serviceResult.data ?? []) as ServiceRow[];
      const locations = (locationResult.data ?? []) as LocationRow[];
      const serviceIds = services.map((service) => service.id);
      const locationIds = locations.map((location) => location.id);
      const [serviceLocationResult, hourResult, portfolioResult] = await Promise.all([
        serviceIds.length
          ? client.from('mova_service_locations').select('service_id,location_id,price_minor_override,duration_minutes_override').eq('artist_business_id', businessId).in('service_id', serviceIds)
          : Promise.resolve({ data: [], error: null }),
        locationIds.length
          ? client.from('mova_location_hours').select('location_id').eq('artist_business_id', businessId).in('location_id', locationIds)
          : Promise.resolve({ data: [], error: null }),
        client.from('mova_portfolio_items').select('id,media_path,alt_text,sort_order').eq('artist_business_id', businessId).eq('is_published', true).order('sort_order'),
      ]);
      if (serviceLocationResult.error || hourResult.error || portfolioResult.error) throw new Error('PROFILE_PREVIEW_DETAILS_FAILED');

      const serviceLocations = (serviceLocationResult.data ?? []) as ServiceLocationRow[];
      const locationsWithHours = new Set((hourResult.data ?? []).map((row) => row.location_id));
      const photoVariants = profile.photo_variants ?? {};
      const photos = await Promise.all(Object.entries(photoVariants).map(async ([kind, sizes]) => {
        const signedSizes = await Promise.all(Object.entries(sizes).map(async ([size, path]) => {
          const { data, error: signedError } = await client.storage.from('mova_profile_photos').createSignedUrl(path, 300);
          if (signedError || !data?.signedUrl) return null;
          return [size, data.signedUrl] as const;
        }));
        return [kind, Object.fromEntries(signedSizes.filter((entry): entry is NonNullable<typeof entry> => entry !== null))] as const;
      }));
      const looks = await Promise.all(((portfolioResult.data ?? []) as PortfolioRow[]).map(async (item) => {
        const [{ data: signed, error: signedError }, { data: links, error: linksError }] = await Promise.all([
          client.storage.from('mova_portfolio_media').createSignedUrl(item.media_path, 300),
          client.from('mova_portfolio_service_links').select('service_id').eq('portfolio_item_id', item.id),
        ]);
        if (signedError || linksError || !signed?.signedUrl) return null;
        return { id: item.id, image_url: signed.signedUrl, alt_text: item.alt_text, service_ids: (links ?? []).map((link) => link.service_id) };
      }));

      setArtist({
        profile: { display_name: profile.display_name, handle: profile.handle, specialties: profile.specialties ?? [], bio: profile.bio ?? '', preferred_locale: profile.preferred_locale ?? 'en-US', search_index_enabled: profile.search_index_enabled, photo_urls: Object.fromEntries(photos) },
        services: services.map((service) => ({
          id: service.id, name: service.name, category: service.category, duration_minutes: service.duration_minutes, base_price_minor: service.base_price_minor,
          deposit_type: service.deposit_type, deposit_value: service.deposit_value,
          location_deposits: locations.map((location) => {
            const override = serviceLocations.find((entry) => entry.service_id === service.id && entry.location_id === location.id);
            const price = override?.price_minor_override ?? service.base_price_minor;
            return { location_id: location.id, price_minor: price, duration_minutes: (override?.duration_minutes_override ?? service.duration_minutes) + service.buffer_minutes,
              deposit_amount_minor: location.payment_collector === 'artist' ? calculateDepositMinor(price, service.deposit_type, service.deposit_value) : 0 };
          }),
        })),
        locations: locations.map(({ id, name, booking_mode, time_zone }) => ({ id, name, booking_mode, time_zone })),
        looks: looks.filter((look): look is NonNullable<typeof look> => look !== null),
        bookable: Boolean(services.length && locations.some((location) => locationsWithHours.has(location.id))),
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, client]);

  useEffect(() => { if (!identityLoading) void load(); }, [identityLoading, load]);

  if (identityLoading || loading) return <main className="mova-page" aria-busy="true"><p role="status">{t('showcase.loading')}</p></main>;
  if (!artist || error) return <main className="mova-page"><ErrorState title={t('showcase.loadError')} retryLabel={t('showcase.retry')} onRetry={() => void load()} /></main>;
  return <div className="mova-profile-preview">
    <div className="mova-page"><ScreenHeader title={t('settings.previewProfile')} onBack={() => navigate(operatorUrl(businessId, 'settings'))} /></div>
    <HonestyBanner tone="warm">{t('showcase.previewOnly')}</HonestyBanner>
    <PublicArtistPage initialArtist={artist} preview handleOverride={artist.profile.handle} initialLocale={i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US'} />
  </div>;
}

function calculateDepositMinor(priceMinor: number, depositType: ServiceRow['deposit_type'], depositValue: number) {
  if (depositType === 'none') return 0;
  if (depositType === 'fixed') return Math.min(priceMinor, depositValue);
  return Math.min(priceMinor, Math.floor((priceMinor * depositValue + 5_000) / 10_000));
}
