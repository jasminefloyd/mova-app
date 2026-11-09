import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type BlogStatusFilter } from '../admin-api';
import { formatCount, formatDateTime } from '../admin-format';
import { Card, ConfirmDialog, Empty, ErrorNote, Kpi, Loading, PageHead, Pill, Segmented, type PillTone } from '../AdminPrimitives';

type BlogRow = {
  id: string; slug: string; title: string; status: 'draft' | 'published'; live_state: 'draft' | 'scheduled' | 'published';
  published_at: string | null; updated_at: string; category: string | null; tags: string[]; missing_meta_description: boolean;
};
type BlogList = {
  posts: BlogRow[];
  filtered_total: number;
  counts: { all: number; published: number; scheduled: number; drafts: number };
  summary: { missing_meta_description: number; next_scheduled: { title: string; slug: string; published_at: string } | null };
  categories: string[];
};

const stateLabel: Record<BlogRow['live_state'], string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' };
const stateTone: Record<BlogRow['live_state'], PillTone> = { draft: 'off', scheduled: 'new', published: 'ok' };

export default function AdminBlogListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<BlogStatusFilter>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [deleting, setDeleting] = useState<BlogRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'blog-list', status, category, submitted],
    queryFn: () => adminRpc<BlogList>('mova_admin_blog_list', { p_status: status, p_category: category || null, p_search: submitted || null, p_limit: 100, p_offset: 0 }),
  });

  async function deleteDraft() {
    if (!deleting) return;
    setBusy(true); setError(null);
    try {
      await adminRpc('mova_admin_blog_delete', { p_id: deleting.id });
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'blog-list'] });
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  const d = list.data;
  const next = d?.summary.next_scheduled;

  return (
    <>
      <PageHead
        title="Guides & blog"
        sub="Written in English. Scheduled guides go live at the time you set, Eastern time."
        actions={<button type="button" className="btn pri sm" onClick={() => navigate('/admin/blog/new')}>New guide</button>}
      />
      {d ? (
        <div className="kpi-grid">
          <Kpi label="Published" value={formatCount(d.counts.published)} />
          <Kpi label="Scheduled" value={formatCount(d.counts.scheduled)} note={next ? `Next: ${next.title}, ${formatDateTime(next.published_at)}` : 'Nothing scheduled'} />
          <Kpi label="Drafts" value={formatCount(d.counts.drafts)} />
          <Kpi label="Missing a meta description" value={formatCount(d.summary.missing_meta_description)} note={d.summary.missing_meta_description > 0 ? 'Fix before publishing' : 'All set'} />
        </div>
      ) : null}
      <div className="toolbar">
        <Segmented
          label="Guide status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All', count: d?.counts.all },
            { value: 'published', label: 'Published', count: d?.counts.published },
            { value: 'scheduled', label: 'Scheduled', count: d?.counts.scheduled },
            { value: 'drafts', label: 'Drafts', count: d?.counts.drafts },
          ]}
        />
        <form className="row" onSubmit={(event) => { event.preventDefault(); setSubmitted(search.trim()); }}>
          <input className="input" type="search" aria-label="Search guides" placeholder="Search titles or tags" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(d?.categories ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="submit" className="btn sm ghost">Search</button>
        </form>
      </div>
      <ErrorNote message={list.isError ? adminErrorText(list.error) : error} />
      {list.isPending ? <Loading /> : null}
      {d && d.posts.length === 0 ? <Empty>No guides match this view. <Link to="/admin/blog/new">Start a guide</Link>.</Empty> : null}
      {d && d.posts.length > 0 ? (
        <table className="tbl">
          <thead><tr className="th"><th>Guide</th><th>Status</th><th>Category</th><th>Date</th><th /></tr></thead>
          <tbody>
            {d.posts.map((post) => (
              <tr key={post.id} className="tr">
                <td>
                  <Link to={`/admin/blog/${post.id}`}>{post.title}</Link>
                  <div className="small muted">/guides/{post.slug}{post.tags.length ? ` · ${post.tags.join(', ')}` : ''}</div>
                  {post.missing_meta_description ? <div className="small error-text">No meta description yet</div> : null}
                </td>
                <td><Pill tone={stateTone[post.live_state]}>{stateLabel[post.live_state]}</Pill></td>
                <td>{post.category ?? <span className="muted">None</span>}</td>
                <td className="small">{post.live_state === 'draft' ? `Edited ${formatDateTime(post.updated_at)}` : formatDateTime(post.published_at)}</td>
                <td>{post.live_state === 'draft' ? <button type="button" className="btn sm ghost" onClick={() => { setError(null); setDeleting(post); }}>Delete draft</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {d ? <Card className="small muted">{formatCount(d.filtered_total)} guide{d.filtered_total === 1 ? '' : 's'} in this view. Published guides cannot be deleted; unpublish them from the editor.</Card> : null}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this draft?"
        body={<>&ldquo;{deleting?.title}&rdquo; will be removed. Published guides cannot be deleted.</>}
        confirmLabel="Delete draft"
        danger
        busy={busy}
        error={error}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void deleteDraft()}
      />
    </>
  );
}
