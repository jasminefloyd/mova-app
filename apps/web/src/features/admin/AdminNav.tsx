import { NavLink, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminRpc, type Health, type SupportList } from './admin-api';
import { initials } from './admin-format';
import { signOutAdmin } from './admin-session';

type NavIcon = 'overview' | 'stylists' | 'inbox' | 'fees' | 'blog' | 'flags' | 'health' | 'logs' | 'activity';
type NavItem = { to: string; label: string; icon: NavIcon; end?: boolean; badge?: 'inbox' | 'health' };

// A0: line icons from the board's set, drawn in currentColor so they follow the nav's light/dark states.
const paths: Record<NavIcon, string> = {
  overview: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  stylists: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z',
  fees: 'M19 5 5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  blog: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  flags: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7M16 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  health: 'M3 12h4l3-8 4 16 3-8h4',
  logs: 'M4 5h16v14H4zM8 10l2 2-2 2M12 14h4',
  activity: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
};
function NavGlyph({ name }: { name: NavIcon }) {
  return <svg className="anav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const items: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'overview', end: true },
  { to: '/admin/stylists', label: 'Stylists', icon: 'stylists' },
  { to: '/admin/inbox', label: 'Support inbox', icon: 'inbox', badge: 'inbox' },
  { to: '/admin/fees', label: 'Fees', icon: 'fees' },
  { to: '/admin/blog', label: 'Guides & blog', icon: 'blog' },
  { to: '/admin/flags', label: 'Feature switches', icon: 'flags' },
  { to: '/admin/health', label: 'System health', icon: 'health', badge: 'health' },
  { to: '/admin/logs', label: 'System logs', icon: 'logs' },
  { to: '/admin/activity', label: 'Admin activity', icon: 'activity' },
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
            <NavGlyph name={item.icon} /><span>{item.label}</span>
            {item.badge === 'inbox' && newCount > 0 ? <span className="n" aria-label={`${newCount} new`}>{newCount}</span> : null}
            {item.badge === 'health' && needsAttention ? <span className="w" aria-label="Needs attention" /> : null}
          </NavLink>
        ))}
      </div>
      <div className="anav-foot">
        <span><strong>{name}</strong><br /><span className="small">Super admin · 2-step on</span></span>
        <button type="button" className="btn sm ghost" onClick={() => void signOut()}>Sign out</button>
      </div>
    </nav>
  );
}
