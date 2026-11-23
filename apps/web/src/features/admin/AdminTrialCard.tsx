import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminFunction, adminRpc, type AdminStylistTrial } from './admin-api';
import { formatDate, formatDateTime } from './admin-format';
import { Card, ConfirmDialog, Pill, type PillTone } from './AdminPrimitives';

const stateLabels: Record<string, { label: string; tone: PillTone }> = {
  eligible: { label: 'Not started', tone: 'off' }, declined: { label: 'Declined at offer', tone: 'off' },
  trialing: { label: 'In trial', tone: 'new' }, active: { label: 'Paying', tone: 'ok' }, past_due: { label: 'Payment failed', tone: 'bad' },
  ended_free: { label: 'Ended on Free', tone: 'warn' }, free: { label: 'Free', tone: 'off' }, admin: { label: 'Admin-assigned plan', tone: 'off' },
};
const planNames: Record<string, string> = { free: 'Free', pro: 'Pro', ai_growth: 'AI + Growth' };
const messageNames: Record<string, string> = {
  'trial.started': 'Trial started', 'trial.converted': 'Trial converted', 'trial.ended_free': 'Trial ended on Free',
  'trial.reminder_7d': '7-day reminder', 'trial.reminder_1d': '1-day reminder', 'billing.payment_failed': 'Payment failed',
};

/** WP8: the stylist's free trial, the messages sent about it, and the admin actions (each audit-logged with a reason). */
export function AdminTrialCard({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'extend' | 'end' | 'release' | null>(null);
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const trial = useQuery({
    queryKey: ['admin', 'stylist-trial', businessId],
    queryFn: () => adminRpc<AdminStylistTrial>('mova_admin_stylist_trial', { p_artist_business_id: businessId }),
    enabled: businessId.length > 0,
  });

  const run = async (reason: string) => {
    setBusy(true); setError(null);
    try {
      if (action === 'release') await adminRpc('mova_admin_release_trial', { p_artist_business_id: businessId, p_reason: reason });
      else await adminFunction('admin-billing', { action: action === 'extend' ? 'extend_trial' : 'end_trial', artist_business_id: businessId, reason, ...(action === 'extend' ? { days: Number(days) } : {}) });
      setNotice(action === 'extend' ? `Trial extended by ${days} days in Stripe. The change is in admin activity.`
        : action === 'end' ? 'Trial ended in Stripe. The after-trial choice applies now. The change is in admin activity.'
        : 'This stylist can start a new free trial. The change is in admin activity.');
      setAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist-trial', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'stylist-features', businessId] }),
      ]);
    } catch (failure) { setError(adminErrorText(failure)); }
    finally { setBusy(false); }
  };

  if (trial.isPending) return <Card title="Free trial"><p className="muted">Loading…</p></Card>;
  if (trial.isError || !trial.data) return <Card title="Free trial"><p className="muted">{adminErrorText(trial.error)}</p></Card>;
  const t = trial.data;
  const state = stateLabels[t.state] ?? { label: t.state, tone: 'off' as PillTone };
  const trialing = t.state === 'trialing';
  const canRelease = !t.eligible && ['ended_free', 'free', 'declined'].includes(t.state);
  const daysValid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 30;

  return <Card title="Free trial" aside={!t.enabled ? <Pill tone="off">Trial switch off</Pill> : undefined}>
    <dl className="kv">
      <dt>State</dt><dd><Pill tone={state.tone}>{state.label}</Pill></dd>
      {t.started_at && <><dt>Started</dt><dd>{formatDate(t.started_at)}</dd></>}
      {t.ends_at && <><dt>{trialing ? 'Ends' : 'Ended'}</dt><dd>{formatDate(t.ended_at ?? t.ends_at)}{trialing && t.days_left != null ? <span className="small muted"> · {t.days_left} days left</span> : null}</dd></>}
      {trialing && <><dt>After trial</dt><dd>{planNames[t.after_trial_plan ?? 'ai_growth']}</dd></>}
      {t.offered_at && !t.started_at && <><dt>Offered</dt><dd>{formatDate(t.offered_at)}{t.declined_at ? <span className="small muted"> · declined {formatDate(t.declined_at)}</span> : null}</dd></>}
      <dt>Card</dt><dd>{t.card ? `${t.card.brand ?? 'Card'} •• ${t.card.last4}` : 'None on file'}{t.card_fingerprint ? <span className="small muted"> · fingerprint {t.card_fingerprint.slice(0, 10)}…</span> : null}</dd>
      {t.past_due_since && <><dt>Payment failed</dt><dd>{formatDate(t.past_due_since)}{t.grace_ends_at ? <span className="small muted"> · cancels {formatDate(t.grace_ends_at)}</span> : null}</dd></>}
    </dl>
    <h3 className="small" style={{ marginTop: 16 }}>Messages</h3>
    {t.messages.length === 0 && t.texts.length === 0 ? <p className="muted small">No trial or billing messages yet.</p> : <ul className="list">
      {t.messages.map((m) => <li key={`${m.event_type}-${m.occurred_at}`}>{messageNames[m.event_type] ?? m.event_type} <span className="small muted">· {formatDateTime(m.occurred_at)} · {m.delivered_at ? 'sent' : 'queued'}</span></li>)}
      {t.texts.map((m) => <li key={`sms-${m.event_type}-${m.created_at}`}>Text: {messageNames[m.event_type] ?? m.event_type} <span className="small muted">· {formatDateTime(m.created_at)} · {m.status}{m.reason ? ` (${m.reason})` : ''}</span></li>)}
    </ul>}
    {notice && <p role="status" className="small">{notice}</p>}
    {(trialing || canRelease) && <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      {trialing && <button type="button" className="btn sm ghost" onClick={() => { setError(null); setAction('extend'); }}>Extend trial</button>}
      {trialing && <button type="button" className="btn sm ghost" onClick={() => { setError(null); setAction('end'); }}>End trial now</button>}
      {canRelease && <button type="button" className="btn sm ghost" onClick={() => { setError(null); setAction('release'); }}>Grant a trial again</button>}
    </div>}
    <ConfirmDialog
      open={action !== null}
      title={action === 'extend' ? 'Extend this trial?' : action === 'end' ? 'End this trial now?' : 'Grant a new free trial?'}
      body={action === 'extend'
        ? <><p>Stripe moves the trial end date. The stylist is charged on the new date unless they switch to Free.</p>
          <label className="field"><span className="lbl">Days to add (1 to 30)</span><input className="input" inputMode="numeric" value={days} onChange={(event) => setDays(event.currentTarget.value.replace(/\D/g, '').slice(0, 2))} /></label></>
        : action === 'end'
          ? <>Stripe ends the trial today. If the stylist kept a paid plan, the card on file is charged now; if they chose Free, paid features lock. Nothing is deleted.</>
          : <>This clears the one-trial-per-stylist lock for this business and its owner, so they see the trial offer again. Use it for support cases only.</>}
      confirmLabel={action === 'extend' ? 'Extend trial' : action === 'end' ? 'End trial' : 'Grant trial'}
      danger={action === 'end'}
      reasonRequired
      busy={busy || (action === 'extend' && !daysValid)}
      error={error}
      onCancel={() => setAction(null)}
      onConfirm={(reason) => void run(reason)}
    />
  </Card>;
}
