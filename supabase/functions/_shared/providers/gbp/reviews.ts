// Task 5.9: Google review import. The Google Business Profile integration waits on provider set-up
// (O11 keeps the platform flag off); the only provider is the fake below. Imported reviews are stored
// as-is for the stylist's Reputation page; nothing here posts to Google.
export type GoogleReview = { id: string; rating: number; body: string; displayName: string; createdAt: string | null; updatedAt: string | null };
export interface GoogleReviewsProvider {
  readonly name: string;
  readonly live: boolean;
  listReviews(locationId: string): Promise<GoogleReview[]>;
}

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Maps a Google Business Profile review object to our row, or null when it is unusable. */
export function normalizeGoogleReview(raw: unknown): GoogleReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.reviewId === 'string' && value.reviewId.length <= 200 ? value.reviewId : null;
  const rating = typeof value.starRating === 'string' ? STAR[value.starRating] : undefined;
  if (!id || !rating) return null;
  const reviewer = (value.reviewer ?? {}) as Record<string, unknown>;
  const date = (key: string) => typeof value[key] === 'string' && !Number.isNaN(Date.parse(value[key] as string)) ? new Date(value[key] as string).toISOString() : null;
  return {
    id, rating,
    body: typeof value.comment === 'string' ? value.comment.slice(0, 5000) : '',
    displayName: reviewer.isAnonymous === true ? '' : typeof reviewer.displayName === 'string' ? reviewer.displayName.slice(0, 120) : '',
    createdAt: date('createTime'), updatedAt: date('updateTime'),
  };
}

/** Fake provider: fixed fixture reviews in Google's shape for location ids that start with "fake-". */
export class FakeGoogleReviewsProvider implements GoogleReviewsProvider {
  readonly name = 'fake';
  readonly live = false;
  listReviews(locationId: string): Promise<GoogleReview[]> {
    if (!locationId.startsWith('fake-')) return Promise.reject(new Error('GBP_LOCATION_NOT_FOUND'));
    const raw = [
      { reviewId: `${locationId}-r1`, starRating: 'FIVE', comment: 'Best silk press I have had. Healthy and bouncy for two weeks.', reviewer: { displayName: 'Alexis R.' }, createTime: '2026-10-02T15:00:00Z', updateTime: '2026-10-02T15:00:00Z' },
      { reviewId: `${locationId}-r2`, starRating: 'FOUR', comment: 'Great braids, started a little late.', reviewer: { displayName: 'Mari P.' }, createTime: '2026-10-20T18:30:00Z' },
      { reviewId: `${locationId}-r3`, starRating: 'FIVE', reviewer: { isAnonymous: true, displayName: 'A Google user' }, createTime: '2026-11-01T12:00:00Z' },
      { reviewId: `${locationId}-bad`, starRating: 'STAR_RATING_UNSPECIFIED' },
    ];
    return Promise.resolve(raw.map(normalizeGoogleReview).filter((review): review is GoogleReview => review !== null));
  }
}

export function googleReviewsProviderFromEnv(env: (name: string) => string | undefined): GoogleReviewsProvider | null {
  return env('MOVA_GBP_PROVIDER') === 'fake' ? new FakeGoogleReviewsProvider() : null;
}
