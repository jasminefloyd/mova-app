import { useLoaderData } from 'react-router-dom';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router-dom';
import { PublicArtistPage } from './PublicArtistPage';
import type { PublicArtist } from './PublicArtistPage';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const supabaseUrl = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const anonKey = env?.SUPABASE_ANON_KEY ?? env?.VITE_SUPABASE_ANON_KEY;
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'es-US' ? 'es-US' : 'en-US';
  if (!supabaseUrl || !anonKey || !params.handle) throw new Response('Public artist service is not configured', { status: 503 });
  const publicBaseUrl = ((env?.PUBLIC_BASE_URL) || 'https://mova-beauty.co').replace(/\/$/, '');
  const response = await fetch(`${supabaseUrl}/functions/v1/public-artist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ handle: params.handle, tab: 'looks', locale }),
  });
  if (!response.ok) throw new Response('Artist not found', { status: response.status });
  const envelope = await response.json() as { data?: PublicArtist };
  if (!envelope.data) throw new Response('Artist not found', { status: 404 });
  return { artist: envelope.data, locale, publicBaseUrl };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.artist) return [{ title: 'mova.' }];
  const artist = data.artist;
  const description = artist.profile.bio || artist.profile.specialties.join(', ');
  const canonical = `${data.publicBaseUrl}/a/${encodeURIComponent(artist.profile.handle)}`;
  const hrefFor = (locale: string) => `${canonical}?locale=${locale}`;
  return [
    { title: `${artist.profile.display_name} | mova.` },
    { name: 'description', content: description },
    { property: 'og:title', content: `${artist.profile.display_name} | mova.` },
    { property: 'og:description', content: description },
    { property: 'og:url', content: canonical },
    { property: 'og:type', content: 'profile' },
    ...(artist.profile.photo_urls.profile?.['512'] ? [{ property: 'og:image', content: artist.profile.photo_urls.profile['512'] }] : []),
    ...(!artist.profile.search_index_enabled ? [{ name: 'robots', content: 'noindex,follow' }] : []),
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', hrefLang: 'en-US', href: hrefFor('en-US') },
    { tagName: 'link', rel: 'alternate', hrefLang: 'es-US', href: hrefFor('es-US') },
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: hrefFor('en-US') },
  ];
};

export default function Route() {
  const { artist } = useLoaderData<typeof loader>();
  return <PublicArtistPage initialArtist={artist} />;
}
