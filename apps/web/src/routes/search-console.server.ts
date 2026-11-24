import { createSign } from 'node:crypto';
import type { SearchDiscovery, SearchRow } from '../features/admin/discovery-data';

const oauthUrl = 'https://oauth2.googleapis.com/token';
const scope = 'https://www.googleapis.com/auth/webmasters.readonly';
const day = 86_400_000;
const formatDay = (value: number) => new Date(value).toISOString().slice(0, 10);
let cache: { expires: number; report: Promise<SearchDiscovery> } | undefined;

type Connection = { client_email: string; private_key: string };
type SearchResponse = { rows?: SearchRow[]; metadata?: { first_incomplete_date?: string } };

function jwtToken(account: Connection, now: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const claims = encode({ iss: account.client_email, scope, aud: oauthUrl, iat, exp: iat + 3600 });
  const data = `${encode({ alg: 'RS256', typ: 'JWT' })}.${claims}`;
  const signature = createSign('RSA-SHA256').update(data).sign(account.private_key, 'base64url');
  return `${data}.${signature}`;
}

async function fetchSearchDiscovery(raw: string, property: string, now: number): Promise<SearchDiscovery> {
  try {
    const account = JSON.parse(raw) as Connection;
    const tokenResponse = await fetch(oauthUrl, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtToken(account, now),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!tokenResponse.ok) return { state: 'unavailable' };
    const { access_token: token } = await tokenResponse.json() as { access_token?: string };
    if (!token) return { state: 'unavailable' };
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
    async function query(startDate: string, endDate: string, dimensions: string[] = [], dataState = 'final') {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, dimensions, type: 'web', dataState, rowLimit: dimensions.length ? 25 : 1 }),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error('SEARCH_CONSOLE_REQUEST_FAILED');
      return await response.json() as SearchResponse;
    }

    const previousDay = Date.parse(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)) - day;
    const freshness = await query(formatDay(previousDay - 7 * day), formatDay(previousDay), ['date'], 'all');
    const incomplete = Date.parse(freshness.metadata?.first_incomplete_date ?? '');
    const end = Number.isNaN(incomplete) ? previousDay : Math.min(previousDay, incomplete - day);
    const start = formatDay(end - 27 * day);
    const through = formatDay(end);
    const [current, prior, terms, pages] = await Promise.all([
      query(start, through),
      query(formatDay(end - 55 * day), formatDay(end - 28 * day)),
      query(start, through, ['query', 'page']),
      query(start, through, ['page']),
    ]);
    return {
      state: 'ready', start, through, current: current.rows?.[0] ?? null, prior: prior.rows?.[0] ?? null,
      terms: terms.rows ?? [], pages: pages.rows ?? [],
    };
  } catch {
    return { state: 'unavailable' };
  }
}

export async function searchDiscovery(): Promise<SearchDiscovery> {
  const { MOVA_SEARCH_CONSOLE_SERVICE_ACCOUNT: credentials, MOVA_SEARCH_CONSOLE_SITE: property } = process.env;
  if (!credentials || !property) return { state: 'not_configured' };
  const now = Date.now();
  if (cache && cache.expires > now) return cache.report;
  const report = fetchSearchDiscovery(credentials, property, now);
  cache = { expires: now + 30 * 60_000, report };
  const result = await report;
  if (result.state === 'unavailable' && cache.report === report) cache.expires = Date.now() + 60_000;
  return result;
}
