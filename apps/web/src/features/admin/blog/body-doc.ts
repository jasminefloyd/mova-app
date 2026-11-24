// A13·v2: converts between the stored guide body (Block[], unchanged format) and the editor document.
// Pure functions, unit tested. Empty paragraphs and list items are dropped on the way out, so the
// blank line under the cursor never becomes a "needs text" problem.
import type { JSONContent } from '@tiptap/core';
import type { Block, InlineRun, VideoProvider } from './blog-model';

type Mark = { type: string; attrs?: Record<string, unknown> };

function runsToContent(runs: InlineRun[]): JSONContent[] {
  return runs.filter((run) => run.text.length > 0).map((run) => {
    const marks: Mark[] = [];
    if (run.bold) marks.push({ type: 'bold' });
    if (run.italic) marks.push({ type: 'italic' });
    if (run.href) marks.push({ type: 'link', attrs: { href: run.href } });
    return marks.length ? { type: 'text', text: run.text, marks } : { type: 'text', text: run.text };
  });
}

const para = (runs: InlineRun[]): JSONContent => ({ type: 'paragraph', content: runsToContent(runs) });
const listItem = (runs: InlineRun[]): JSONContent => ({ type: 'listItem', content: [para(runs)] });
const cell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({ type, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });

export function blocksToDoc(blocks: Block[]): JSONContent {
  const content: JSONContent[] = blocks.map((block): JSONContent => {
    switch (block.type) {
      case 'heading': return { type: 'heading', attrs: { level: block.level }, content: block.text ? [{ type: 'text', text: block.text }] : [] };
      case 'paragraph': return para(block.content);
      case 'list': return { type: block.ordered ? 'orderedList' : 'bulletList', content: block.items.map(listItem) };
      case 'quote': return { type: 'blockquote', attrs: { cite: block.cite ?? null }, content: [para(block.content)] };
      case 'image': return { type: 'guideImage', attrs: { url: block.url, alt: block.alt, caption: block.caption ?? '' } };
      case 'callout': return { type: 'callout', attrs: { tone: block.tone }, content: runsToContent(block.content) };
      case 'divider': return { type: 'horizontalRule' };
      case 'takeaways': return { type: 'takeaways', content: [{ type: 'bulletList', content: block.items.map(listItem) }] };
      case 'button': return { type: 'guideButton', attrs: { label: block.label, href: block.href, variant: block.variant, title: block.title ?? '', text: block.text ?? '' } };
      case 'before_after': return { type: 'beforeAfter', attrs: { beforeUrl: block.before.url, beforeAlt: block.before.alt, afterUrl: block.after.url, afterAlt: block.after.alt, caption: block.caption ?? '' } };
      case 'video': return { type: 'guideVideo', attrs: { provider: block.provider, id: block.id, caption: block.caption ?? '' } };
      case 'table': return {
        type: 'table',
        content: block.rows.map((row, r) => ({ type: 'tableRow', content: row.map((text) => cell(block.header && r === 0 ? 'tableHeader' : 'tableCell', text)) })),
      };
      case 'faq': return {
        type: 'faq',
        content: block.items.map((item) => ({
          type: 'faqItem',
          content: [
            { type: 'faqQuestion', content: item.question ? [{ type: 'text', text: item.question }] : [] },
            { type: 'faqAnswer', content: runsToContent(item.answer) },
          ],
        })),
      };
    }
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** Inline content to runs: bold, italic and link marks; neighbouring runs with the same marks are joined. */
export function contentToRuns(content: JSONContent[] | undefined): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const node of content ?? []) {
    if (node.type === 'hardBreak') { appendText(runs, { text: ' ' }); continue; }
    if (node.type !== 'text' || !node.text) continue;
    const run: InlineRun = { text: node.text };
    for (const mark of (node.marks ?? []) as Mark[]) {
      if (mark.type === 'bold') run.bold = true;
      if (mark.type === 'italic') run.italic = true;
      if (mark.type === 'link' && typeof mark.attrs?.href === 'string' && mark.attrs.href) run.href = mark.attrs.href;
    }
    appendText(runs, run);
  }
  return runs;
}

function appendText(runs: InlineRun[], run: InlineRun) {
  const last = runs[runs.length - 1];
  if (last && last.bold === run.bold && last.italic === run.italic && last.href === run.href) last.text += run.text;
  else runs.push(run);
}

const plain = (content: JSONContent[] | undefined) => contentToRuns(content).map((run) => run.text).join('');
const hasText = (runs: InlineRun[]) => runs.some((run) => run.text.trim().length > 0);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Each list item's first paragraph; nested lists become items of their own, in order. */
function listItems(list: JSONContent | undefined): InlineRun[][] {
  const items: InlineRun[][] = [];
  for (const item of list?.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') items.push(contentToRuns(child.content));
      else if (child.type === 'bulletList' || child.type === 'orderedList') items.push(...listItems(child));
    }
  }
  return items.filter(hasText);
}

export function docToBlocks(doc: JSONContent): Block[] {
  const blocks: Block[] = [];
  for (const node of doc.content ?? []) {
    const attrs = node.attrs ?? {};
    switch (node.type) {
      case 'paragraph': {
        const runs = contentToRuns(node.content);
        if (hasText(runs)) blocks.push({ type: 'paragraph', content: runs });
        break;
      }
      case 'heading': {
        const text = plain(node.content);
        if (text.trim()) blocks.push({ type: 'heading', level: attrs.level === 3 ? 3 : 2, text });
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = listItems(node);
        if (items.length) blocks.push({ type: 'list', ordered: node.type === 'orderedList', items });
        break;
      }
      case 'blockquote': {
        const content: InlineRun[] = [];
        (node.content ?? []).forEach((child, i) => {
          if (i) appendText(content, { text: ' ' });
          for (const run of contentToRuns(child.content)) appendText(content, { ...run });
        });
        if (hasText(content)) blocks.push(str(attrs.cite).trim() ? { type: 'quote', content, cite: str(attrs.cite).trim() } : { type: 'quote', content });
        break;
      }
      case 'callout': {
        const content = contentToRuns(node.content);
        if (hasText(content)) blocks.push({ type: 'callout', tone: attrs.tone === 'note' ? 'note' : 'tip', content });
        break;
      }
      case 'horizontalRule':
        blocks.push({ type: 'divider' });
        break;
      case 'guideImage': {
        const caption = str(attrs.caption).trim();
        blocks.push({ type: 'image', url: str(attrs.url).trim(), alt: str(attrs.alt).trim(), ...(caption ? { caption } : {}) });
        break;
      }
      case 'takeaways': {
        const items = listItems((node.content ?? []).find((child) => child.type === 'bulletList' || child.type === 'orderedList'));
        blocks.push({ type: 'takeaways', items });
        break;
      }
      case 'guideButton': {
        const variant = attrs.variant === 'button' ? 'button' : 'banner';
        const title = str(attrs.title).trim(); const text = str(attrs.text).trim();
        blocks.push({ type: 'button', label: str(attrs.label).trim(), href: str(attrs.href).trim(), variant, ...(variant === 'banner' && title ? { title } : {}), ...(variant === 'banner' && text ? { text } : {}) });
        break;
      }
      case 'beforeAfter': {
        const caption = str(attrs.caption).trim();
        blocks.push({ type: 'before_after', before: { url: str(attrs.beforeUrl).trim(), alt: str(attrs.beforeAlt).trim() }, after: { url: str(attrs.afterUrl).trim(), alt: str(attrs.afterAlt).trim() }, ...(caption ? { caption } : {}) });
        break;
      }
      case 'guideVideo': {
        const caption = str(attrs.caption).trim();
        const provider: VideoProvider = attrs.provider === 'vimeo' || attrs.provider === 'instagram' ? attrs.provider : 'youtube';
        blocks.push({ type: 'video', provider, id: str(attrs.id), ...(caption ? { caption } : {}) });
        break;
      }
      case 'table': {
        const rowsNodes = node.content ?? [];
        const rows = rowsNodes.map((row) => (row.content ?? []).map((c) => (c.content ?? []).map((p) => plain(p.content)).join(' ').trim()));
        const width = Math.max(0, ...rows.map((row) => row.length));
        const header = (rowsNodes[0]?.content ?? []).length > 0 && (rowsNodes[0]?.content ?? []).every((c) => c.type === 'tableHeader');
        blocks.push({ type: 'table', header, rows: rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]) });
        break;
      }
      case 'faq': {
        const items = (node.content ?? []).map((item) => {
          const question = plain(item.content?.find((c) => c.type === 'faqQuestion')?.content).trim();
          const answer = contentToRuns(item.content?.find((c) => c.type === 'faqAnswer')?.content);
          return { question, answer };
        }).filter((item) => item.question || hasText(item.answer));
        blocks.push({ type: 'faq', items });
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}
