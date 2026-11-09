// Live Unsplash provider (P6). WRITTEN BUT OFF: index.ts builds it only when MOVA_UNSPLASH_PROVIDER=live,
// MOVA_UNSPLASH_LIVE_ENABLED=true and UNSPLASH_ACCESS_KEY is set. Unsplash's production approval (demo keys
// allow only a small quota) is an owner step; the access key is a server secret and is never committed.
import { withUnsplashUtm, isUnsplashImageUrl, UNSPLASH_HOME } from './attribution.ts';
import { UnsplashProviderError, type UnsplashPhoto, type UnsplashProvider } from './types.ts';

const API = 'https://api.unsplash.com';
const TIMEOUT_MS = 8_000;

type RawPhoto = { id?: unknown; alt_description?: unknown; description?: unknown; urls?: Record<string, unknown>; user?: { name?: unknown; links?: { html?: unknown } }; links?: { html?: unknown; download_location?: unknown } };

export class LiveUnsplashProvider implements UnsplashProvider {
  readonly name = 'unsplash';
  readonly live = true;
  constructor(private readonly accessKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async search(query: string, perPage: number): Promise<UnsplashPhoto[]> {
    const url = `${API}/search/photos?${new URLSearchParams({ query, per_page: String(Math.max(1, Math.min(perPage, 30))), orientation: 'landscape' })}`;
    const body = await this.getJson(url);
    return (Array.isArray(body.results) ? body.results : []).map((raw: RawPhoto) => toPhoto(raw)).filter((photo: UnsplashPhoto | null): photo is UnsplashPhoto => photo !== null);
  }

  async getPhoto(id: string): Promise<UnsplashPhoto | null> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
    const body = await this.getJson(`${API}/photos/${id}`).catch(() => null);
    return body ? toPhoto(body as RawPhoto) : null;
  }

  async trackDownload(downloadLocation: string): Promise<void> {
    // Only Unsplash's own API host is called, so a stored value can never make the server fetch elsewhere.
    const parsed = new URL(downloadLocation);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.unsplash.com') throw new UnsplashProviderError('UNSPLASH_DOWNLOAD_LINK_INVALID');
    await this.getJson(parsed.toString());
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, { headers: { Authorization: `Client-ID ${this.accessKey}`, 'Accept-Version': 'v1' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new UnsplashProviderError('UNSPLASH_API_FAILED');
    return await response.json() as Record<string, unknown>;
  }
}

/** Maps an Unsplash photo to our shape. Photos without the parts the credit needs are dropped. */
export function toPhoto(raw: RawPhoto): UnsplashPhoto | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const thumb = typeof raw.urls?.small === 'string' ? raw.urls.small : null;
  const regular = typeof raw.urls?.regular === 'string' ? raw.urls.regular : null;
  const name = typeof raw.user?.name === 'string' ? raw.user.name.trim() : '';
  const profile = typeof raw.user?.links?.html === 'string' ? raw.user.links.html : null;
  const photo = typeof raw.links?.html === 'string' ? raw.links.html : UNSPLASH_HOME;
  if (!id || !thumb || !regular || !name || !profile || !isUnsplashImageUrl(thumb) || !isUnsplashImageUrl(regular)) return null;
  return {
    id, alt: typeof raw.alt_description === 'string' ? raw.alt_description.slice(0, 200) : typeof raw.description === 'string' ? raw.description.slice(0, 200) : '',
    thumbUrl: thumb, imageUrl: regular, photographerName: name.slice(0, 120),
    photographerUrl: withUnsplashUtm(profile), photoUrl: withUnsplashUtm(photo),
    downloadLocation: typeof raw.links?.download_location === 'string' ? raw.links.download_location : null,
  };
}
