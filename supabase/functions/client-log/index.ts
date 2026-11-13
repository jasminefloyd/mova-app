import { withSystemRequestLogging, writeSystemLog, redactSystemText, safeSystemContext } from '../_shared/system-log.ts';
import { corsHeaders, serviceClient } from '../_shared/booking.ts';

const handler = async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: corsHeaders });
  const origin = request.headers.get('origin') ?? '';
  if (origin && !/^https:\/\/(?:mova-beauty\.co|www\.mova-beauty\.co|admin\.mova-beauty\.co|[a-z0-9-]+\.vercel\.app)$/.test(origin)) {
    return Response.json({ error: 'ORIGIN_NOT_ALLOWED' }, { status: 403, headers: corsHeaders });
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const ipDigest = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  const db = serviceClient();
  const { data: allowed, error: limitError } = await db.rpc('mova_client_log_rate_limit', { p_ip_digest: ipDigest });
  if (limitError || allowed !== true) return Response.json({ error: 'RATE_LIMITED' }, { status: 429, headers: corsHeaders });
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
  } catch { return Response.json({ error: 'INVALID_BODY' }, { status: 400, headers: corsHeaders }); }
  const level = payload.level === 'error' || payload.level === 'warning' ? payload.level : 'error';
  const route = redactSystemText(payload.route, 120);
  const event = payload.event === 'unhandledrejection' ? 'web.unhandled_rejection' : payload.event === 'error' ? 'web.uncaught_error' : 'web.render_error';
  const requestId = typeof payload.request_id === 'string' && /^[a-f0-9-]{16,64}$/i.test(payload.request_id) ? payload.request_id : crypto.randomUUID();
  const context = safeSystemContext({ route, app_version: payload.app_version, browser_event: event });
  const { data: { user } } = await db.auth.getUser(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  await writeSystemLog({ level, source: 'web', eventName: event, requestId, routeOrFunction: route,
    userId: user?.id ?? null, errorCode: 'CLIENT_ERROR', message: 'Client-side error', context });
  return Response.json({ ok: true, request_id: requestId }, { headers: { ...corsHeaders, 'x-request-id': requestId } });
};

Deno.serve(withSystemRequestLogging('client-log', handler));
