// Google provider selection (P6). Off unless configured:
//   MOVA_GOOGLE_PROVIDER=fake                         sandbox and tests (never reaches Google)
//   MOVA_GOOGLE_PROVIDER=live + MOVA_GOOGLE_LIVE_ENABLED=true + GOOGLE_OAUTH_CLIENT_ID/SECRET   live (off in V1 until approved)
// Any other value, or a missing piece, returns null and callers answer GOOGLE_NOT_CONFIGURED.
import { FakeGoogleProvider } from './fake.ts';
import { LiveGoogleProvider } from './live.ts';
import type { GoogleProvider } from './types.ts';

export { FakeGoogleProvider, FAKE_CODE, FAKE_EMAIL, FAKE_LOCATION_ID } from './fake.ts';
export { LiveGoogleProvider, listingPatch } from './live.ts';
export { canonicalJson, desiredListing, pendingListing, servicesMenu, usdMoney, type HoursRow, type PendingChange, type ProfileRow, type ServiceRow, type Snapshot } from './listing.ts';
export { fakeReviewFixtures, normalizeGoogleReview } from './reviews.ts';
export * from './types.ts';

export function googleProviderFromEnv(env: (name: string) => string | undefined, fetcher?: typeof fetch): GoogleProvider | null {
  const choice = env('MOVA_GOOGLE_PROVIDER');
  if (choice === 'fake') return new FakeGoogleProvider();
  if (choice === 'live' && env('MOVA_GOOGLE_LIVE_ENABLED') === 'true') {
    const clientId = env('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = env('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;
    return new LiveGoogleProvider({ clientId, clientSecret, fetcher });
  }
  return null;
}
