import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type Health } from './admin-api';
import { formatCount, formatDateTime } from './admin-format';
import { Card, ConfirmDialog, Empty, ErrorNote, Kpi, Loading, PageHead, Pill } from './AdminPrimitives';

type Job = Health['stuck_jobs'][number];
const Dot = ({ bad, children }: { bad: boolean; children: ReactNode }) => <><i className={`health-dot${bad ? ' is-bad' : ''}`} aria-hidden="true" />{children}</>;

export default function AdminHealthPage() {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['admin', 'health'], queryFn: () => adminRpc<Health>('mova_admin_health'), refetchInterval: 60_000 });
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requeue(reason: string) {
    if (!job) return;
    setBusy(true); setError(null);
    try {
      await adminRpc('mova_admin_requeue_job', { p_job_id: job.id, p_reason: reason });
      setJob(null);
      setNotice(`${job.job_type} job queued to run now.`);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'health'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'nav', 'health'] });
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  if (health.isPending) return <Loading />;
  if (health.isError || !health.data) return <ErrorNote message={adminErrorText(health.error)} />;
  const h = health.data;

  return (
    <>
      <PageHead title="System health" sub={`Checked ${formatDateTime(h.checked_at)} (refreshes every minute). Counts cover the last 24 hours.`} actions={<Link className="btn sm" to="/admin/logs?range=24h&level=error">View recent error logs</Link>} />
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {/* A10: each tile leads with the problem; the tables carry the action for each row. Actions with no
          backend yet (retry a text, replay a webhook, email a stylist) are shown but disabled. */}
      <div className="k5">
        <Kpi label={<Dot bad={h.stripe_webhooks.failed_24h > 0}>Stripe webhooks</Dot>} value={h.stripe_webhooks.failed_24h ? `${formatCount(h.stripe_webhooks.failed_24h)} failed` : 'All received'} note={`of ${formatCount(h.stripe_webhooks.received_24h)} received`} />
        <Kpi label={<Dot bad={h.texts.failed_24h > 0}>Texts</Dot>} value={h.texts.failed_24h ? `${formatCount(h.texts.failed_24h)} failed` : 'All delivered'} note={`of ${formatCount(h.texts.sent_24h)} sent`} />
        <Kpi label={<Dot bad={h.emails.failed_24h > 0}>Emails</Dot>} value={h.emails.failed_24h ? `${formatCount(h.emails.failed_24h)} failed` : 'All delivered'} note={`of ${formatCount(h.emails.sent_24h)} sent`} />
        <Kpi label={<Dot bad={h.calendar.errors > 0}>Calendar sync</Dot>} value={h.calendar.errors ? `${formatCount(h.calendar.errors)} errors` : 'No errors'} note={`${formatCount(h.calendar.stylists_affected)} stylists affected`} />
        <Kpi label={<Dot bad={h.jobs.stuck > 0}>Background jobs</Dot>} value={h.jobs.stuck ? `${formatCount(h.jobs.stuck)} stuck` : 'None stuck'} note={`${formatCount(h.jobs.dead_24h)} dead in 24 hours`} />
      </div>
      <Card title="Failed texts" className="pad0">
        {h.failed_texts.length === 0 ? <div style={{ padding: 16 }}><Empty>No failed texts in 24 hours.</Empty></div> : (
          <div className="tbl-wrap flat"><table className="tbl"><thead><tr className="th"><th>When</th><th>Stylist</th><th>Client</th><th>Purpose</th><th>Error</th><th /></tr></thead><tbody>
            {h.failed_texts.map((t) => (
              <tr key={t.id} className="tr">
                <td className="small">{formatDateTime(t.created_at)}</td>
                <td>{t.business_name ? <>{t.business_name}{t.bid ? <span className="small muted"> · BID-{t.bid}</span> : null}</> : '—'}</td>
                <td className="small">{t.client_ref ?? '—'}</td>
                <td>{t.purpose}</td>
                <td><Pill tone="bad">{t.error_code ?? 'Unknown'}</Pill></td>
                <td><button type="button" className="btn sm" disabled title="Retrying a text is not available yet">Retry</button></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      <div className="cols2">
        <Card title="Stripe webhook failures" className="pad0">
          {h.webhook_failures.length === 0 ? <div style={{ padding: 16 }}><Empty>No failed webhooks.</Empty></div> : (
            <div className="tbl-wrap flat"><table className="tbl"><thead><tr className="th"><th>When</th><th>Event</th><th /></tr></thead><tbody>
              {h.webhook_failures.map((w) => (
                <tr key={w.id} className="tr"><td className="small">{formatDateTime(w.received_at)}</td><td>{w.event_type}<div className="small muted mono">{w.provider_event_id}</div></td>
                  <td><button type="button" className="btn sm" disabled title="Replay from the Stripe dashboard for now">Replay</button></td></tr>
              ))}
            </tbody></table></div>
          )}
        </Card>
        <Card title="Calendar sync errors" className="pad0">
          {h.calendar_errors.length === 0 ? <div style={{ padding: 16 }}><Empty>No calendar errors.</Empty></div> : (
            <div className="tbl-wrap flat"><table className="tbl"><thead><tr className="th"><th>Stylist</th><th>Since</th><th /></tr></thead><tbody>
              {h.calendar_errors.map((c) => (
                <tr key={c.business_id} className="tr"><td><Link to={`/admin/stylists/${c.business_id}`}><strong>{c.business_name}</strong></Link><div className="small muted">BID-{c.bid}</div></td><td className="small">{formatDateTime(c.updated_at)}</td>
                  <td><button type="button" className="btn sm" disabled title="Emailing a stylist from here is not available yet">Email stylist</button></td></tr>
              ))}
            </tbody></table></div>
          )}
        </Card>
      </div>
      <Card title="Stuck and dead jobs" className="pad0">
        {h.stuck_jobs.length === 0 ? <div style={{ padding: 16 }}><Empty>No stuck jobs.</Empty></div> : (
          <div className="tbl-wrap flat"><table className="tbl"><thead><tr className="th"><th>Job</th><th>Stylist</th><th>Status</th><th className="num">Attempts</th><th /></tr></thead><tbody>
            {h.stuck_jobs.map((j) => (
              <tr key={j.id} className="tr">
                <td>{j.job_type}<div className="small muted">{j.last_error_code ?? 'no error code'}</div></td>
                <td>{j.business_name ?? 'Platform'}</td>
                <td><Pill tone={j.status === 'dead' ? 'bad' : 'warn'}>{j.status}</Pill></td>
                <td className="num">{j.attempts}</td>
                <td><button type="button" className="btn sm" onClick={() => { setError(null); setJob(j); }}>Run now</button></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      <ConfirmDialog
        open={job !== null}
        title="Run this job now?"
        body={<>The job runs again on the next dispatch. Only dead, failed or stuck jobs can be requeued. The reason is kept in the admin log.</>}
        confirmLabel="Run now"
        reasonRequired
        busy={busy}
        error={error}
        onCancel={() => setJob(null)}
        onConfirm={(reason) => void requeue(reason)}
      />
    </>
  );
}
