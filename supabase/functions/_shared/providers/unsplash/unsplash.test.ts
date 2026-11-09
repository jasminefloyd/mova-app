import { describe, expect, it, vi } from 'vitest';
import { FakeUnsplashProvider, LiveUnsplashProvider, UNSPLASH_HOME, isUnsplashImageUrl, sampleSearch, toPhoto, unsplashProviderFromEnv, withUnsplashUtm } from './index.ts';

const env = (values: Record<string, string>) => (name: string) => values[name];

describe('Unsplash attribution (P6)', () => {
  it('adds Mova UTM parameters to Unsplash links and refuses other hosts', () => {
    expect(withUnsplashUtm('https://unsplash.com/@sam?foo=1')).toBe('https://unsplash.com/@sam?foo=1&utm_source=mova&utm_medium=referral');
    expect(withUnsplashUtm(UNSPLASH_HOME)).toBe('https://unsplash.com/?utm_source=mova&utm_medium=referral');
    expect(() => withUnsplashUtm('https://example.test/@sam')).toThrow('UNSPLASH_LINK_INVALID');
    expect(() => withUnsplashUtm('http://unsplash.com/@sam')).toThrow('UNSPLASH_LINK_INVALID');
  });
  it('only Unsplash image hosts over https count as Unsplash images', () => {
    expect(isUnsplashImageUrl('https://images.unsplash.com/photo-1?w=1200')).toBe(true);
    expect(isUnsplashImageUrl('http://images.unsplash.com/photo-1')).toBe(false);
    expect(isUnsplashImageUrl('https://images.unsplash.com.evil.test/photo-1')).toBe(false);
  });
});

describe('Unsplash fake provider (P6)', () => {
  it('returns six labelled sample photos with attribution links, and clamps the page size', async () => {
    const provider = new FakeUnsplashProvider();
    const photos = await provider.search('botanical', 6);
    expect(photos).toHaveLength(6);
    expect(photos.every((photo) => photo.photographerName.endsWith('(sample)'))).toBe(true);
    expect(photos.every((photo) => photo.photographerUrl.includes('utm_source=mova'))).toBe(true);
    expect((await provider.search('salon', 99)).length).toBe(6);
    expect(provider.live).toBe(false);
  });
  it('finds a sample photo by id and records downloads', async () => {
    const provider = new FakeUnsplashProvider();
    const photo = await provider.getPhoto('mova-sample-salon-2');
    expect(photo?.imageUrl).toMatch(/^https:\/\/images\.unsplash\.com\//);
    expect(await provider.getPhoto('nope')).toBeNull();
    await provider.trackDownload(photo!.downloadLocation!);
    expect(provider.downloads).toHaveLength(1);
  });
  it('maps the query words to a topic', () => {
    expect(sampleSearch('warm neutrals').every((photo) => photo.alt.includes('warm neutrals'))).toBe(true);
  });
});

describe('Unsplash provider selection and live provider (off by default)', () => {
  it('is off unless selected and enabled with a key', () => {
    expect(unsplashProviderFromEnv(env({}))).toBeNull();
    expect(unsplashProviderFromEnv(env({ MOVA_UNSPLASH_PROVIDER: 'live', MOVA_UNSPLASH_LIVE_ENABLED: 'true' }))).toBeNull();
    expect(unsplashProviderFromEnv(env({ MOVA_UNSPLASH_PROVIDER: 'live', UNSPLASH_ACCESS_KEY: 'k' }))).toBeNull();
    expect(unsplashProviderFromEnv(env({ MOVA_UNSPLASH_PROVIDER: 'fake' }))?.name).toBe('fake');
    expect(unsplashProviderFromEnv(env({ MOVA_UNSPLASH_PROVIDER: 'live', MOVA_UNSPLASH_LIVE_ENABLED: 'true', UNSPLASH_ACCESS_KEY: 'k' }))?.live).toBe(true);
  });
  it('maps Unsplash results and drops any photo without the parts the credit needs', async () => {
    const good = { id: 'p1', alt_description: 'Silk', urls: { small: 'https://images.unsplash.com/photo-p1?w=400', regular: 'https://images.unsplash.com/photo-p1?w=1200' }, user: { name: 'Sam Lee', links: { html: 'https://unsplash.com/@samlee' } }, links: { html: 'https://unsplash.com/photos/p1', download_location: 'https://api.unsplash.com/photos/p1/download' } };
    const badHost = { ...good, id: 'p2', urls: { small: 'https://evil.test/a.jpg', regular: 'https://evil.test/a.jpg' } };
    const noCredit = { ...good, id: 'p3', user: { name: '', links: { html: 'https://unsplash.com/@x' } } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [good, badHost, noCredit] }), { status: 200 }));
    const photos = await new LiveUnsplashProvider('key', fetcher).search('silk', 6);
    expect(photos.map((photo) => photo.id)).toEqual(['p1']);
    expect(photos[0]?.photographerUrl).toBe('https://unsplash.com/@samlee?utm_source=mova&utm_medium=referral');
    expect(photos[0]?.downloadLocation).toBe('https://api.unsplash.com/photos/p1/download');
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Client-ID key');
  });
  it('calls only Unsplash API hosts for downloads and never fetches an invalid photo id', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const provider = new LiveUnsplashProvider('key', fetcher);
    await expect(provider.trackDownload('https://evil.test/download')).rejects.toThrow('UNSPLASH_DOWNLOAD_LINK_INVALID');
    expect(await provider.getPhoto('../etc')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(toPhoto({ id: 'x' })).toBeNull();
  });
});
