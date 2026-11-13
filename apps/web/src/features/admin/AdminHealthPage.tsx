import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type Health } from './admin-api';
import { formatCount, formatDateTime } from './admin-format';
import { Card, ConfirmDialog, Empty, ErrorNote, Kpi, Loading, PageHead, Pill } from './AdminPrimitives';

type Job = Health['stuck_jobs'][number];

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
      setNotice(`${job.job_type} job requeued.`);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'health'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'nav', 'health'] });
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  if (health.isPending) return <Loading />;
  if (health.isError || !health.data) return <ErrorNote message={adminErrorText(health.error)} />;
  const h = health.data;

  return (
    <>
      <PageHead title="System health" sub={`Checked ${formatDateTime(h.checked_at)} (refreshes every minute). Counts cover the last 24 hours.`} actions={<Link className="btn sm ghost" to="/admin/logs?range=24h&level=error">View recent error logs</Link>} />
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      <div className="kpi-grid">
        <Kpi label="Stripe webhooks" value={formatCount(h.stripe_webhooks.received_24h)} note={`${formatCount(h.stripe_webhooks.failed_24h)} failed`} />
        <Kpi label="Texts sent" value={formatCount(h.texts.sent_24h)} note={`${formatCount(h.texts.failed_24h)} failed`} />
        <Kpi label="Emails sent" value={formatCount(h.emails.sent_24h)} note={`${formatCount(h.emails.failed_24h)} failed`} />
        <Kpi label="Calendar errors" value={formatCount(h.calendar.errors)} note={`${formatCount(h.calendar.stylists_affected)} stylists affected`} />
        <Kpi label="Dead jobs" value={formatCount(h.jobs.dead_24h)} note={`${formatCount(h.jobs.stuck)} stuck now`} />
      </div>
      <div className="cols2">
        <Card title="Failed texts">
          {h.failed_texts.length === 0 ? <Empty>No failed texts in 24 hours.</Empty> : (
            <ul className="list small">{h.failed_texts.map((t) => (
              <li key={t.id}>{formatDateTime(t.created_at)} · {t.purpose} · {t.error_code ?? 'unknown error'}{t.business_name ? ` · ${t.business_name}` : ''}</li>
            ))}</ul>
          )}
        </Card>
        <Card title="Stripe webhook failures">
          {h.webhook_failures.length === 0 ? <Empty>No failed webhooks.</Empty> : (
            <ul className="list small">{h.webhook_failures.map((w) => (
              <li key={w.id}>{formatDateTime(w.received_at)} · {w.event_type} · <span className="mono">{w.provider_event_id}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <div className="cols2">
        <Card title="Calendar sync errors">
          {h.calendar_errors.length === 0 ? <Empty>No calendar errors.</Empty> : (
            <ul className="list small">{h.calendar_errors.map((c) => (
              <li key={c.business_id}><Link to={`/admin/stylists/${c.business_id}`}>{c.business_name}</Link> · B{c.bid} · {formatDateTime(c.updated_at)}</li>
            ))}</ul>
          )}
        </Card>
        <Card title="Stuck and dead jobs">
          {h.stuck_jobs.length === 0 ? <Empty>No stuck jobs.</Empty> : (
            <table className="tbl"><thead><tr className="th"><th>Job</th><th>Status</th><th>Attempts</th><th /></tr></thead><tbody>
              {h.stuck_jobs.map((j) => (
                <tr key={j.id} className="tr">
                  <td>{j.job_type}<div className="small muted">{j.business_name ?? 'Platform'} · {j.last_error_code ?? 'no error code'}</div></td>
                  <td><Pill tone={j.status === 'dead' ? 'bad' : 'warn'}>{j.status}</Pill></td>
                  <td className="mono">{j.attempts}</td>
                  <td><button type="button" className="btn sm ghost" onClick={() => { setError(null); setJob(j); }}>Requeue</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={job !== null}
        title="Requeue this job?"
        body={<>The job runs again on the next dispatch. Only dead, failed or stuck jobs can be requeued. The reason is kept in the admin log.</>}
        confirmLabel="Requeue job"
        reasonRequired
        busy={busy}
        error={error}
        onCancel={() => setJob(null)}
        onConfirm={(reason) => void requeue(reason)}
      />
    </>
  );
}
