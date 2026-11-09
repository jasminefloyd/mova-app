// Google provider adapter (P6). One connection serves Business Profile and Google Calendar, so one
// interface covers both. Implementations: FakeGoogleProvider (sandbox and tests, never reaches Google)
// and LiveGoogleProvider (written, OFF by default). Selected by googleProviderFromEnv in index.ts.

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export const GOOGLE_SCOPES = [GOOGLE_CALENDAR_SCOPE, GOOGLE_BUSINESS_SCOPE] as const;

export type GoogleCalendarItem = { id: string; summary: string; primary: boolean };

/** One Mova appointment as a Google Calendar event. `exists` is false the first time it is written. */
export type GoogleCalendarEvent = {
  eventId: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  sequence: number;
  exists: boolean;
};

/** A Business Profile location. `id` is the full resource name, accounts/{a}/locations/{l}. */
export type GoogleLocation = { id: string; title: string };

/** One listing item Mova sends. `payload` is already shaped for Google (see listing.ts). */
export type GoogleListingItem = { key: string; kind: 'profile' | 'hours' | 'services' | 'booking_link'; payload: Record<string, unknown> };

export type GoogleReview = { id: string; rating: number; body: string; displayName: string; createdAt: string | null; updatedAt: string | null };

export type GoogleAuthorizationInput = { redirectUri: string; state: string; codeChallenge: string; scopes: readonly string[] };
export type GoogleTokenResult = { refreshToken: string; email: string | null; grantedScopes: string[] };

export interface GoogleProvider {
  /** Stored with the connection row for audit. */
  readonly name: string;
  /** True only for a provider that reaches Google. The fake returns false. */
  readonly live: boolean;
  authorizationUrl(input: GoogleAuthorizationInput): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleTokenResult>;
  accessToken(refreshToken: string): Promise<string>;
  listCalendars(accessToken: string): Promise<GoogleCalendarItem[]>;
  saveCalendarEvent(accessToken: string, calendarId: string, event: GoogleCalendarEvent): Promise<void>;
  listLocations(accessToken: string): Promise<GoogleLocation[]>;
  applyListingItem(accessToken: string, locationId: string, item: GoogleListingItem): Promise<void>;
  listReviews(accessToken: string, locationId: string): Promise<GoogleReview[]>;
  replyToReview(accessToken: string, locationId: string, reviewId: string, comment: string): Promise<void>;
  deleteReviewReply(accessToken: string, locationId: string, reviewId: string): Promise<void>;
}

/** Thrown by every provider call that cannot complete. The message is a stable code, never provider text. */
export class GoogleProviderError extends Error {
  constructor(code: string) { super(code); this.name = 'GoogleProviderError'; }
}
