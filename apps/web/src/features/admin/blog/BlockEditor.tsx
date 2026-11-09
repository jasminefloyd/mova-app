import type { ReactNode } from 'react';
import type { Block, BlockType, InlineRun } from './blog-model';
import { isSafeHref } from './blog-model';

export const blockLabels: Record<BlockType, string> = {
  heading: 'Heading', paragraph: 'Paragraph', list: 'List', quote: 'Quote', image: 'Image', callout: 'Callout', divider: 'Divider',
};

/** Text of one inline run, plus the link if there is one. Each block carries one run; see the report. */
export function runText(runs: InlineRun[]): string {
  return runs.map((run) => run.text).join('');
}
export function runHref(runs: InlineRun[]): string {
  return runs.find((run) => run.href)?.href ?? '';
}
export function makeRuns(text: string, href: string): InlineRun[] {
  const link = href.trim();
  return [link ? { text, href: link } : { text }];
}

export function AddBlockMenu({ onAdd }: { onAdd: (type: BlockType) => void }) {
  return (
    <div className="add" role="group" aria-label="Add a block">
      {(Object.keys(blockLabels) as BlockType[]).map((type) => (
        <button key={type} type="button" className="btn sm ghost" onClick={() => onAdd(type)}>+ {blockLabels[type]}</button>
      ))}
    </div>
  );
}

export function BlockField({ block, index, problem, onChange }: {
  block: Block; index: number; problem: string | undefined; onChange: (next: Block) => void;
}) {
  const id = `blk-${index}`;
  const linkField = (runs: InlineRun[], set: (runs: InlineRun[]) => void) => (
    <label className="field">
      <span className="lbl">Link (optional, https:// or a path on this site)</span>
      <input className="input" value={runHref(runs)} onChange={(e) => set(makeRuns(runText(runs), e.target.value))} />
      {runHref(runs) && !isSafeHref(runHref(runs)) ? <span className="error-text">This link is not allowed.</span> : null}
    </label>
  );
  let body: ReactNode;
  switch (block.type) {
    case 'heading':
      body = (
        <div className="row">
          <label className="field"><span className="lbl">Level</span>
            <select className="select" value={block.level} onChange={(e) => onChange({ ...block, level: Number(e.target.value) === 3 ? 3 : 2 })}>
              <option value={2}>Heading 2</option><option value={3}>Heading 3</option>
            </select></label>
          <label className="field" style={{ flex: 1 }}><span className="lbl">Text</span>
            <input id={id} className="input" value={block.text} maxLength={200} onChange={(e) => onChange({ ...block, text: e.target.value })} /></label>
        </div>
      );
      break;
    case 'paragraph':
      body = (
        <>
          <label className="field"><span className="lbl">Text</span>
            <textarea id={id} className="input" rows={4} value={runText(block.content)} onChange={(e) => onChange({ ...block, content: makeRuns(e.target.value, runHref(block.content)) })} /></label>
          {linkField(block.content, (content) => onChange({ ...block, content }))}
        </>
      );
      break;
    case 'list':
      body = (
        <>
          <label className="row small"><input type="checkbox" checked={block.ordered} onChange={(e) => onChange({ ...block, ordered: e.target.checked })} /> Numbered list</label>
          <label className="field"><span className="lbl">One item per line</span>
            <textarea id={id} className="input" rows={4} value={block.items.map(runText).join('\n')} onChange={(e) => onChange({ ...block, items: e.target.value.split('\n').map((line) => [{ text: line }]) })} /></label>
        </>
      );
      break;
    case 'quote':
      body = (
        <>
          <label className="field"><span className="lbl">Quote</span>
            <textarea id={id} className="input" rows={3} value={runText(block.content)} onChange={(e) => onChange({ ...block, content: [{ text: e.target.value }] })} /></label>
          <label className="field"><span className="lbl">Who said it (optional)</span>
            <input className="input" value={block.cite ?? ''} maxLength={120} onChange={(e) => onChange(e.target.value ? { ...block, cite: e.target.value } : { type: 'quote', content: block.content })} /></label>
        </>
      );
      break;
    case 'image':
      body = (
        <>
          <label className="field"><span className="lbl">Image link (https://)</span>
            <input id={id} className="input" value={block.url} onChange={(e) => onChange({ ...block, url: e.target.value })} /></label>
          <label className="field"><span className="lbl">Alt text (describe the picture)</span>
            <input className="input" value={block.alt} maxLength={240} onChange={(e) => onChange({ ...block, alt: e.target.value })} /></label>
          <label className="field"><span className="lbl">Caption (optional)</span>
            <input className="input" value={block.caption ?? ''} maxLength={240} onChange={(e) => onChange(e.target.value ? { ...block, caption: e.target.value } : { type: 'image', url: block.url, alt: block.alt })} /></label>
        </>
      );
      break;
    case 'callout':
      body = (
        <>
          <label className="field"><span className="lbl">Tone</span>
            <select className="select" value={block.tone} onChange={(e) => onChange({ ...block, tone: e.target.value === 'note' ? 'note' : 'tip' })}>
              <option value="tip">Tip</option><option value="note">Note</option>
            </select></label>
          <label className="field"><span className="lbl">Text</span>
            <textarea id={id} className="input" rows={3} value={runText(block.content)} onChange={(e) => onChange({ ...block, content: makeRuns(e.target.value, runHref(block.content)) })} /></label>
        </>
      );
      break;
    case 'divider':
      body = <p className="small muted">A line that separates sections.</p>;
      break;
  }
  return (
    <div className="blk">
      <div className="blk-actions small muted">{blockLabels[block.type]}</div>
      {body}
      {problem ? <p className="error-text" role="alert">{problem}</p> : null}
    </div>
  );
}

/** Quick preview of the body as readers will see it, using the same block types. */
export function BlockPreview({ blocks }: { blocks: Block[] }) {
  return (
    <article className="preview">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': return block.level === 3 ? <h3 key={index}>{block.text}</h3> : <h2 key={index}>{block.text}</h2>;
          case 'paragraph': return <p key={index}>{runText(block.content)}</p>;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return <Tag key={index}>{block.items.map((item, i) => <li key={i}>{runText(item)}</li>)}</Tag>;
          }
          case 'quote': return <blockquote key={index}>{runText(block.content)}{block.cite ? <cite> {block.cite}</cite> : null}</blockquote>;
          case 'image': return <figure key={index}><div className="cover" role="img" aria-label={block.alt} /><figcaption>{block.caption ?? ''}</figcaption></figure>;
          case 'callout': return <aside key={index} className={`tag ${block.tone}`}>{runText(block.content)}</aside>;
          case 'divider': return <hr key={index} />;
        }
      })}
    </article>
  );
}

