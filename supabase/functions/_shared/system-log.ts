import { serviceClient, corsHeaders } from './booking.ts';
import { redactSystemText, safeSystemContext } from './system-log-redaction.ts';
export { redactSystemText, safeSystemContext } from './system-log-redaction.ts';

export type SystemLogSource = 'web' | 'function' | 'database' | 'auth' | 'webhook' | 'job' | 'provider';
export type SystemLogLevel = 'info' | 'warning' | 'error';

export type SystemLogInput = {
  level: SystemLogLevel; source: SystemLogSource; eventName: string; requestId?: string | null;
  routeOrFunction?: string | null; httpStatus?: number | null; durationMs?: number | null;
  userId?: string | null; artistBusinessId?: string | null; clientId?: string | null;
  errorCode?: string | null; message?: string; context?: unknown;
};

/** Wrap an allowlisted external provider fetch without recording URLs, headers, requests or responses. */
export function loggedProviderFetch(request: Request, provider: 'stripe' | 'google' | 'resend', fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const started = performance.now();
    const requestId = request.headers.get('x-request-id');
    try {
      const response = await fetcher(input, init);
      await writeSystemLog({ level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warning' : 'info',
        source: 'provider', eventName: `provider.${provider}.request.${response.status >= 400 ? 'failed' : 'completed'}`,
        requestId, routeOrFunction: provider, httpStatus: response.status,
        durationMs: Math.round(performance.now() - started),
        errorCode: response.status >= 500 ? 'PROVIDER_HTTP_5XX' : response.status >= 400 ? 'PROVIDER_HTTP_4XX' : null,
        message: response.status >= 400 ? 'External provider returned an error status' : 'External provider request completed',
        context: { provider } });
      return response;
    } catch {
      await writeSystemLog({ level: 'error', source: 'provider', eventName: `provider.${provider}.request.failed`,
        requestId, routeOrFunction: provider, httpStatus: null, durationMs: Math.round(performance.now() - started),
        errorCode: 'PROVIDER_NETWORK_ERROR', message: 'External provider request failed', context: { provider } });
      throw new Error('PROVIDER_NETWORK_ERROR');
    }
  };
}

/** Best-effort logger. Logging failures must never affect the request being handled. */
export async function writeSystemLog(input: SystemLogInput): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const write = serviceClient().rpc('mova_system_log_append', {
      p_level: input.level, p_source: input.source, p_event_name: redactSystemText(input.eventName, 120),
      p_request_id: input.requestId ?? null, p_route_or_function: redactSystemText(input.routeOrFunction, 160) || null,
      p_http_status: input.httpStatus ?? null, p_duration_ms: input.durationMs ?? null,
      p_user_id: input.userId ?? null, p_artist_business_id: input.artistBusinessId ?? null, p_client_id: input.clientId ?? null,
      p_error_code: redactSystemText(input.errorCode, 120) || null,
      p_message: redactSystemText(input.message, 240), p_context: safeSystemContext(input.context),
    });
    await Promise.race([write, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('LOG_WRITE_TIMEOUT')), 1200); })]);
  } catch { /* Observability must fail open. */ }
  finally { if (timer) clearTimeout(timer); }
}

function requestId(request: Request): string {
  const candidate = request.headers.get('x-request-id')?.trim() ?? '';
  return /^[a-f0-9-]{16,64}$/i.test(candidate) ? candidate : crypto.randomUUID();
}

/** Shared outer wrapper: one sanitized completion/error record and a stable request ID response header. */
export function withSystemRequestLogging(name: string, handler: (request: Request) => Promise<Response> | Response) {
  return async (request: Request): Promise<Response> => {
    const id = requestId(request);
    const started = performance.now();
    try {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-request-id', id);
      const response = await handler(new Request(request, { headers: requestHeaders }));
      const status = response.status;
      await writeSystemLog({
        level: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info', source: 'function',
        eventName: status >= 500 ? 'function.request.failed' : status >= 400 ? 'function.request.rejected' : 'function.request.completed',
        requestId: id, routeOrFunction: name, httpStatus: status, durationMs: Math.round(performance.now() - started),
        errorCode: status >= 500 ? 'FUNCTION_HTTP_5XX' : status >= 400 ? 'FUNCTION_HTTP_4XX' : null,
      });
      const headers = new Headers(response.headers);
      headers.set('x-request-id', id);
      if (headers.get('content-type')?.includes('application/json')) {
        try {
          const payload: unknown = await response.clone().json();
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const correlated = { ...(payload as Record<string, unknown>), request_id: id };
            return new Response(JSON.stringify(correlated), { status: response.status, statusText: response.statusText, headers });
          }
        } catch { /* Preserve malformed/nonstandard JSON exactly as returned by the handler. */ }
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      await writeSystemLog({ level: 'error', source: 'function', eventName: 'function.exception', requestId: id,
        routeOrFunction: name, httpStatus: 500, durationMs: Math.round(performance.now() - started),
        errorCode: 'UNHANDLED_FUNCTION_ERROR', message: error instanceof Error ? error.name : 'Unhandled exception' });
      return Response.json({ data: null, error: { code: 'INTERNAL_ERROR' }, request_id: id },
        { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json', 'x-request-id': id } });
    }
  };
}
