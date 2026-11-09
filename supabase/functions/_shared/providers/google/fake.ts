// Fake Google provider (P6). Sandbox and tests only: it never reaches Google, every address is labelled
// ".invalid", and every write is recorded in `calls` so tests can assert what would have been sent.
import { fakeReviewFixtures, normalizeGoogleReview } from './reviews.ts';
import { GoogleProviderError, type GoogleAuthorizationInput, type GoogleCalendarEvent, type GoogleCalendarItem, type GoogleListingItem, type GoogleLocation, type GoogleProvider, type GoogleReview, type GoogleTokenResult } from './types.ts';

export const FAKE_CODE = 'fake-code';
export const FAKE_REFRESH_TOKEN = 'fake-refresh-token';
export const FAKE_EMAIL = 'sandbox.stylist@fake.mova.invalid';
export const FAKE_LOCATION_ID = 'accounts/fake-account/locations/fake-studio-9';

export type FakeCall =
  | { op: 'calendar_event'; calendarId: string; event: GoogleCalendarEvent }
  | { op: 'listing'; locationId: string; item: GoogleListingItem }
  | { op: 'reply'; reviewId: string; comment: string }
  | { op: 'reply_deleted'; reviewId: string };

export class FakeGoogleProvider implements GoogleProvider {
  readonly name = 'fake';
  readonly live = false;
  readonly calls: FakeCall[] = [];

  authorizationUrl(input: GoogleAuthorizationInput): string {
    // The consent screen is skipped: the redirect comes straight back with the fake code and our state.
    const url = new URL(input.redirectUri);
    url.search = new URLSearchParams({ code: FAKE_CODE, state: input.state }).toString();
    return url.toString();
  }

  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleTokenResult> {
    if (input.code !== FAKE_CODE || !input.codeVerifier) return Promise.reject(new GoogleProviderError('GOOGLE_TOKEN_EXCHANGE_FAILED'));
    return Promise.resolve({ refreshToken: FAKE_REFRESH_TOKEN, email: FAKE_EMAIL, grantedScopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/business.manage'] });
  }

  accessToken(refreshToken: string): Promise<string> {
    if (!refreshToken) return Promise.reject(new GoogleProviderError('GOOGLE_REFRESH_FAILED'));
    return Promise.resolve('fake-access-token');
  }

  listCalendars(): Promise<GoogleCalendarItem[]> {
    return Promise.resolve([
      { id: 'fake-work', summary: 'Work', primary: true },
      { id: 'fake-personal', summary: 'Personal', primary: false },
    ]);
  }

  saveCalendarEvent(_token: string, calendarId: string, event: GoogleCalendarEvent): Promise<void> {
    this.calls.push({ op: 'calendar_event', calendarId, event });
    return Promise.resolve();
  }

  listLocations(): Promise<GoogleLocation[]> {
    return Promise.resolve([{ id: FAKE_LOCATION_ID, title: 'Sample studio (fake provider)' }]);
  }

  applyListingItem(_token: string, locationId: string, item: GoogleListingItem): Promise<void> {
    if (!locationId.includes('fake-')) return Promise.reject(new GoogleProviderError('GOOGLE_LOCATION_NOT_FOUND'));
    this.calls.push({ op: 'listing', locationId, item });
    return Promise.resolve();
  }

  listReviews(_token: string, locationId: string): Promise<GoogleReview[]> {
    if (!locationId.includes('fake-')) return Promise.reject(new GoogleProviderError('GOOGLE_LOCATION_NOT_FOUND'));
    return Promise.resolve(fakeReviewFixtures(locationId).map(normalizeGoogleReview).filter((review): review is GoogleReview => review !== null));
  }

  replyToReview(_token: string, _locationId: string, reviewId: string, comment: string): Promise<void> {
    this.calls.push({ op: 'reply', reviewId, comment });
    return Promise.resolve();
  }

  deleteReviewReply(_token: string, _locationId: string, reviewId: string): Promise<void> {
    this.calls.push({ op: 'reply_deleted', reviewId });
    return Promise.resolve();
  }
}
