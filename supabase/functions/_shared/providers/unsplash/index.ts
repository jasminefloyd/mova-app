// Unsplash provider selection (P6). Off unless configured:
//   MOVA_UNSPLASH_PROVIDER=fake                                   sandbox and tests (labelled sample photos)
//   MOVA_UNSPLASH_PROVIDER=live + MOVA_UNSPLASH_LIVE_ENABLED=true + UNSPLASH_ACCESS_KEY   live (off in V1)
import { FakeUnsplashProvider } from './fake.ts';
import { LiveUnsplashProvider } from './live.ts';
import type { UnsplashProvider } from './types.ts';

export { FakeUnsplashProvider, sampleSearch } from './fake.ts';
export { LiveUnsplashProvider, toPhoto } from './live.ts';
export { UNSPLASH_HOME, isUnsplashImageUrl, withUnsplashUtm } from './attribution.ts';
export * from './types.ts';

export function unsplashProviderFromEnv(env: (name: string) => string | undefined, fetcher?: typeof fetch): UnsplashProvider | null {
  const choice = env('MOVA_UNSPLASH_PROVIDER');
  if (choice === 'fake') return new FakeUnsplashProvider();
  if (choice === 'live' && env('MOVA_UNSPLASH_LIVE_ENABLED') === 'true') {
    const key = env('UNSPLASH_ACCESS_KEY');
    return key ? new LiveUnsplashProvider(key, fetcher) : null;
  }
  return null;
}
