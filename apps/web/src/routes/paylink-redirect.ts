import type { LoaderFunctionArgs } from 'react-router';

type Env = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };
type Fetcher = typeof fetch;

export function createPaylinkRedirectLoader(env: Env, fetcher: Fetcher = fetch) {
  return async ({ params, request }: LoaderFunctionArgs) => {
    const code = params.code;
    if (!code || !/^[A-Za-z0-9_-]{40,96}$/.test(code)) return new Response('Not found', { status: 404 });
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return new Response('Payment link temporarily unavailable', { status: 503 });
    const upstreamUrl = new URL(`/functions/v1/paylink-redirect?code=${encodeURIComponent(code)}${new URL(request.url).searchParams.get('result') ? `&result=${encodeURIComponent(new URL(request.url).searchParams.get('result')!)}` : ''}`, env.SUPABASE_URL);
    const upstream = await fetcher(upstreamUrl, {
      headers: { apikey: env.SUPABASE_ANON_KEY },
      redirect: 'manual',
      signal: request.signal,
    }).catch(() => null);
    if (!upstream) return new Response('Payment link temporarily unavailable', { status: 503 });
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      try {
        const destination = new URL(location ?? '');
        if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com') throw new Error();
        return Response.redirect(destination.toString(), 303);
      } catch {
        return new Response('Payment link temporarily unavailable', { status: 503 });
      }
    }
    const contentType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  };
}

export const loader = createPaylinkRedirectLoader(process.env);
