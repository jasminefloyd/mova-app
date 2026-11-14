import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type Switch } from './admin-api';
import { formatDateTime } from './admin-format';
import { Card, ErrorNote, Loading, PageHead, Pill } from './AdminPrimitives';

const labels: Record<Switch['key'], { name: string; note: string }> = {
  autopilot: { name: 'Rebooking autopilot', note: 'Sends rebooking messages to clients who are due.' },
  concierge: { name: 'AI concierge', note: 'Lets clients ask for quotes and questions in the app.' },
  seat_filler: { name: 'Seat filler', note: 'Offers open seats to nearby clients.' },
  zelle: { name: 'Zelle payments', note: 'Lets stylists record Zelle payments.' },
  reviews: { name: 'Reviews', note: 'Lets clients leave reviews after a visit.' },
  spanish: { name: 'Spanish (US)', note: 'Shows the Spanish interface to stylists who choose it.' },
  tap_to_pay: { name: 'Tap to pay', note: 'Not built yet. It cannot be turned on.' },
  marketing_email: { name: 'Marketing email', note: 'Delivery stays unavailable until the sender identity, mailing address and consent/compliance review are complete.' },
  marketing_social: { name: 'Social publishing', note: 'Delivery stays unavailable until platform app review and account publishing connections are complete.' },
  marketing_web_push: { name: 'Marketing web push', note: 'Delivery stays unavailable until VAPID, opt-in and preference controls are complete.' },
  marketing_wallet: { name: 'Wallet marketing', note: 'Only eligible Google Wallet reward notices may use this switch. Apple Wallet updates remain transactional.' },
};

export default function AdminFlagsPage() {
  const queryClient = useQueryClient();
  const switches = useQuery({ queryKey: ['admin', 'switches'], queryFn: () => adminRpc<Switch[]>('mova_admin_switches') });
  const [pending, setPending] = useState<Partial<Record<Switch['key'], boolean>>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const changes = Object.entries(pending) as [Switch['key'], boolean][];

  async function save() {
    if (changes.length === 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      for (const [key, enabled] of changes) {
        await adminRpc('mova_admin_set_platform_switch', { p_key: key, p_enabled: enabled, p_reason: reason.trim() });
      }
      setPending({}); setReason('');
      setMessage('Saved. Each change is in the admin log.');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'switches'] });
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  if (switches.isPending) return <Loading />;
  if (switches.isError || !switches.data) return <ErrorNote message={adminErrorText(switches.error)} />;
  const emergency = switches.data.filter((sw) => ['autopilot', 'concierge', 'seat_filler'].includes(sw.key));
  const product = switches.data.filter((sw) => !['autopilot', 'concierge', 'seat_filler'].includes(sw.key));

  function renderSwitches(items: Switch[]) {
    return <Card className="pad0"><ul className="list">{items.map((sw) => {
      const meta = labels[sw.key];
      const next = pending[sw.key] ?? sw.enabled;
      const blocked = sw.key === 'tap_to_pay';
      return <li key={sw.key} className="feature-row">
        <div className="feature-row__copy"><strong>{meta.name}</strong>{pending[sw.key] !== undefined ? <Pill tone="warn">Pending</Pill> : null}
          <p>{meta.note}</p><p className="small muted">{next ? 'On for everyone' : 'Off for everyone'} · Last changed {formatDateTime(sw.updated_at)}{sw.updated_by ? ` by ${sw.updated_by}` : ''}{sw.reason ? ` · ${sw.reason}` : ''}</p>
        </div>
        <button type="button" className={`sw${next ? ' on' : ''}`} role="switch" aria-checked={next} aria-label={meta.name} disabled={busy || (blocked && !next)} onClick={() => setPending((current) => {
          const copy = { ...current }; const want = !next;
          if (want === sw.enabled) delete copy[sw.key]; else copy[sw.key] = want;
          return copy;
        })}><i /></button>
      </li>;
    })}</ul></Card>;
  }

  return (
    <>
      <PageHead title="Feature switches" sub="Turn features on or off for everyone. Changes are recorded in admin activity." />
      <ErrorNote message={error} />
      {message ? <p className="notice" role="status">{message}</p> : null}
      <section className="stack"><div><h2 className="group-heading">Emergency off switches</h2><p className="sub">Features that send messages or reply for stylists. Turning one off stops it everywhere.</p></div>{renderSwitches(emergency)}</section>
      <section className="stack"><h2 className="group-heading">Product features</h2>{renderSwitches(product)}</section>
      {changes.length > 0 ? (
        <Card title={`${changes.length} pending change${changes.length === 1 ? '' : 's'}`}>
          <label className="field"><span className="lbl">Reason (kept in the admin log)</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} /></label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost sm" onClick={() => setPending({})} disabled={busy}>Undo</button>
            <button type="button" className="btn pri sm" onClick={() => void save()} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </Card>
      ) : null}
    </>
  );
}
