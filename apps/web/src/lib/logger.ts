type LogContext = { requestId?: string; code?: string; status?: number };
type SafeLogContext = { request_id?: string; code?: string; status?: number };

export function redactLogContext(context: LogContext): SafeLogContext {
  const safe: SafeLogContext = {};
  if (context.requestId && /^[a-zA-Z0-9-]{1,80}$/.test(context.requestId)) safe.request_id = context.requestId;
  if (context.code && /^[A-Z][A-Z0-9_.-]{0,63}$/.test(context.code)) safe.code = context.code;
  if (typeof context.status === 'number' && Number.isInteger(context.status)) safe.status = context.status;
  return safe;
}

export const logger = {
  error(event: string, context: LogContext = {}): void {
    const safeEvent = /^[a-z0-9_.-]{1,80}$/i.test(event) ? event : 'app.error';
    console.error(safeEvent, redactLogContext(context));
  },
};
