import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc } from '../admin-api';
import { dayInZone, formatDateTime } from '../admin-format';
import { Card, ConfirmDialog, ErrorNote, Loading, PageHead, Pill } from '../AdminPrimitives';
import { AddBlockMenu, BlockField, BlockPreview } from './BlockEditor';
import {
  bodyProblems, CATEGORIES, draftErrors, draftFromRecord, draftPayload, emptyDraft, hasErrors, moveBlock, newBlock, parseTags,
  PUBLISH_TIME_ZONE, readingMinutes, removeBlock, seoChecks, slugify, zonedWallTimeToInstant, type Block, type BlockType, type BlogDraft,
  type DraftFieldErrors, type SaveMode,
} from './blog-model';

type Record_ = { post: Record<string, unknown>; categories: string[] };
const AUTHOR_DEFAULT = 'Mova team';

export default function AdminBlogEditorPage() {
  const { postId = 'new' } = useParams();
  const isNew = postId === 'new';
  const record = useQuery({
    queryKey: ['admin', 'blog', postId],
    queryFn: () => adminRpc<Record_>('mova_admin_blog_get', { p_id: postId }),
    enabled: !isNew,
    retry: false,
  });

  if (!isNew && record.isPending) return <Loading label="Loading guide" />;
  if (!isNew && (record.isError || !record.data)) return <ErrorNote message={adminErrorText(record.error)} />;
  const data = record.data;
  const initial = data ? draftFromRecord(data.post) : emptyDraft(AUTHOR_DEFAULT);
  const categories = data?.categories ?? [...CATEGORIES];
  return <BlogEditor key={postId} initial={initial} categories={categories} />;
}

function BlogEditor({ initial, categories }: { initial: BlogDraft; categories: string[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<BlogDraft>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(', '));
  const [scheduleDate, setScheduleDate] = useState(dayInZone(new Date(), PUBLISH_TIME_ZONE, 1));
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [errors, setErrors] = useState<DraftFieldErrors>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(() => {
    const flash = (location.state as { flash?: string } | null)?.flash;
    return flash ? { kind: 'ok', text: flash } : null;
  });
  const [busy, setBusy] = useState<SaveMode | 'unpublish' | 'delete' | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSaved = draft.id !== null;
  const problems = new Map(bodyProblems(draft.body).map((p) => [p.index, p.message]));
  const checks = seoChecks(draft);

  function set<K extends keyof BlogDraft>(key: K, value: BlogDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setBlock(index: number, next: Block) {
    set('body', draft.body.map((block, i) => (i === index ? next : block)));
  }

  /** Applies a record the database sent back, after a save, unpublish or refresh. */
  function applyRecord(post: Record<string, unknown>) {
    const saved = draftFromRecord(post);
    setDraft(saved);
    setTagsText(saved.tags.join(', '));
    if (saved.id) queryClient.setQueryData(['admin', 'blog', saved.id], { post, categories });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'blog-list'] });
    return saved;
  }

  async function save(mode: SaveMode) {
    setBanner(null);
    const parsed = parseTags(tagsText);
    const next: BlogDraft = { ...draft, tags: parsed.tags };
    const publishAt = mode === 'schedule' ? zonedWallTimeToInstant(scheduleDate, scheduleTime, PUBLISH_TIME_ZONE) : null;
    const found = draftErrors(next, mode, publishAt, new Date());
    if (parsed.error) found.tags = 'Use up to 6 tags, letters, numbers, spaces or hyphens.';
    setErrors(found);
    if (hasErrors(found)) {
      setBanner({ kind: 'error', text: 'Fix the highlighted fields, then try again.' });
      return;
    }
    setBusy(mode);
    try {
      const post = await adminRpc<Record<string, unknown>>('mova_admin_blog_save', {
        p_id: draft.id,
        p_fields: draftPayload(next),
        p_mode: mode,
        p_publish_at: publishAt ? publishAt.toISOString() : null,
      });
      const saved = draftFromRecord(post);
      const text = mode === 'draft'
        ? 'Draft saved.'
        : mode === 'schedule'
          ? `Scheduled for ${formatDateTime(publishAt?.toISOString())} Eastern.`
          : 'Published. The guide is live now.';
      if (!isSaved && saved.id) {
        queryClient.setQueryData(['admin', 'blog', saved.id], { post, categories });
        void queryClient.invalidateQueries({ queryKey: ['admin', 'blog-list'] });
        navigate(`/admin/blog/${saved.id}`, { replace: true, state: { flash: text } });
      } else {
        applyRecord(post);
        setBanner({ kind: 'ok', text });
      }
    } catch (error) {
      setBanner({ kind: 'error', text: adminErrorText(error) });
    } finally {
      setBusy(null);
    }
  }

  async function unpublish() {
    if (!draft.id) return;
    setBusy('unpublish');
    setBanner(null);
    try {
      applyRecord(await adminRpc<Record<string, unknown>>('mova_admin_blog_unpublish', { p_id: draft.id }));
      setBanner({ kind: 'ok', text: 'Unpublished. It is a draft again.' });
    } catch (error) {
      setBanner({ kind: 'error', text: adminErrorText(error) });
    } finally {
      setBusy(null);
    }
  }

  async function deleteDraft() {
    if (!draft.id) return;
    setBusy('delete');
    try {
      await adminRpc('mova_admin_blog_delete', { p_id: draft.id });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'blog-list'] });
      navigate('/admin/blog', { replace: true });
    } catch (error) {
      setBanner({ kind: 'error', text: adminErrorText(error) });
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  }

  const isPublished = draft.liveState === 'published';
  const isScheduled = draft.liveState === 'scheduled';
  const field = (label: string, key: keyof DraftFieldErrors, input: ReactNode) => (
    <label className="field">
      <span className="lbl">{label}</span>
      {input}
      {errors[key] ? <span className="error-text" role="alert">{errors[key]}</span> : null}
    </label>
  );

  return (
    <>
      <PageHead
        title={draft.title.trim() || 'New guide'}
        sub={<>
          <Pill tone={isPublished ? 'ok' : isScheduled ? 'new' : 'off'}>{isPublished ? 'Published' : isScheduled ? 'Scheduled' : 'Draft'}</Pill>
          {draft.publishedAt ? <span className="small muted"> {isScheduled ? 'Goes live' : 'Published'} {formatDateTime(draft.publishedAt)} Eastern</span> : null}
        </>}
        actions={<>
          <button type="button" className="btn sm ghost" onClick={() => setShowPreview((v) => !v)} aria-pressed={showPreview}>{showPreview ? 'Edit' : 'Preview'}</button>
          {isSaved ? (isPublished || isScheduled ? <button type="button" className="btn sm ghost" disabled={busy !== null} onClick={() => void unpublish()}>Unpublish</button> : null) : null}
          <button type="button" className="btn sm ghost" disabled={busy !== null} onClick={() => void save('draft')}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
        </>}
      />
      {banner ? <p className={banner.kind === 'ok' ? 'notice' : 'error-text'} role={banner.kind === 'ok' ? 'status' : 'alert'}>{banner.text}</p> : null}

      {showPreview ? (
        <Card title={draft.title}>
          <p className="sub">{draft.summary}</p>
          <BlockPreview blocks={draft.body} />
        </Card>
      ) : (
        <div className="editor-cols">
          <div className="stack">
            <Card title="Guide">
              {field('Title', 'title', <input className="input" value={draft.title} maxLength={140} onChange={(e) => set('title', e.target.value)} />)}
              {field('Web address (slug)', 'slug', <div className="row"><input className="input" value={draft.slug} maxLength={120} onChange={(e) => set('slug', e.target.value)} /><button type="button" className="btn sm ghost" onClick={() => set('slug', slugify(draft.title))}>From title</button></div>)}
              {field(`Summary (${draft.summary.length}/240)`, 'summary', <textarea className="input" rows={3} maxLength={240} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />)}
              <div className="row">
                {field('Category', 'category', <select className="select" value={draft.category ?? ''} onChange={(e) => set('category', e.target.value || null)}>
                  <option value="">Choose a category</option>
                  {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>)}
                {field('Author', 'authorName', <input className="input" value={draft.authorName} maxLength={120} onChange={(e) => set('authorName', e.target.value)} />)}
              </div>
              {field('Tags (up to 6, comma separated)', 'tags', <input className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />)}
              <p className="small muted">About {readingMinutes(draft.body)} min read. Calculated from the text in the body.</p>
            </Card>

            <Card title="Cover image">
              {field('Image link (https://)', 'coverUrl', <input className="input" value={draft.coverUrl} onChange={(e) => set('coverUrl', e.target.value)} />)}
              {field('Alt text', 'coverAlt', <input className="input" value={draft.coverAlt} maxLength={240} onChange={(e) => set('coverAlt', e.target.value)} />)}
              {field('Credit (optional)', 'coverAlt', <input className="input" value={draft.coverCredit} maxLength={200} onChange={(e) => set('coverCredit', e.target.value)} />)}
            </Card>

            <Card title="Body">
              {draft.body.length === 0 ? <p className="muted">No blocks yet. Add a heading or paragraph to start.</p> : null}
              {draft.body.map((block, index) => (
                <div key={index} className="blk-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <BlockField block={block} index={index} problem={problems.get(index)} onChange={(next) => setBlock(index, next)} />
                  </div>
                  <div className="stack">
                    <button type="button" className="btn sm ghost" aria-label="Move block up" disabled={index === 0} onClick={() => set('body', moveBlock(draft.body, index, -1))}>Up</button>
                    <button type="button" className="btn sm ghost" aria-label="Move block down" disabled={index === draft.body.length - 1} onClick={() => set('body', moveBlock(draft.body, index, 1))}>Down</button>
                    <button type="button" className="btn sm ghost" aria-label="Remove block" onClick={() => set('body', removeBlock(draft.body, index))}>Remove</button>
                  </div>
                </div>
              ))}
              {errors.body ? <p className="error-text" role="alert">{errors.body}</p> : null}
              <AddBlockMenu onAdd={(type: BlockType) => set('body', [...draft.body, newBlock(type)])} />
            </Card>
          </div>

          <div className="stack">
            <Card title="Publish">
              <p className="small muted">Times are Eastern. A scheduled guide appears on the site at the time you choose.</p>
              <div className="row">
                <label className="field"><span className="lbl">Date</span><input className="input" type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} /></label>
                <label className="field"><span className="lbl">Time</span><input className="input" type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} /></label>
              </div>
              {errors.schedule ? <p className="error-text" role="alert">{errors.schedule}</p> : null}
              <div className="stack">
                <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void save('schedule')}>{busy === 'schedule' ? 'Scheduling…' : 'Schedule'}</button>
                <button type="button" className="btn pri" disabled={busy !== null} onClick={() => void save('publish')}>{busy === 'publish' ? 'Publishing…' : 'Publish now'}</button>
              </div>
              {isSaved ? <button type="button" className="btn sm danger" disabled={busy !== null || isPublished || isScheduled} onClick={() => setConfirmDelete(true)}>Delete draft</button> : null}
              {isPublished || isScheduled ? <p className="small muted">Published guides cannot be deleted. Unpublish it first to make it a draft.</p> : null}
            </Card>

            <Card title="Search and social">
              {field('Meta title (max 60)', 'metaTitle', <input className="input" value={draft.metaTitle} maxLength={80} onChange={(e) => set('metaTitle', e.target.value)} />)}
              {field(`Meta description (${draft.metaDescription.length}/160)`, 'metaDescription', <textarea className="input" rows={3} value={draft.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} />)}
              {field('Canonical link (optional)', 'canonicalUrl', <input className="input" value={draft.canonicalUrl} onChange={(e) => set('canonicalUrl', e.target.value)} />)}
              {field('Social title (max 95)', 'ogTitle', <input className="input" value={draft.ogTitle} onChange={(e) => set('ogTitle', e.target.value)} />)}
              {field('Social description (max 200)', 'ogDescription', <textarea className="input" rows={2} value={draft.ogDescription} onChange={(e) => set('ogDescription', e.target.value)} />)}
              {field('Social image link (https://)', 'ogImageUrl', <input className="input" value={draft.ogImageUrl} onChange={(e) => set('ogImageUrl', e.target.value)} />)}
              <label className="row small"><input type="checkbox" checked={draft.noindex} onChange={(e) => set('noindex', e.target.checked)} /> Hide from search engines (noindex)</label>
              <div className="serp" aria-label="Search preview">
                <div className="small muted">mova-beauty.co/guides/{draft.slug || 'your-slug'}</div>
                <div className="serp-title">{draft.metaTitle || draft.title || 'Guide title'}</div>
                <div className="small">{draft.metaDescription || draft.summary || 'The description appears here.'}</div>
              </div>
              <ul className="list">
                {checks.map((check) => (
                  <li key={check.id} className="small"><span className={check.ok ? 'up' : 'down'}>{check.ok ? 'Pass' : 'Fix'}</span> {check.label}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this draft?"
        body={<>&ldquo;{draft.title}&rdquo; will be removed for good.</>}
        confirmLabel="Delete draft"
        danger
        busy={busy === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteDraft()}
      />
    </>
  );
}

