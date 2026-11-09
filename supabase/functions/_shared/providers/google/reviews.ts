// Google review mapping (P6). Shared by the fake and the live provider so both return the same shape.
import type { GoogleReview } from './types.ts';

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

/** Fixture reviews in Google's shape for the fake provider. Ids are scoped to the location. */
export function fakeReviewFixtures(locationId: string): unknown[] {
  return [
    { reviewId: `${locationId}-r1`, starRating: 'FIVE', comment: 'Best silk press I have had. Healthy and bouncy for two weeks.', reviewer: { displayName: 'Alexis R.' }, createTime: '2026-10-02T15:00:00Z', updateTime: '2026-10-02T15:00:00Z' },
    { reviewId: `${locationId}-r2`, starRating: 'FOUR', comment: 'Great braids, started a little late.', reviewer: { displayName: 'Mari P.' }, createTime: '2026-10-20T18:30:00Z' },
    { reviewId: `${locationId}-r3`, starRating: 'FIVE', reviewer: { isAnonymous: true, displayName: 'A Google user' }, createTime: '2026-11-01T12:00:00Z' },
    { reviewId: `${locationId}-bad`, starRating: 'STAR_RATING_UNSPECIFIED' },
  ];
}
