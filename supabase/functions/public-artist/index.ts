import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders } from '../_shared/cors.ts';

const publicCorsHeaders = { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

function respond(data: unknown, status = 200): Response {
  return Response.json({ data, error: null, request_id: crypto.randomUUID() }, { status, headers: publicCorsHeaders });
}

function computeDepositMinor(priceMinor: number, depositType: string, depositValue: number): number {
  if (depositType === 'none') return 0;
  if (depositType === 'fixed') return Math.min(priceMinor, depositValue);
  return Math.min(priceMinor, Math.floor((priceMinor * depositValue + 5_000) / 10_000));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: publicCorsHeaders });
  if (!['GET', 'POST'].includes(request.method)) return respond(null, 405);
  const query = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json().catch(() => ({}));
  const handle = typeof query.handle === 'string' ? query.handle.trim().toLowerCase() : '';
  const tab = typeof query.tab === 'string' ? query.tab : 'looks';
  const locale = typeof query.locale === 'string' ? query.locale : 'en-US';
  if (!/^[a-z0-9-]{3,30}$/.test(handle) || !['looks', 'services'].includes(tab) || !['en-US', 'es-US'].includes(locale)) {
    return respond({ code: 'INVALID_REQUEST' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return respond({ code: 'SERVER_CONFIGURATION_MISSING' }, 500);

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await supabase
    .from('mova_artist_profiles')
    .select('artist_business_id, display_name, handle, specialties, bio, preferred_locale, photo_variants, profile_photo_path, cover_photo_path, cover_source, cover_image_url, cover_credit_name, cover_credit_url, cover_unsplash_url, is_published, search_index_enabled')
    .eq('handle', handle)
    .eq('is_published', true)
    .maybeSingle();

  if (profileError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);
  if (!profile) return respond({ code: 'NOT_FOUND' }, 404);
  const { data: business, error: businessError } = await supabase.from('mova_artist_businesses').select('status').eq('id', profile.artist_business_id).maybeSingle();
  if (businessError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);
  if (business?.status !== 'active') return respond({ code: 'NOT_FOUND' }, 404);

  // Only expose reviews the stylist has approved for public display. Never infer
  // a rating from private, pending, or rejected review rows.
  const { data: publicRatings } = await supabase.from('mova_reviews').select('rating')
    .eq('artist_business_id', profile.artist_business_id).eq('moderation_status', 'approved').eq('public_display_enabled', true).limit(1000);
  const ratingCount = publicRatings?.length ?? 0;
  const ratingAverage = ratingCount ? Math.round(publicRatings!.reduce((sum, review) => sum + review.rating, 0) / ratingCount * 10) / 10 : null;

  const variantGroups = profile.photo_variants && typeof profile.photo_variants === 'object'
    ? Object.entries(profile.photo_variants as Record<string, unknown>)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]) && typeof entry[1] === 'object')
    : [];
  const photos = await Promise.all(variantGroups.map(async ([kind, sizes]) => {
    const signedSizes = await Promise.all(Object.entries(sizes).map(async ([size, path]) => {
      if (typeof path !== 'string') return null;
      const { data } = await supabase.storage.from('mova_profile_photos').createSignedUrl(path, 300);
      return data?.signedUrl ? [size, data.signedUrl] as const : null;
    }));
    return [kind, Object.fromEntries(signedSizes.filter((item): item is NonNullable<typeof item> => item !== null))] as const;
  }));

  const businessId = profile.artist_business_id;
  const { data: services, error: serviceError } = await supabase
    .from('mova_services')
    .select('id, name, category, duration_minutes, buffer_minutes, base_price_minor, deposit_type, deposit_value')
    .eq('artist_business_id', businessId)
    .eq('status', 'active')
    .order('name');
  if (serviceError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);

  const { data: locations, error: locationError } = await supabase.from('mova_locations')
    .select('id,name,booking_mode,time_zone,payment_collector').eq('artist_business_id', businessId).eq('is_active', true).order('name');
  if (locationError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);
  const { data: openLocations, error: hoursError } = locations?.length
    ? await supabase.from('mova_location_hours').select('location_id').eq('artist_business_id', businessId).in('location_id', locations.map((location) => location.id))
    : { data: [], error: null };
  if (hoursError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);
  const { data: serviceLocations, error: serviceLocationError } = await supabase.from('mova_service_locations')
    .select('service_id,location_id,price_minor_override,duration_minutes_override').eq('artist_business_id', businessId);
  if (serviceLocationError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);

  const { data: portfolio, error: portfolioError } = await supabase
    .from('mova_portfolio_items')
    .select('id, media_path, alt_text, sort_order')
    .eq('artist_business_id', businessId)
    .eq('is_published', true)
    .order('sort_order');
  if (portfolioError) return respond({ code: 'PUBLIC_ARTIST_UNAVAILABLE' }, 503);

  const publishedPortfolio = await Promise.all((portfolio ?? []).map(async (item) => {
    const { data: signed } = await supabase.storage.from('mova_portfolio_media').createSignedUrl(item.media_path, 300);
    if (!signed?.signedUrl) return null;
    const { data: links } = await supabase.from('mova_portfolio_service_links').select('service_id').eq('portfolio_item_id', item.id);
    return { id: item.id, image_url: signed.signedUrl, alt_text: item.alt_text, sort_order: item.sort_order, service_ids: links?.map((link) => link.service_id) ?? [] };
  }));

  const publicServices = (services ?? []).map((service) => ({
    ...service,
    location_deposits: (locations ?? []).map((location) => {
      const override = serviceLocations?.find((item) => item.service_id === service.id && item.location_id === location.id);
      const price = override?.price_minor_override ?? service.base_price_minor;
      return { location_id: location.id, price_minor: price, duration_minutes: (override?.duration_minutes_override ?? service.duration_minutes) + service.buffer_minutes,
        deposit_amount_minor: location.payment_collector === 'artist' ? computeDepositMinor(price, service.deposit_type, service.deposit_value) : 0 };
    }),
  }));

  return respond({
    profile: {
      display_name: profile.display_name,
      handle: profile.handle,
      specialties: profile.specialties,
      bio: profile.bio,
      preferred_locale: profile.preferred_locale,
      photo_urls: Object.fromEntries(photos),
      rating_average: ratingAverage,
      rating_count: ratingCount,
      search_index_enabled: profile.search_index_enabled,
      cover_source: profile.cover_source,
      cover_image_url: profile.cover_image_url,
      cover_credit_name: profile.cover_credit_name,
      cover_credit_url: profile.cover_credit_url,
      cover_unsplash_url: profile.cover_unsplash_url,
    },
    tab,
    locale,
    services: publicServices,
    locations: (locations ?? []).map(({ id, name, booking_mode, time_zone }) => ({ id, name, booking_mode, time_zone })),
    looks: publishedPortfolio.filter((item): item is NonNullable<typeof item> => item !== null),
    bookable: Boolean(services?.length && locations?.some((location) => openLocations?.some((entry) => entry.location_id === location.id))),
  });
});
