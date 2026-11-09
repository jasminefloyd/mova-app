import { NavLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminRpc, type Health, type SupportList } from './admin-api';
import { initials } from './admin-format';
import { signOutAdmin } from './admin-session';

type NavItem = { to: string; label: string; end?: boolean; badge?: 'inbox' | 'health' };

const items: NavItem[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/stylists', label: 'Stylists' },
  { to: '/admin/inbox', label: 'Support inbox', badge: 'inbox' },
  { to: '/admin/fees', label: 'Fees' },
  { to: '/admin/blog', label: 'Guides & blog' },
  { to: '/admin/flags', label: 'Feature switches' },
  { to: '/admin/health', label: 'System health', badge: 'health' },
  { to: '/admin/activity', label: 'Admin activity' },
];

export function AdminNav({ name }: { name: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inbox = useQuery({
    queryKey: ['admin', 'nav', 'inbox'],
    queryFn: () => adminRpc<SupportList>('mova_admin_support_list', { p_status: 'new', p_search: null, p_limit: 1, p_before: null }),
    staleTime: 60_000,
  });
  const health = useQuery({
    queryKey: ['admin', 'nav', 'health'],
    queryFn: () => adminRpc<Health>('mova_admin_health'),
    staleTime: 60_000,
  });
  const newCount = inbox.data?.counts.new ?? 0;
  const needsAttention = health.data
    ? health.data.stripe_webhooks.failed_24h + health.data.texts.failed_24h + health.data.calendar.errors + health.data.jobs.stuck > 0
    : false;

  async function signOut() {
    await signOutAdmin();
    queryClient.clear();
    navigate('/admin/signin', { replace: true });
  }

  return (
    <nav className="anav" aria-label="Admin">
      <div className="anav-top">
        <NavLink to="/admin" className="anav-brand" aria-label="Mova admin home"><b>mova</b><span className="anav-badge">Admin</span></NavLink>
        <span className="anav-me" aria-label={`Signed in as ${name}`}>{initials(name)}</span>
      </div>
      <div className="anav-items">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end ?? false} className={({ isActive }) => `anav-item${isActive ? ' on' : ''}`}>
            <span>{item.label}</span>
            {item.badge === 'inbox' && newCount > 0 ? <span className="n" aria-label={`${newCount} new`}>{newCount}</span> : null}
            {item.badge === 'health' && needsAttention ? <span className="w" aria-label="Needs attention" /> : null}
          </NavLink>
        ))}
      </div>
      <div className="anav-foot">
        <span><strong>{name}</strong><br /><span className="small">Platform admin · 2-step on</span></span>
        <button type="button" className="btn sm ghost" onClick={() => void signOut()}>Sign out</button>
      </div>
    </nav>
  );
}
