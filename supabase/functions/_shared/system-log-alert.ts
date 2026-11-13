import { loggedProviderFetch, writeSystemLog } from './system-log.ts';

type AlertDb = { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };

/** Thresholds: 20 application/function errors in 15m, or one dead background job. */
export async function sendSystemLogAlert(db: AlertDb, env: (name: string) => string | undefined, request: Request) {
  const key = env('RESEND_API_KEY');
  const to = env('MOVA_LOG_ALERT_EMAIL');
  const from = env('MOVA_EMAIL_FROM');
  if (!key || !to || !from) return { sent: false, reason: 'not_configured' as const };
  try {
    const { data, error } = await db.rpc('mova_system_log_alert_snapshot');
    if (error || !data || typeof data !== 'object') return { sent: false, reason: 'snapshot_unavailable' as const };
    const snapshot = data as { errors_15m?: number; dead_jobs?: number };
    const errors = Number(snapshot.errors_15m ?? 0), dead = Number(snapshot.dead_jobs ?? 0);
    const fingerprint = errors >= 20 && dead > 0 ? 'error-spike-and-dead-job' : errors >= 20 ? 'error-spike' : dead > 0 ? 'dead-job' : null;
    if (!fingerprint) return { sent: false, reason: 'healthy' as const };
    const { data: claimed, error: claimError } = await db.rpc('mova_system_log_alert_claim', { p_fingerprint: fingerprint });
    if (claimError || claimed !== true) return { sent: false, reason: 'deduplicated' as const };
    const response = await loggedProviderFetch(request, 'resend')('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: 'Mova system alert', text: `System activity needs attention. Errors in the last 15 minutes: ${errors}. Dead background jobs: ${dead}. Open /admin/logs to review details.` }),
    });
    if (!response.ok) {
      await writeSystemLog({ level: 'error', source: 'provider', eventName: 'provider.resend.alert_failed', routeOrFunction: 'job-dispatch', errorCode: 'RESEND_ALERT_FAILED', message: 'System alert email could not be delivered' });
      return { sent: false, reason: 'provider_failed' as const };
    }
    await writeSystemLog({ level: 'info', source: 'provider', eventName: 'provider.resend.alert_sent', routeOrFunction: 'job-dispatch', message: 'System alert email delivered', context: { provider: 'resend' } });
    return { sent: true, reason: 'sent' as const };
  } catch {
    return { sent: false, reason: 'unavailable' as const };
  }
}
