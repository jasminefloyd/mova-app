// Live Google provider (P6). WRITTEN BUT OFF: index.ts only builds it when MOVA_GOOGLE_PROVIDER=live,
// MOVA_GOOGLE_LIVE_ENABLED=true and the OAuth client is configured. Nothing here has been run against
// Google yet; the Business Profile request shapes need checking against Google's current references and
// approved API access before the switch is turned on (owner decision O-GBP, see the P6 report).
import { normalizeGoogleReview } from './reviews.ts';
import { GoogleProviderError, type GoogleAuthorizationInput, type GoogleCalendarEvent, type GoogleCalendarItem, type GoogleListingItem, type GoogleLocation, type GoogleProvider, type GoogleReview, type GoogleTokenResult } from './types.ts';

export type LiveGoogleConfig = { clientId: string; clientSecret: string; fetcher?: typeof fetch };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const REVIEWS_API = 'https://mybusiness.googleapis.com/v4';
const LOCATION_ID = /^accounts\/[0-9A-Za-z_-]{1,64}\/locations\/[0-9A-Za-z_-]{1,64}$/;
const REVIEW_ID = /^[0-9A-Za-z_.-]{1,200}$/;
const TIMEOUT_MS = 10_000;

export class LiveGoogleProvider implements GoogleProvider {
  readonly name = 'google';
  readonly live = true;
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: LiveGoogleConfig) {
    this.fetcher = config.fetcher ?? fetch;
  }

  authorizationUrl(input: GoogleAuthorizationInput): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.clientId, redirect_uri: input.redirectUri, response_type: 'code', scope: input.scopes.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: input.state,
      code_challenge: input.codeChallenge, code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleTokenResult> {
    const token = await this.tokenRequest({ code: input.code, code_verifier: input.codeVerifier, redirect_uri: input.redirectUri, grant_type: 'authorization_code' });
    if (typeof token.refresh_token !== 'string') throw new GoogleProviderError('GOOGLE_TOKEN_EXCHANGE_FAILED');
    const profile = await this.getJson(USERINFO_URL, typeof token.access_token === 'string' ? token.access_token : '').catch(() => ({} as Record<string, unknown>));
    const grantedScopes = typeof token.scope === 'string' ? token.scope.split(' ').filter(Boolean) : [];
    return { refreshToken: token.refresh_token, email: typeof profile.email === 'string' ? profile.email : null, grantedScopes };
  }

  async accessToken(refreshToken: string): Promise<string> {
    const token = await this.tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }).catch(() => { throw new GoogleProviderError('GOOGLE_REFRESH_FAILED'); });
    if (typeof token.access_token !== 'string') throw new GoogleProviderError('GOOGLE_REFRESH_FAILED');
    return token.access_token;
  }

  async listCalendars(accessToken: string): Promise<GoogleCalendarItem[]> {
    const body = await this.getJson(`${CALENDAR_API}/users/me/calendarList?minAccessRole=writer`, accessToken);
    const items = Array.isArray(body.items) ? body.items : [];
    return items.flatMap((item: Record<string, unknown>) => typeof item.id === 'string' ? [{ id: item.id, summary: String(item.summary ?? item.id).slice(0, 200), primary: item.primary === true }] : []);
  }

  async saveCalendarEvent(accessToken: string, calendarId: string, event: GoogleCalendarEvent): Promise<void> {
    const base = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
    const body = event.cancelled
      ? { id: event.eventId, status: 'cancelled', sequence: event.sequence, updated: new Date().toISOString() }
      : { id: event.eventId, summary: event.summary, start: { dateTime: event.startsAt }, end: { dateTime: event.endsAt }, sequence: event.sequence };
    const response = await this.send(event.exists ? 'PUT' : 'POST', event.exists ? `${base}/${encodeURIComponent(event.eventId)}` : base, accessToken, body);
    if (!response.ok && !(event.cancelled && response.status === 410)) throw new GoogleProviderError('GOOGLE_EVENT_WRITE_FAILED');
  }

  async listLocations(accessToken: string): Promise<GoogleLocation[]> {
    const accounts = await this.getJson(`${ACCOUNTS_API}/accounts`, accessToken);
    const locations: GoogleLocation[] = [];
    for (const account of Array.isArray(accounts.accounts) ? accounts.accounts : []) {
      if (typeof account.name !== 'string') continue;
      const found = await this.getJson(`${BUSINESS_INFO_API}/${account.name}/locations?readMask=name,title`, accessToken);
      for (const location of Array.isArray(found.locations) ? found.locations : []) {
        if (typeof location.name === 'string') locations.push({ id: `${account.name}/${location.name}`, title: String(location.title ?? '').slice(0, 200) });
      }
    }
    return locations;
  }

  async applyListingItem(accessToken: string, locationId: string, item: GoogleListingItem): Promise<void> {
    const location = locationPath(locationId);
    const { mask, body } = listingPatch(item);
    const response = await this.send('PATCH', `${BUSINESS_INFO_API}/${location}?updateMask=${mask}`, accessToken, body);
    if (!response.ok) throw new GoogleProviderError('GOOGLE_LISTING_WRITE_FAILED');
  }

  async listReviews(accessToken: string, locationId: string): Promise<GoogleReview[]> {
    assertLocation(locationId);
    const body = await this.getJson(`${REVIEWS_API}/${locationId}/reviews?pageSize=50`, accessToken);
    return (Array.isArray(body.reviews) ? body.reviews : []).map(normalizeGoogleReview).filter((review: GoogleReview | null): review is GoogleReview => review !== null);
  }

  async replyToReview(accessToken: string, locationId: string, reviewId: string, comment: string): Promise<void> {
    const path = reviewPath(locationId, reviewId);
    const response = await this.send('PUT', `${path}/reply`, accessToken, { comment });
    if (!response.ok) throw new GoogleProviderError('GOOGLE_REPLY_FAILED');
  }

  async deleteReviewReply(accessToken: string, locationId: string, reviewId: string): Promise<void> {
    const response = await this.send('DELETE', `${reviewPath(locationId, reviewId)}/reply`, accessToken);
    if (!response.ok && response.status !== 404) throw new GoogleProviderError('GOOGLE_REPLY_DELETE_FAILED');
  }

  private async tokenRequest(fields: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetcher(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...fields }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new GoogleProviderError('GOOGLE_TOKEN_REQUEST_FAILED');
    return body;
  }

  private async send(method: string, url: string, accessToken: string, body?: unknown): Promise<Response> {
    return this.fetcher(url, {
      method, headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private async getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
    const response = await this.send('GET', url, accessToken);
    if (!response.ok) throw new GoogleProviderError('GOOGLE_API_FAILED');
    return await response.json() as Record<string, unknown>;
  }
}

function assertLocation(locationId: string) {
  if (!LOCATION_ID.test(locationId)) throw new GoogleProviderError('GOOGLE_LOCATION_INVALID');
}
function locationPath(locationId: string) {
  assertLocation(locationId);
  return locationId.split('/').slice(2).join('/');
}
function reviewPath(locationId: string, reviewId: string) {
  assertLocation(locationId);
  if (!REVIEW_ID.test(reviewId)) throw new GoogleProviderError('GOOGLE_REVIEW_INVALID');
  return `${REVIEWS_API}/${locationId}/reviews/${reviewId}`;
}

/** Google Business Profile field mask and body for one listing item. */
export function listingPatch(item: GoogleListingItem): { mask: string; body: Record<string, unknown> } {
  if (item.kind === 'profile') return { mask: 'title,profile.description', body: { title: item.payload.title, profile: { description: item.payload.description } } };
  if (item.kind === 'booking_link') return { mask: 'websiteUri', body: { websiteUri: item.payload.websiteUri } };
  if (item.kind === 'hours') {
    const periods = (item.payload.regularHours as Array<Record<string, unknown>>).map((period) => ({ openDay: period.openDay, openTime: period.openTime, closeDay: period.closeDay, closeTime: period.closeTime }));
    return { mask: 'regularHours', body: { regularHours: { periods } } };
  }
  const menu = (item.payload.services ?? []) as Array<{ displayName: string; price: unknown }>;
  return { mask: 'serviceItems', body: { serviceItems: menu.map((service) => ({ freeFormServiceItem: { category: 'Hair', displayName: service.displayName }, price: service.price })) } };
}
