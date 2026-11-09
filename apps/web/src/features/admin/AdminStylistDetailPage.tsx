import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, isAdminError, type StylistDetail } from './admin-api';
import { formatCount, formatDate, formatDateTime, formatFeeBps, formatMoneyMinor, formatPercent } from './admin-format';
import { Card, ConfirmDialog, ErrorNote, Loading, PageHead, Pill } from './AdminPrimitives';

export default function AdminStylistDetailPage() {
  const { businessId = '' } = useParams();
  const queryClient = useQueryClient();
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['admin', 'stylist', businessId],
    queryFn: () => adminRpc<StylistDetail>('mova_admin_stylist_detail', { p_business_id: businessId }),
    enabled: businessId.length > 0,
  });

  async function unpublish(reason: string) {
    setBusy(true);
    setActionError(null);
    try {
      await adminRpc('mova_admin_unpublish_page', { p_artist_business_id: businessId, p_reason: reason });
      setUnpublishOpen(false);
      setNotice('The public page is unpublished. The stylist can publish it again from their settings.');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] });
    } catch (error) {
      setActionError(adminErrorText(error));
      if (isAdminError(error, 'PLATFORM_ADMIN_REQUIRED')) setUnpublishOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (detail.isPending) return <Loading />;
  if (detail.isError || !detail.data) return <ErrorNote message={adminErrorText(detail.error)} />;
  const d = detail.data;

  return (
    <>
      <PageHead
        title={d.profile?.display_name ?? d.business.name}
        sub={`${d.business.name} · B${d.business.bid} · ${d.owner_email ?? 'No owner email on file'}`}
        actions={<>
          <Link className="btn sm ghost" to={`/admin/stylists/${businessId}/audit`}>Audit log</Link>
          <Link className="btn sm ghost" to="/admin/fees">Fees</Link>
          <button type="button" className="btn sm danger" onClick={() => setUnpublishOpen(true)} disabled={!d.profile?.is_published}>Unpublish page</button>
        </>}
      />
      <ErrorNote message={actionError} />
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      <div className="cols2">
        <Card title="Account">
          <dl className="kv">
            <dt>Status</dt><dd><Pill tone={d.business.status === 'active' ? 'ok' : 'bad'}>{d.business.status}</Pill></dd>
            <dt>Plan</dt><dd>{d.plan.name}</dd>
            <dt>Fee</dt><dd>{formatFeeBps(d.fee.fee_bps)} <span className="small muted">({d.fee.source === 'override' ? 'custom rate' : d.fee.source === 'plan' ? 'plan rate' : 'platform default'})</span></dd>
            <dt>Joined</dt><dd>{formatDate(d.business.created_at)}</dd>
            <dt>Public page</dt><dd>{d.profile ? (d.profile.is_published ? <Pill tone="ok">Published</Pill> : <Pill tone="off">Not published</Pill>) : 'No page yet'}</dd>
            <dt>Language</dt><dd>{d.profile?.preferred_locale === 'es-US' ? 'Spanish (US)' : 'English (US)'}</dd>
          </dl>
        </Card>
        <Card title="Payouts">
          {d.stripe ? (
            <dl className="kv">
              <dt>Status</dt><dd>{d.stripe.status}</dd>
              <dt>Charges</dt><dd>{d.stripe.charges_enabled ? 'Enabled' : 'Off'}</dd>
              <dt>Payouts</dt><dd>{d.stripe.payouts_enabled ? 'Enabled' : 'Off'}</dd>
            </dl>
          ) : <p className="muted">Payouts are not connected.</p>}
        </Card>
      </div>
      <div className="cols2">
        <Card title="Last 30 days">
          <dl className="kv">
            <dt>Completed</dt><dd>{formatCount(d.metrics.completed_30d)}</dd>
            <dt>Processed</dt><dd>{formatMoneyMinor(d.metrics.processed_30d_minor)}</dd>
            <dt>Mova fees</dt><dd>{formatMoneyMinor(d.metrics.fees_30d_minor)}</dd>
            <dt>Repeat clients (90 days)</dt><dd>{formatPercent(d.metrics.repeat_clients_90d, d.metrics.clients_90d)} of {formatCount(d.metrics.clients_90d)}</dd>
            <dt>Locations · services · clients</dt><dd>{formatCount(d.metrics.locations)} · {formatCount(d.metrics.services)} · {formatCount(d.metrics.clients)}</dd>
          </dl>
        </Card>
        <Card title="Feature switches">
          <dl className="kv">
            <dt>Zelle recorded</dt><dd>{d.switches.zelle_recorded ? 'On' : 'Off'}</dd>
            <dt>Rebooking autopilot</dt><dd>{d.switches.rebooking_autopilot ? 'On' : 'Off'}</dd>
            <dt>AI concierge</dt><dd>{d.switches.ai_concierge ? 'On' : 'Off'}</dd>
            <dt>Wallet card</dt><dd>{d.switches.wallet_card ? 'On' : 'Off'}</dd>
            <dt>Social share</dt><dd>{d.switches.social_share ? 'On' : 'Off'}</dd>
          </dl>
        </Card>
      </div>
      <div className="cols2">
        <Card title="Custom rates">
          {d.overrides.length === 0 ? <p className="muted">No custom rate. This stylist pays the plan rate.</p> : (
            <ul className="list">{d.overrides.map((o) => (
              <li key={o.starts_at}>{formatFeeBps(o.fee_bps)} from {formatDate(o.starts_at)}{o.ends_at ? ` to ${formatDate(o.ends_at)}` : ''} <span className="small muted">{o.reason}</span></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Recent support">
          {d.feedback.length === 0 ? <p className="muted">No messages from this stylist.</p> : (
            <ul className="list">{d.feedback.map((f) => (
              <li key={f.id}><Link to={`/admin/inbox?message=${f.id}`}>{f.preview}</Link> <span className="small muted">{f.type} · {formatDateTime(f.created_at)} · {f.status}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={unpublishOpen}
        title="Unpublish this public page?"
        body={<>The page at mova-beauty.co/a/{d.profile?.handle ?? '…'} stops showing to clients right away. Bookings already made are not affected. The reason is kept in the admin log.</>}
        confirmLabel="Unpublish page"
        danger
        reasonRequired
        busy={busy}
        error={actionError}
        onCancel={() => setUnpublishOpen(false)}
        onConfirm={(reason) => void unpublish(reason)}
      />
    </>
  );
}
