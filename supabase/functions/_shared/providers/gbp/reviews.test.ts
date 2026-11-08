import { describe, expect, it } from 'vitest';
import { FakeGoogleReviewsProvider, googleReviewsProviderFromEnv, normalizeGoogleReview } from './reviews';

describe('Google review import (task 5.9)', () => {
  it('maps star ratings and hides anonymous reviewers', () => {
    expect(normalizeGoogleReview({ reviewId: 'r', starRating: 'THREE', comment: 'ok', reviewer: { displayName: 'Kim' }, createTime: '2026-10-01T00:00:00Z' })).toEqual({ id: 'r', rating: 3, body: 'ok', displayName: 'Kim', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null });
    expect(normalizeGoogleReview({ reviewId: 'r', starRating: 'FIVE', reviewer: { isAnonymous: true, displayName: 'A Google user' } })?.displayName).toBe('');
  });
  it('drops reviews without an id or a rating', () => {
    expect(normalizeGoogleReview({ starRating: 'FIVE' })).toBeNull();
    expect(normalizeGoogleReview({ reviewId: 'r', starRating: 'STAR_RATING_UNSPECIFIED' })).toBeNull();
    expect(normalizeGoogleReview('nope')).toBeNull();
  });
  it('the fake returns three usable fixture reviews and refuses real location ids', async () => {
    const provider = new FakeGoogleReviewsProvider();
    expect((await provider.listReviews('fake-loc')).map((review) => review.rating)).toEqual([5, 4, 5]);
    await expect(provider.listReviews('locations/123')).rejects.toThrow('GBP_LOCATION_NOT_FOUND');
    expect(provider.live).toBe(false);
    expect(googleReviewsProviderFromEnv(() => undefined)).toBeNull();
  });
});
