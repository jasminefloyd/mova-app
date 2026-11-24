import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc } from './admin-api';
import { formatCount, formatMoneyWhole, formatPercent } from './admin-format';
import { Card, ErrorNote, Kpi, Loading } from './AdminPrimitives';
import type { ActivationCohort, SubscriptionSummary } from './discovery-data';

const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function milestone(count: number, verified: number, hours: number | null) {
  const elapsed = hours === null ? null : hours < 48 ? `${hours} hr` : `${(hours / 24).toFixed(1)} days`;
  return <>{formatCount(count)} · {formatPercent(count, verified)}{elapsed && <div className="small muted">{elapsed} median</div>}</>;
}

export function AdminActivation() {
  const query = useQuery({
    queryKey: ['admin', 'activation'],
    queryFn: () => adminRpc<ActivationCohort[]>('mova_admin_activation'),
  });
  return <Card title="Stylist activation" aside={<span className="small muted">Last 6 months</span>}>
    <p className="small muted">Each month groups stylists by email verification date. Counts and median times are measured from verified signup. A booking is counted when a non-draft appointment is created. The current month is still in progress.</p>
    {query.isPending && <Loading />}
    {query.isError && <div className="row"><ErrorNote message={adminErrorText(query.error)} /><button type="button" className="btn sm" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.data?.length === 0 && <p className="muted">No verified stylist signups in these cohorts.</p>}
    {query.data && query.data.length > 0 && <div className="tbl-wrap flat analytics-table">
      <table className="tbl"><thead><tr className="th"><th scope="col">Signup month</th><th scope="col">Verified signups</th><th scope="col">Published profile</th><th scope="col">First booking</th><th scope="col">First completed visit</th></tr></thead>
        <tbody>{query.data.map(row => <tr className="tr" key={row.cohort}>
          <th scope="row">{month.format(new Date(row.cohort))}</th><td>{formatCount(row.verified)}</td>
          <td>{milestone(row.published, row.verified, row.published_hours)}</td>
          <td>{milestone(row.booked, row.verified, row.booked_hours)}</td>
          <td>{milestone(row.completed, row.verified, row.completed_hours)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </Card>;
}

export function AdminSubscriptionMetrics({ days }: { days: number }) {
  const query = useQuery({
    queryKey: ['admin', 'subscription-summary', days],
    queryFn: () => adminRpc<SubscriptionSummary>('mova_admin_subscription_summary', { p_days: days }),
  });
  const data = query.data;
  const period = `Last ${days} days`;
  return <Card title="Subscriptions and retention">
    {query.isPending && <Loading />}
    {query.isError && <div className="row"><ErrorNote message={adminErrorText(query.error)} /><button type="button" className="btn sm" onClick={() => void query.refetch()}>Retry</button></div>}
    {data && <>
      <div className="k4">
        <Kpi label="Monthly recurring revenue" value={formatMoneyWhole(data.mrr_minor)} note={`${formatCount(data.paid_subscriptions)} active paid subscriptions at list price`} />
        <Kpi label="Accounts by plan" value={formatCount((data.plans.free ?? 0) + (data.plans.pro ?? 0) + (data.plans.ai_growth ?? 0))} note={`Free ${formatCount(data.plans.free)} · Pro ${formatCount(data.plans.pro)} · AI + Growth ${formatCount(data.plans.ai_growth)}`} />
        <Kpi label="Active trials" value={formatCount(data.active_trials)} note={`${formatCount(data.expiring_trials)} end in the next 7 days`} />
        <Kpi label="Trial to paid" value={formatPercent(data.trials_converted, data.trials_resolved, 1)} note={`${data.trials_converted} of ${data.trials_resolved} resolved · ${period}`} />
        <Kpi label="Payment failures" value={formatCount(data.billing_events.payment_failures)} note={`${period} · ${data.past_due} currently past due`} />
        <Kpi label="Subscription cancellations" value={formatCount(data.billing_events.cancellations)} note={`${period} · ${data.pending_cancellations} scheduled`} />
        <Kpi label="Stylist deletion requests" value={formatCount(data.deletion_requests)} note={`${period} · ${data.open_deletion_requests} currently on file`} />
      </div>
      <p className="small muted">Plan counts reflect account access, including trials and admin grants. Recurring revenue uses live Stripe subscriptions. Payment failures and cancellations count live Stripe events. Trial conversion uses matched live trial records. Deletion counts reflect retained requests.</p>
    </>}
  </Card>;
}
