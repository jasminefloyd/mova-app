import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, ConfirmDialog, ErrorNote } from './AdminPrimitives';
import { adminErrorText, adminFunction, adminRpc } from './admin-api';
import { formatDateTime } from './admin-format';

type Closure = {
  artist_business_id: string;
  display_name: string;
  business_number: number;
  source: 'stylist' | 'admin';
  state: 'scheduled' | 'archived' | 'purging' | 'review' | 'restored';
  ends_at: string | null;
  feedback_reason?: string;
  feedback?: string;
};

function loadClosures(businessId?: string) {
  return adminRpc<Closure[]>('mova_admin_account_closures', { p_business: businessId ?? null });
}

export function AdminAccountRequests() {
  const requests = useQuery({
    queryKey: ['admin', 'account-closures'],
    queryFn: () => loadClosures(),
    refetchInterval: 60_000,
  });
  if (!requests.data?.length) return null;
  return <Card title="Stylist deletion requests">
    <p className="small">{requests.data.length} {requests.data.length === 1 ? 'request needs' : 'requests need'} review.</p>
    <ul>{requests.data.map(request => <li key={request.artist_business_id}>
      <Link to={`/admin/stylists/${request.artist_business_id}`}>BID-{request.business_number} · {request.display_name}</Link>
      {' · '}{request.state === 'scheduled' ? `Access ends ${formatDateTime(request.ends_at)}` : request.state === 'purging' ? 'Deletion in progress' : request.state === 'review' ? 'Awaiting review' : 'Access disabled'}
    </li>)}</ul>
  </Card>;
}

export function AdminAccountClosure({ businessId, displayName }: { businessId: string; displayName: string }) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const request = useQuery({
    queryKey: ['admin', 'account-closures', businessId],
    queryFn: () => loadClosures(businessId),
  });
  const closure = request.data?.[0];
  const [step, setStep] = useState<'archive' | 'restore' | 'sure' | 'name' | 'forever' | null>(null);
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const begin = (value: NonNullable<typeof step>) => { setTypedName(''); setError(null); setStep(value); };
  const run = async (action: 'archive' | 'restore' | 'delete') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminFunction('privacy-management', {
        action, business_id: businessId,
        ...(action === 'delete' ? { display_name: typedName, confirm_delete_forever: true } : {}),
      });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['admin', 'account-closures'] }),
        cache.invalidateQueries({ queryKey: ['admin', 'stylists'] }),
        cache.invalidateQueries({ queryKey: ['admin', 'stylist', businessId] }),
      ]);
      setStep(null);
      if (action === 'delete') navigate('/admin/stylists', { replace: true });
      else setNotice(action === 'archive' ? 'Account archived.' : 'Account restored.');
    } catch (failure) {
      setError(adminErrorText(failure));
      void cache.invalidateQueries({ queryKey: ['admin', 'account-closures'] });
    } finally { setBusy(false); }
  };

  return <Card title="Archive or delete">
    {request.isError && <ErrorNote message={adminErrorText(request.error)} />}
    {closure?.source === 'stylist' && closure.state !== 'restored' && <p className="small">The stylist requested deletion.</p>}
    {closure?.state === 'scheduled' && <p className="small">Access ends {formatDateTime(closure.ends_at)}.</p>}
    {closure?.state === 'archived' && <p className="small">Archived. The account and its public page are unavailable.</p>}
    {closure?.state === 'purging' && <p className="small">Permanent deletion started. Retry to finish removing this account.</p>}
    {(closure?.feedback_reason || closure?.feedback) && <p className="small">Exit feedback · {closure.feedback_reason?.replaceAll('_', ' ')} {closure.feedback}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="action-grid">
      {closure?.state === 'archived'
        ? <button type="button" className="btn sm ghost" onClick={() => begin('restore')}>Restore archived account</button>
        : closure?.state !== 'purging' && <button type="button" className="btn sm ghost" disabled={!request.isSuccess} onClick={() => begin('archive')}>Archive account</button>}
      <button type="button" className="btn sm danger" disabled={!request.isSuccess} onClick={() => begin('sure')}>Permanently delete account</button>
    </div>
    <ConfirmDialog open={step !== null}
      title={step === 'archive' ? 'Archive this account?' : step === 'restore' ? 'Restore this account?' : step === 'name' ? 'Type the stylist’s full display name' : step === 'forever' ? 'Delete this account forever?' : 'Are you sure?'}
      body={step === 'archive' ? <p>{displayName} will lose access immediately and their public page will go offline. Their records stay available for an admin to restore. Subscriptions stop renewing.</p>
        : step === 'restore' ? <p>Restore {displayName}’s saved records and previous publication state. A canceled subscription will stay canceled.</p>
        : step === 'name' ? <label className="field"><span>Type <strong>{displayName}</strong> exactly</span>
          <input aria-label="Stylist display name" className="input" value={typedName} onChange={event => { setTypedName(event.target.value); setError(null); }} autoComplete="off" required />
        </label>
        : step === 'forever' ? <p>This permanently erases {displayName}’s account, clients, appointments, portfolio, and Mova records. Their public page will be removed and any remaining subscription will be canceled. This cannot be undone.</p>
        : <p>You’re about to permanently delete {displayName}’s account.</p>}
      confirmLabel={step === 'forever' ? 'Delete forever' : step === 'archive' ? 'Archive account' : step === 'restore' ? 'Restore account' : 'Continue'}
      cancelLabel={step === 'forever' ? 'Nevermind' : 'Cancel'}
      danger={step !== 'restore'} busy={busy} error={error}
      onCancel={() => { if (!busy) setStep(null); }}
      onConfirm={() => {
        if (step === 'sure') setStep('name');
        if (step === 'name') {
          if (typedName === displayName) setStep('forever');
          else setError('The name must match the stylist’s display name exactly.');
        }
        if (step === 'forever') void run('delete');
        if (step === 'archive' || step === 'restore') void run(step);
      }}
    />
  </Card>;
}
