import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, isAdminError, type AuditPage, type StylistDetail, type StylistFeatureControls, type StylistRuntimeSwitches } from './admin-api';
import { formatCount, formatDate, formatDateTime, formatFeeBps, formatMoneyMinor, formatPercent, initials } from './admin-format';
import { Card, ConfirmDialog, ErrorNote, Kpi, Loading, Pill } from './AdminPrimitives';
import { AdminAccountClosure } from './AdminAccountClosure';
import { AdminTrialCard } from './AdminTrialCard';

const featureLabels: Record<string, { name: string; note: string }> = {
  booking_page: { name: 'Booking page', note: 'Public stylist page and booking entry point.' },
  calendar_multi_location: { name: 'Multi-location calendar', note: 'Manage availability across locations.' },
  unlimited_clients: { name: 'Unlimited clients', note: 'Client list capacity.' },
  unlimited_bookings: { name: 'Unlimited bookings', note: 'Booking capacity.' },
  unlimited_locations: { name: 'Multiple locations', note: 'Create and book at multiple work locations.' },
  client_notes_photos: { name: 'Client notes and photos', note: 'Private client history and reference photos.' },
  guest_booking: { name: 'Guest booking', note: 'Let clients book without creating an account.' },
  payments_deposits_links: { name: 'Payments, deposits and links', note: 'Collect deposits and send payment links.' },
  booking_emails: { name: 'Booking emails', note: 'Transactional booking email access.' },
  bilingual_en_es: { name: 'English and Spanish', note: 'Bilingual stylist and client experiences.' },
  reports_basic: { name: 'Basic reports', note: 'Reports and business activity summaries.' },
  reviews_private: { name: 'Private reviews', note: 'Collect private client feedback.' },
  reviews_public: { name: 'Public reviews', note: 'Publish eligible client reviews.' },
  reports_advanced: { name: 'Advanced reports', note: 'Advanced analytics and reporting.' },
  seat_filler: { name: 'Seat filler', note: 'Offer newly opened appointment slots.' },
  text_autopilot: { name: 'Text autopilot', note: 'Automated stylist-approved client messages.' },
  text_reminders: { name: 'Appointment text reminders', note: 'Transactional appointment text messages.' },
  rebooking_assist: { name: 'Rebooking assist', note: 'Tools to identify and contact clients who are due.' },
  google_calendar_sync: { name: 'Google Calendar sync', note: 'Connect and sync stylist calendar events.' },
  custom_cover: { name: 'Custom profile cover', note: 'Choose a custom cover photo.' },
  custom_handle: { name: 'Custom profile link', note: 'Set a custom public profile handle.' },
  rebooking_autopilot: { name: 'Rebooking autopilot', note: 'Automated rebooking reminders; stylist settings and global pause still apply.' },
  concierge: { name: 'AI Concierge', note: 'AI-assisted replies; stylist consent/settings and global pause still apply.' },
  concierge_instagram: { name: 'Instagram Concierge', note: 'Handle eligible Instagram messages.' },
  wallet_client_card: { name: 'Client wallet card', note: 'Offer a stylist card in supported digital wallets.' },
  reports_ai_revenue: { name: 'AI Revenue reports', note: 'AI-assisted revenue and forecasting tools.' },
  missed_call_textback: { name: 'Missed-call text back', note: 'Send an approved reply after missed calls.' },
  ai_price_pilot: { name: 'PricePilot', note: 'Local pricing research and recommendations.' },
  marketing_email: { name: 'Marketing email', note: 'Create and send email campaigns.' },
  marketing_social: { name: 'Social publishing', note: 'Create social campaigns and publish to connected accounts.' },
  marketing_web_push: { name: 'Web push campaigns', note: 'Send eligible push campaigns to opted-in clients.' },
  marketing_wallet: { name: 'Wallet notifications', note: 'Send eligible Google Wallet campaign updates.' },
};

const runtimeSwitchLabels: Record<keyof StylistRuntimeSwitches, { name: string; note: string }> = {
  zelle_recorded: { name: 'Zelle recorded', note: 'Allow recording Zelle as a payment method.' },
  rebooking_autopilot: { name: 'Rebooking autopilot', note: 'Stylist preference for automated rebooking reminders.' },
  seat_filler_autopilot: { name: 'Seat filler messages', note: 'Stylist preference for messages when an appointment opens.' },
  review_requests: { name: 'Ask for reviews', note: 'Stylist preference for review requests after visits.' },
  google_review_import: { name: 'Google review import', note: 'Show imported Google reviews in the reputation tools.' },
  ai_concierge: { name: 'AI Concierge', note: 'Stylist preference for AI-assisted client replies.' },
  wallet_card: { name: 'Client wallet card', note: 'Offer the stylist’s saved card in supported wallets.' },
  social_share: { name: 'Social sharing', note: 'Enable social sharing tools for this stylist.' },
};

export default function AdminStylistDetailPage() {
  const { businessId = '' } = useParams();
  const queryClient = useQueryClient();
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [suspensionOpen, setSuspensionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [featureToChange, setFeatureToChange] = useState<{ key: string; enabled: boolean } | null>(null);
  const [runtimeSwitchToChange, setRuntimeSwitchToChange] = useState<{ key: keyof StylistRuntimeSwitches; enabled: boolean } | null>(null);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [featureControlsBusy, setFeatureControlsBusy] = useState(false);
  const detail = useQuery({
    queryKey: ['admin', 'stylist', businessId],
    queryFn: () => adminRpc<StylistDetail>('mova_admin_stylist_detail', { p_business_id: businessId }),
    enabled: businessId.length > 0,
  });
  const featureControls = useQuery({
    queryKey: ['admin', 'stylist-features', businessId],
    queryFn: () => adminRpc<StylistFeatureControls>('mova_admin_stylist_feature_controls', { p_artist_business_id: businessId }),
    enabled: businessId.length > 0,
  });
  const recent = useQuery({
    queryKey: ['admin', 'stylist-recent', businessId],
    queryFn: () => adminRpc<AuditPage>('mova_admin_audit_events', { p_business_id: businessId, p_from: null, p_to: null, p_category: null, p_search: null, p_limit: 5, p_before: null }),
    enabled: businessId.length > 0,
  });
  const runtimeSwitches = useQuery({
    queryKey: ['admin', 'stylist-runtime-switches', businessId],
    queryFn: () => adminRpc<StylistRuntimeSwitches>('mova_admin_stylist_runtime_switches', { p_artist_business_id: businessId }),
    enabled: businessId.length > 0,
  });

  async function saveFeatureOverride(reason: string) {
    if (!featureToChange) return;
    setFeatureControlsBusy(true); setActionError(null);
    try {
      await adminRpc('mova_admin_set_stylist_feature', {
        p_artist_business_id: businessId, p_feature_key: featureToChange.key, p_enabled: featureToChange.enabled, p_reason: reason,
      });
      setFeatureToChange(null);
      setNotice(`${featureLabels[featureToChange.key]?.name ?? featureToChange.key} access updated. The change is in admin activity.`);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'stylist-features', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] });
    } catch (error) {
      setActionError(adminErrorText(error));
      if (isAdminError(error, 'PLATFORM_ADMIN_REQUIRED')) setFeatureToChange(null);
    } finally { setFeatureControlsBusy(false); }
  }

  async function saveRuntimeSwitch(reason: string) {
    if (!runtimeSwitchToChange) return;
    setFeatureControlsBusy(true); setActionError(null);
    try {
      await adminRpc('mova_admin_set_stylist_runtime_switch', {
        p_artist_business_id: businessId, p_switch_key: runtimeSwitchToChange.key, p_enabled: runtimeSwitchToChange.enabled, p_reason: reason,
      });
      setRuntimeSwitchToChange(null);
      setNotice(`${runtimeSwitchLabels[runtimeSwitchToChange.key].name} updated for this stylist. The change is in admin activity.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist-runtime-switches', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] }),
      ]);
    } catch (error) {
      setActionError(adminErrorText(error));
      if (isAdminError(error, 'PLATFORM_ADMIN_REQUIRED')) setRuntimeSwitchToChange(null);
    } finally { setFeatureControlsBusy(false); }
  }

  async function savePlan(reason: string) {
    if (!selectedPlan) return;
    if (selectedPlan === featureControls.data?.current_plan.plan_key) {
      setPlanEditorOpen(false);
      setNotice('The plan is unchanged. Existing feature overrides remain in effect.');
      return;
    }
    setFeatureControlsBusy(true); setActionError(null);
    try {
      await adminRpc('mova_admin_set_stylist_plan', { p_artist_business_id: businessId, p_plan_key: selectedPlan, p_reason: reason });
      setPlanEditorOpen(false);
      setNotice('Plan updated. Feature access now follows the new tier; previous individual feature overrides were cleared.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist-features', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylists'] }),
      ]);
    } catch (error) {
      setActionError(adminErrorText(error));
      if (isAdminError(error, 'PLATFORM_ADMIN_REQUIRED')) setPlanEditorOpen(false);
    } finally { setFeatureControlsBusy(false); }
  }

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

  async function setSuspension(reason: string) {
    const suspended = detail.data?.business.status !== 'suspended';
    setBusy(true);
    setActionError(null);
    try {
      await adminRpc('mova_admin_set_stylist_suspension', { p_artist_business_id: businessId, p_suspended: suspended, p_reason: reason });
      setSuspensionOpen(false);
      setNotice(suspended ? 'Stylist access suspended.' : 'Stylist access restored.');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'stylists'] });
    } catch (error) {
      setActionError(adminErrorText(error));
      if (isAdminError(error, 'PLATFORM_ADMIN_REQUIRED')) setSuspensionOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (detail.isPending) return <Loading />;
  if (detail.isError || !detail.data) return <ErrorNote message={adminErrorText(detail.error)} />;
  const d = detail.data;

  const displayName = d.profile?.display_name ?? d.business.name;
  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/admin/stylists">Stylists</Link><span aria-hidden="true">›</span><span aria-current="page">BID-{d.business.bid}</span></nav>
      <header className="head stylist-head">
        <div className="stylist-head__id">
          <span className="stylist-avatar" aria-hidden="true">{initials(displayName)}</span>
          <div>
            <h1 className="h1">{displayName} <Pill tone={d.business.status === 'active' ? 'ok' : 'bad'}>{d.business.status}</Pill></h1>
            <p className="sub">{d.business.name} · BID-{d.business.bid} · {d.owner_email ?? 'No owner email on file'}{d.business.created_at ? ` · joined ${formatDate(d.business.created_at)}` : ''}</p>
          </div>
        </div>
        <div className="row">
          {d.profile?.handle ? <a className="btn sm" href={`https://mova-beauty.co/a/${encodeURIComponent(d.profile.handle)}`} target="_blank" rel="noreferrer">View public page ↗</a> : null}
          <Link className="btn sm" to={`/admin/stylists/${businessId}/audit`}>Audit log</Link>
          <Link className="btn sm ghost" to={`/admin/logs?stylist=${businessId}`}>System logs</Link>
        </div>
      </header>
      <ErrorNote message={actionError} />
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      <div className="k4">
        <Kpi label="Completed (30d)" value={formatCount(d.metrics.completed_30d)} />
        <Kpi label="Processed by Mova" value={formatMoneyMinor(d.metrics.processed_30d_minor)} />
        <Kpi label="Mova fees" value={formatMoneyMinor(d.metrics.fees_30d_minor)} />
        <Kpi label="Repeat clients (90d)" value={formatPercent(d.metrics.repeat_clients_90d, d.metrics.clients_90d)} />
      </div>
      <div className="detail-grid">
        <div className="stack">
          <Card title="Recent activity" aside={<Link className="link-sm" to={`/admin/stylists/${businessId}/audit`}>Open full audit log</Link>}>
            {recent.isPending ? <p className="muted">Loading…</p> : !recent.data || recent.data.events.length === 0 ? <p className="muted">No activity yet.</p> : (
              <ul className="activity-list">{recent.data.events.slice(0, 5).map((event) => (
                <li key={`${event.occurred_at}-${event.reference}-${event.event}`}><span className="small muted">{formatDateTime(event.occurred_at)}</span><span>{event.summary}{event.reference ? ` · ${event.reference}` : ''}</span><Pill tone="off">{event.actor}</Pill></li>
              ))}</ul>
            )}
          </Card>
          <Card title={`Feedback from ${firstName}`} aside={<Link className="link-sm" to="/admin/inbox">Support inbox</Link>}>
            {d.feedback.length === 0 ? <p className="muted">No messages from this stylist.</p> : (
              <ul className="activity-list">{d.feedback.map((f) => (
                <li key={f.id}><span><Link to={`/admin/inbox?message=${f.id}`}><strong>{f.type.charAt(0).toUpperCase() + f.type.slice(1)} · {f.preview}</strong></Link><br /><span className="small muted">{formatDateTime(f.created_at)}</span></span><Pill tone={f.status === 'new' ? 'new' : 'off'}>{f.status.replace(/_/g, ' ')}</Pill></li>
              ))}</ul>
            )}
          </Card>
          <Card title="Last 30 days">
            <dl className="kv">
              <dt>Completed</dt><dd>{formatCount(d.metrics.completed_30d)}</dd>
              <dt>Processed</dt><dd>{formatMoneyMinor(d.metrics.processed_30d_minor)}</dd>
              <dt>Mova fees</dt><dd>{formatMoneyMinor(d.metrics.fees_30d_minor)}</dd>
              <dt>Repeat clients (90 days)</dt><dd>{formatPercent(d.metrics.repeat_clients_90d, d.metrics.clients_90d)} of {formatCount(d.metrics.clients_90d)}</dd>
            </dl>
          </Card>
        </div>
        <div className="stack">
          <Card title="Account">
            <dl className="kv">
              <dt>Plan</dt><dd>{d.plan.name}</dd>
              <dt>Language</dt><dd>{d.profile?.preferred_locale === 'es-US' ? 'Spanish' : 'English'}</dd>
              <dt>Locations</dt><dd>{formatCount(d.metrics.locations)}</dd>
              <dt>Services</dt><dd>{formatCount(d.metrics.services)}</dd>
              <dt>Clients</dt><dd>{formatCount(d.metrics.clients)}</dd>
              <dt>Page</dt><dd>{d.profile ? <>{d.profile.handle ? `mova-beauty.co/a/${d.profile.handle}` : '—'} {d.profile.is_published ? <Pill tone="ok">Published</Pill> : <Pill tone="off">Not published</Pill>}</> : 'No page yet'}</dd>
            </dl>
          </Card>
          <Card title="Payments">
            <dl className="kv">
              <dt>Stripe</dt><dd>{d.stripe ? <Pill tone={d.stripe.status === 'active' ? 'ok' : 'warn'}>{d.stripe.status}</Pill> : 'Not connected'}</dd>
              {d.stripe ? <><dt>Charges</dt><dd>{d.stripe.charges_enabled ? 'On' : 'Off'}</dd><dt>Payouts</dt><dd>{d.stripe.payouts_enabled ? 'On' : 'Off'}</dd></> : null}
              <dt>Mova fee</dt><dd>{formatFeeBps(d.fee.fee_bps)} · {d.fee.source === 'override' ? 'custom rate' : d.fee.source === 'plan' ? 'plan rate' : 'platform default'}</dd>
              {d.overrides.map((o) => <Fragment key={o.starts_at}><dt>Custom rate</dt><dd>{formatFeeBps(o.fee_bps)} from {formatDate(o.starts_at)}{o.ends_at ? ` to ${formatDate(o.ends_at)}` : ''}</dd></Fragment>)}
            </dl>
            <Link className="btn sm wide" to={`/admin/fees?stylist=${businessId}`}>Change fee for {firstName}</Link>
          </Card>
          <AdminTrialCard businessId={businessId} />
          <AdminAccountClosure businessId={businessId} displayName={displayName} />
          <Card title="Account actions">
            <p className="small muted">Each action asks for a reason and is logged.</p>
            <div className="action-grid">
              <button type="button" className="btn sm danger" onClick={() => setUnpublishOpen(true)} disabled={!d.profile?.is_published}>Unpublish page</button>
              <button type="button" className="btn sm danger" onClick={() => setSuspensionOpen(true)}>{d.business.status === 'suspended' ? 'Lift suspension' : 'Suspend access'}</button>
            </div>
          </Card>
        </div>
      </div>
      <section className="stack">
        <div><h2 className="group-heading">Feature access</h2><p className="sub">Plan access follows the assigned tier automatically. You can override any individual feature for this stylist, including a temporary grant outside their tier. A plan change clears overrides and returns features to the new tier’s defaults. Stylist opt-in, provider readiness, consent and global emergency switches still apply.</p></div>
        {featureControls.isPending ? <Loading label="Loading feature access" /> : featureControls.isError || !featureControls.data ? <ErrorNote message={adminErrorText(featureControls.error)} /> : <>
          <Card title={`Plan features · ${featureControls.data.current_plan.display_name}`} aside={<button type="button" className="btn sm ghost" onClick={() => { setSelectedPlan(featureControls.data!.current_plan.plan_key); setPlanEditorOpen(true); }}>Change plan</button>} className="pad0">
            <ul className="list">{featureControls.data.features.map((feature) => {
              const meta = featureLabels[feature.feature_key] ?? { name: feature.feature_key, note: 'Plan-controlled feature.' };
              return <li key={feature.feature_key} className="feature-row">
                <div className="feature-row__copy"><strong>{meta.name}</strong>{feature.override_enabled === false ? <Pill tone="warn">Admin off</Pill> : feature.override_enabled === true ? <Pill tone="new">Admin on</Pill> : feature.plan_enabled ? <Pill tone="ok">Plan default</Pill> : <Pill tone="off">Not in plan</Pill>}
                  <p>{meta.note}</p>
                  <p className="small muted">{feature.enabled ? 'Access enabled' : feature.plan_enabled ? 'Access disabled by admin' : 'Upgrade required'}{feature.override_enabled === true && !feature.plan_enabled ? ' · enabled by admin outside plan' : ''}{feature.reason ? ` · ${feature.reason}` : ''}{feature.updated_by ? ` · ${feature.updated_by}` : ''}</p>
                </div>
                <button type="button" className={`sw${feature.enabled ? ' on' : ''}`} role="switch" aria-checked={feature.enabled} aria-label={meta.name} disabled={featureControlsBusy} onClick={() => setFeatureToChange({ key: feature.feature_key, enabled: !feature.enabled })}><i /></button>
              </li>;
            })}</ul>
          </Card>
          <Card title="Stylist feature settings" className="pad0">
            {runtimeSwitches.isPending ? <p className="muted" style={{ padding: 16 }}>Loading stylist settings…</p> : runtimeSwitches.isError || !runtimeSwitches.data ? <div style={{ padding: 16 }}><ErrorNote message={adminErrorText(runtimeSwitches.error)} /></div> : <ul className="list">{(Object.keys(runtimeSwitchLabels) as (keyof StylistRuntimeSwitches)[]).map((key) => {
              const meta = runtimeSwitchLabels[key]; const enabled = runtimeSwitches.data[key];
              return <li key={key} className="feature-row"><div className="feature-row__copy"><strong>{meta.name}</strong><p>{meta.note}</p><p className="small muted">{enabled ? 'On for this stylist' : 'Off for this stylist'}</p></div><button type="button" className={`sw${enabled ? ' on' : ''}`} role="switch" aria-checked={enabled} aria-label={meta.name} disabled={featureControlsBusy} onClick={() => setRuntimeSwitchToChange({ key, enabled: !enabled })}><i /></button></li>;
            })}</ul>}
            <p className="small muted" style={{ padding: '0 16px 14px' }}>These switches set stylist-level preferences. Subscription entitlements, provider readiness, client consent and global emergency switches remain in force.</p>
          </Card>
        </>}
      </section>
      <ConfirmDialog
        open={suspensionOpen}
        title={d.business.status === 'suspended' ? 'Restore this stylist?' : 'Suspend this stylist?'}
        body={d.business.status === 'suspended'
          ? <>The stylist can use their account again. Their data and public page settings are retained. The reason is kept in the admin log.</>
          : <>The stylist will lose access to their business data until restored. Their data is retained. The reason is kept in the admin log.</>}
        confirmLabel={d.business.status === 'suspended' ? 'Restore stylist' : 'Suspend stylist'}
        danger={d.business.status !== 'suspended'}
        reasonRequired
        busy={busy}
        error={actionError}
        onCancel={() => setSuspensionOpen(false)}
        onConfirm={(reason) => void setSuspension(reason)}
      />
      <ConfirmDialog
        open={featureToChange !== null}
        title={`${featureToChange?.enabled ? 'Enable' : 'Disable'} ${featureLabels[featureToChange?.key ?? '']?.name ?? 'feature'} access?`}
        body={<>This changes this stylist’s individual feature override and is recorded in admin activity. An admin override can grant a feature outside the assigned tier. Changing the plan later clears individual overrides and restores the new tier’s defaults. Global emergency switches and other runtime requirements still apply.</>}
        confirmLabel={featureToChange?.enabled ? 'Enable access' : 'Disable access'}
        reasonRequired
        busy={featureControlsBusy}
        error={actionError}
        onCancel={() => setFeatureToChange(null)}
        onConfirm={(reason) => void saveFeatureOverride(reason)}
      />
      <ConfirmDialog
        open={runtimeSwitchToChange !== null}
        title={`${runtimeSwitchToChange?.enabled ? 'Turn on' : 'Turn off'} ${runtimeSwitchToChange ? runtimeSwitchLabels[runtimeSwitchToChange.key].name : 'stylist setting'}?`}
        body={<>This changes the stylist-level setting used by the product. It is recorded in admin activity. Plan access and system-wide emergency controls still apply.</>}
        confirmLabel={runtimeSwitchToChange?.enabled ? 'Turn on' : 'Turn off'}
        reasonRequired
        busy={featureControlsBusy}
        error={actionError}
        onCancel={() => setRuntimeSwitchToChange(null)}
        onConfirm={(reason) => void saveRuntimeSwitch(reason)}
      />
      <ConfirmDialog
        open={planEditorOpen}
        title="Change stylist plan?"
        body={<label className="field"><span className="lbl">New plan</span><select className="input" value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)}>{(featureControls.data?.plans ?? []).map((plan) => <option key={plan.plan_key} value={plan.plan_key}>{plan.display_name} · ${(plan.monthly_price_minor / 100).toFixed(0)}/month</option>)}</select><span className="small muted">Feature access will follow this plan. Existing individual feature overrides will be cleared.</span></label>}
        confirmLabel="Change plan"
        reasonRequired
        busy={featureControlsBusy}
        error={actionError}
        onCancel={() => setPlanEditorOpen(false)}
        onConfirm={(reason) => void savePlan(reason)}
      />
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
