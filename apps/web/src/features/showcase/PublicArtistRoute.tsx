import { useLoaderData } from 'react-router';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { PUBLIC_PROFILE_LOCALE as locale } from '../../app/locale';
import { PublicArtistPage } from './PublicArtistPage';
import type { PublicArtist } from './PublicArtistPage';
import { artistSchema } from './artist-schema';
import { JsonLd } from '../website/parts';

export async function loader({ params }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const supabaseUrl = env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL;
  const anonKey = env?.SUPABASE_ANON_KEY ?? env?.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || !params.handle) throw new Response('Public artist service is not configured', { status: 503 });
  const publicBaseUrl = ((env?.PUBLIC_BASE_URL) || 'https://mova-beauty.co').replace(/\/$/, '');
  const response = await fetch(`${supabaseUrl}/functions/v1/public-artist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ handle: params.handle, tab: 'looks', locale }),
  });
  if (!response.ok) throw new Response('Artist not found', { status: response.status });
  const envelope = await response.json() as { data?: PublicArtist };
  if (!envelope.data) throw new Response('Artist not found', { status: 404 });
  return { artist: envelope.data, publicBaseUrl };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.artist) return [{ title: 'Mova Beauty Stylist Page' }];
  const artist = data.artist;
  const description = artist.profile.bio || artist.profile.specialties.join(', ');
  const canonical = `${data.publicBaseUrl}/a/${encodeURIComponent(artist.profile.handle)}`;
  return [
    { title: `Mova Beauty | ${artist.profile.display_name}` },
    { name: 'description', content: description },
    { property: 'og:title', content: `Mova Beauty | ${artist.profile.display_name}` },
    { property: 'og:description', content: description },
    { property: 'og:url', content: canonical },
    { property: 'og:type', content: 'profile' },
    ...(artist.profile.cover_source === 'unsplash' && artist.profile.cover_image_url
      ? [{ property: 'og:image', content: artist.profile.cover_image_url }]
      : artist.profile.photo_urls.cover?.['512']
        ? [{ property: 'og:image', content: artist.profile.photo_urls.cover['512'] }]
        : artist.profile.photo_urls.profile?.['512'] ? [{ property: 'og:image', content: artist.profile.photo_urls.profile['512'] }] : []),
    ...(!artist.profile.search_index_enabled ? [{ name: 'robots', content: 'noindex,follow' }] : []),
    { tagName: 'link', rel: 'canonical', href: canonical },
  ];
};

export default function Route() {
  const { artist, publicBaseUrl } = useLoaderData<typeof loader>();
  return <>
    <JsonLd data={artistSchema({ artist, publicBaseUrl, locale })} />
    <PublicArtistPage initialArtist={artist} />
  </>;
}
