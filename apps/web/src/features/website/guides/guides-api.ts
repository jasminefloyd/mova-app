import type { GuideResult, GuidesListResult } from './guide-types';

/** Thrown when the public guides call fails. `status` is the HTTP status (404 means the guide does not exist). */
export class GuidesRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('GUIDES_REQUEST_FAILED');
    this.status = status;
  }
}

// Server-side loaders read the runtime env; the browser uses the build-time public values.
function endpoint(): { url?: string; anonKey?: string } {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  return {
    url: env?.SUPABASE_URL ?? env?.VITE_SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL,
    anonKey: env?.SUPABASE_ANON_KEY ?? env?.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

export async function requestGuides<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { url, anonKey } = endpoint();
  if (!url || !anonKey) throw new GuidesRequestError(503);
  const response = await fetch(`${url}/functions/v1/guides-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
  const envelope = await response.json().catch(() => null) as { data?: T | null } | null;
  if (!response.ok || !envelope?.data) throw new GuidesRequestError(response.ok ? 503 : response.status);
  return envelope.data;
}

export function fetchGuidesList(options: { category?: string | undefined; cursor?: string | undefined; limit?: number | undefined }, signal?: AbortSignal) {
  return requestGuides<GuidesListResult>({ action: 'list', ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) }, signal);
}

export function fetchGuide(slug: string, signal?: AbortSignal) {
  return requestGuides<GuideResult>({ action: 'get', slug }, signal);
}
