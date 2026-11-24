// A13·v2 Body card: one writing area for the guide body. "/" or Insert adds a block, markdown shortcuts work
// (## heading, - list, 1. list, > quote, --- divider), selected text gets a small toolbar, and the dotted handle
// beside a block moves it or changes its type. The stored body format is unchanged (see body-doc.ts).
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/core';
import { isSafeHref, type Block } from '../blog-model';
import { blocksToDoc, docToBlocks } from '../body-doc';
import { GUIDE_NODES, GuideQuote } from './nodes';
import { EdIcon, type IconName } from './icons';
import './body-editor.css';

/* ---------- Block catalogue (the "/" menu, Insert and Turn into) ---------- */

type Kind = 'paragraph' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'tip' | 'note';
type Item = { key: string; group: 'Text' | 'Highlights' | 'Media' | 'Structure'; label: string; hint: string; icon: IconName | 'H2' | 'H3'; keys?: string; isNew?: boolean; words: string; kind?: Kind; insert?: JSONContent };

export const ITEMS: Item[] = [
  { key: 'paragraph', group: 'Text', label: 'Text', hint: 'Paragraph', icon: 'text', words: 'text paragraph plain', kind: 'paragraph' },
  { key: 'h2', group: 'Text', label: 'Heading', hint: 'Section title', icon: 'H2', keys: '##', words: 'heading title h2 section', kind: 'h2' },
  { key: 'h3', group: 'Text', label: 'Subheading', hint: 'Smaller title', icon: 'H3', keys: '###', words: 'subheading h3 smaller', kind: 'h3' },
  { key: 'bullet', group: 'Text', label: 'Bulleted list', hint: '', icon: 'list', keys: '-', words: 'bulleted list bullets ul', kind: 'bullet' },
  { key: 'ordered', group: 'Text', label: 'Numbered list', hint: '', icon: 'olist', keys: '1.', words: 'numbered list ordered steps ol', kind: 'ordered' },
  { key: 'quote', group: 'Text', label: 'Quote', hint: '', icon: 'quote', keys: '>', words: 'quote blockquote', kind: 'quote' },
  { key: 'tip', group: 'Highlights', label: 'Tip or note', hint: 'Colored callout', icon: 'info', words: 'tip note callout highlight', kind: 'tip' },
  { key: 'takeaways', group: 'Highlights', label: 'Key takeaways', hint: 'Summary box', icon: 'takeaways', isNew: true, words: 'key takeaways summary tldr',
    insert: { type: 'takeaways', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] } },
  { key: 'button', group: 'Highlights', label: 'Button', hint: 'Start free or any link', icon: 'button', isNew: true, words: 'button cta call to action banner signup link',
    insert: { type: 'guideButton', attrs: { label: 'Start free', href: '/signup', variant: 'banner', title: 'Try Mova free for 30 days', text: '' } } },
  { key: 'image', group: 'Media', label: 'Image', hint: 'Paste a link', icon: 'image', words: 'image photo picture', insert: { type: 'guideImage' } },
  { key: 'before_after', group: 'Media', label: 'Before and after', hint: 'Two photos', icon: 'ba', isNew: true, words: 'before after transformation photos', insert: { type: 'beforeAfter' } },
  { key: 'video', group: 'Media', label: 'Video', hint: 'YouTube, Vimeo, Instagram', icon: 'video', isNew: true, words: 'video youtube vimeo instagram reel embed', insert: { type: 'guideVideo' } },
  { key: 'table', group: 'Structure', label: 'Table', hint: 'Prices and times', icon: 'table', isNew: true, words: 'table grid prices',
    insert: { type: 'table', content: [0, 1, 2].map((r) => ({ type: 'tableRow', content: [0, 1].map(() => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph' }] })) })) } },
  { key: 'faq', group: 'Structure', label: 'FAQ', hint: 'Questions and answers', icon: 'faq', isNew: true, words: 'faq questions answers',
    insert: { type: 'faq', content: [{ type: 'faqItem', content: [{ type: 'faqQuestion' }, { type: 'faqAnswer' }] }] } },
  { key: 'divider', group: 'Structure', label: 'Divider', hint: '', icon: 'divider', keys: '---', words: 'divider line rule separator hr', insert: { type: 'horizontalRule' } },
];
const TEXT_KINDS: Array<[Kind, string]> = [['paragraph', 'Paragraph'], ['h2', 'Heading'], ['h3', 'Subheading'], ['bullet', 'Bulleted list'], ['ordered', 'Numbered list'], ['quote', 'Quote'], ['tip', 'Tip'], ['note', 'Note']];

function filterItems(query: string) {
  const q = query.trim().toLowerCase();
  return q ? ITEMS.filter((item) => item.label.toLowerCase().includes(q) || item.words.includes(q)) : ITEMS;
}

/** The text-block kind at the cursor, for the toolbar's block menu. */
function currentKind(editor: Editor): Kind | 'other' {
  if (editor.isActive('callout')) return editor.isActive('callout', { tone: 'note' }) ? 'note' : 'tip';
  if (editor.isActive('takeaways') || editor.isActive('faq') || editor.isActive('table')) return 'other';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  if (editor.isActive('orderedList')) return 'ordered';
  if (editor.isActive('bulletList')) return 'bullet';
  if (editor.isActive('blockquote')) return 'quote';
  if (editor.isActive('paragraph')) return 'paragraph';
  return 'other';
}

/** Turns the text block at the cursor into another text kind, keeping its words. */
function turnInto(editor: Editor, kind: Kind) {
  const chain = () => editor.chain().focus();
  // Leave lists, quotes and callouts first, so every kind starts from a paragraph.
  if (editor.isActive('bulletList')) chain().toggleBulletList().run();
  if (editor.isActive('orderedList')) chain().toggleOrderedList().run();
  if (editor.isActive('blockquote')) chain().lift('blockquote').run();
  if (editor.isActive('callout') && kind !== 'tip' && kind !== 'note') chain().setNode('paragraph').run();
  switch (kind) {
    case 'paragraph': chain().setParagraph().run(); break;
    case 'h2': chain().setNode('heading', { level: 2 }).run(); break;
    case 'h3': chain().setNode('heading', { level: 3 }).run(); break;
    case 'bullet': chain().setParagraph().toggleBulletList().run(); break;
    case 'ordered': chain().setParagraph().toggleOrderedList().run(); break;
    case 'quote': chain().setParagraph().wrapIn('blockquote').run(); break;
    case 'tip': case 'note':
      if (editor.isActive('callout')) chain().updateAttributes('callout', { tone: kind }).run();
      else chain().setNode('callout', { tone: kind }).run();
      break;
  }
}

/** Runs a catalogue item in place of the empty line the cursor is on (used by "/" and Insert). */
function applyItem(editor: Editor, item: Item, range: { from: number; to: number } | null) {
  if (range) editor.chain().focus().deleteRange(range).run();
  if (item.kind) { turnInto(editor, item.kind); return; }
  if (!item.insert) return;
  const { $from } = editor.state.selection;
  const emptyLine = $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
  const at = emptyLine ? $from.before(1) : $from.depth >= 1 ? $from.after(1) : $from.pos;
  // On an empty line the new block replaces the line; otherwise it goes after the current block.
  editor.chain().focus().insertContentAt(emptyLine ? { from: $from.before(1), to: $from.after(1) } : at, item.insert).run();
  // Put the cursor inside text blocks (takeaways, table, FAQ) so typing can start right away.
  const node = editor.state.doc.nodeAt(at);
  if (node && !node.isAtom) cursorInto(editor, at);
  else if (node) editor.commands.setNodeSelection(at);
}

/** Puts the cursor at the start of the first line of text inside the block at pos. */
function cursorInto(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  if (node.isTextblock) { editor.commands.setTextSelection(pos + 1); return; }
  let target = -1;
  node.descendants((child, offset) => { if (target < 0 && child.isTextblock) target = pos + 1 + offset + 1; return target < 0; });
  if (target > 0) editor.commands.setTextSelection(target);
}

/* ---------- Component ---------- */

type Slash = { from: number; to: number; query: string; top: number; left: number };
type Handle = { pos: number; top: number; text: boolean };

export function BodyEditor({ initial, onChange, problem }: { initial: Block[]; onChange: (blocks: Block[]) => void; problem?: string | undefined }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [insertMenu, setInsertMenu] = useState(false);
  const [handle, setHandle] = useState<Handle | null>(null);
  const [handleMenu, setHandleMenu] = useState<Handle | null>(null);
  const [linkEditing, setLinkEditing] = useState<string | null>(null);
  const items = useMemo(() => filterItems(slash?.query ?? ''), [slash?.query]);
  const state = useRef({ slash, items, active });
  state.current = { slash, items, active };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] }, code: false, codeBlock: false, strike: false, underline: false, hardBreak: false, blockquote: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', isAllowedUri: (url) => isSafeHref(url) },
      }),
      GuideQuote,
      TableKit.configure({ table: { resizable: false } }),
      // Placeholders on the current top-level line only (FAQ fields get theirs from CSS).
      Placeholder.configure({
        showOnlyCurrent: true,
        includeChildren: false,
        placeholder: ({ node }) => {
          if (node.type.name === 'callout') return 'Write a tip or note';
          if (node.type.name === 'heading') return node.attrs.level === 3 ? 'Subheading' : 'Heading';
          return node.type.name === 'paragraph' ? 'Type / for blocks, or keep writing…' : '';
        },
      }),
      ...GUIDE_NODES,
    ],
    content: blocksToDoc(initial),
    editorProps: {
      attributes: { class: 'bed-doc', 'aria-label': 'Guide body', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        const { slash: open, items: list, active: index } = state.current;
        if (!open || !list.length) return false;
        if (event.key === 'ArrowDown') { setActive((index + 1) % list.length); return true; }
        if (event.key === 'ArrowUp') { setActive((index - 1 + list.length) % list.length); return true; }
        if (event.key === 'Enter') { pick(list[index]!); return true; }
        if (event.key === 'Escape') { setDismissed(open.from); setSlash(null); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => { onChange(docToBlocks(ed.getJSON())); },
  });

  // "/" at the start of an empty top-level line opens the block menu; the rest of the line filters it.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { selection } = editor.state;
      const { $from } = selection;
      const text = $from.parent.textContent;
      if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || !text.startsWith('/') || text.length > 30 || $from.parentOffset !== text.length) {
        setSlash(null); return;
      }
      const from = $from.start();
      if (dismissed === from) { setSlash(null); return; }
      const box = wrap.current?.getBoundingClientRect();
      const at = editor.view.coordsAtPos(from);
      setSlash((current) => {
        const next = { from, to: $from.end(), query: text.slice(1), top: at.bottom - (box?.top ?? 0) + 6, left: at.left - (box?.left ?? 0) };
        if (!current || current.query !== next.query) setActive(0);
        return next;
      });
    };
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor, dismissed]);

  function pick(item: Item) {
    if (!editor) return;
    const open = state.current.slash;
    setSlash(null); setInsertMenu(false);
    applyItem(editor, item, open ? { from: open.from, to: open.to } : null);
  }

  // Block handle: follows the pointer to the top-level block it is next to.
  function track(event: React.MouseEvent) {
    if (!editor || handleMenu) return;
    const box = wrap.current?.getBoundingClientRect();
    const doc = editor.view.dom.getBoundingClientRect();
    if (!box) return;
    const hit = editor.view.posAtCoords({ left: doc.left + 60, top: event.clientY });
    if (!hit) return;
    const $pos = editor.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
    const before = $pos.depth >= 1 ? $pos.before(1) : hit.inside >= 0 ? hit.inside : -1;
    if (before < 0) return;
    const node = editor.state.doc.nodeAt(before);
    const dom = editor.view.nodeDOM(before);
    if (!node || !(dom instanceof HTMLElement)) return;
    const top = dom.getBoundingClientRect().top - box.top;
    setHandle((current) => (current?.pos === before && current.top === top ? current : { pos: before, top, text: node.isTextblock || ['bulletList', 'orderedList', 'blockquote'].includes(node.type.name) }));
  }

  function plusBelow(at: Handle) {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(at.pos);
    if (!node) return;
    const after = at.pos + node.nodeSize;
    editor.chain().insertContentAt(after, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).setTextSelection(after + 2).focus().run();
    setDismissed(null);
  }

  function selectBlock(at: Handle) {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at.pos)));
  }

  function dragStart(event: React.DragEvent, at: Handle) {
    if (!editor) return;
    selectBlock(at);
    const { view } = editor;
    const slice = view.state.selection.content();
    view.dragging = { slice, move: true };
    const dom = view.nodeDOM(at.pos);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', '');
    if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
  }

  function blockAction(action: 'duplicate' | 'up' | 'down' | 'delete', at: Handle) {
    if (!editor) return;
    const { state: s } = editor;
    const node = s.doc.nodeAt(at.pos);
    if (!node) return;
    const end = at.pos + node.nodeSize;
    let tr = s.tr;
    if (action === 'duplicate') tr = tr.insert(end, node.copy(node.content));
    if (action === 'delete') tr = tr.delete(at.pos, end);
    if (action === 'up' || action === 'down') {
      const $pos = s.doc.resolve(at.pos);
      const index = $pos.index(0);
      const sibling = action === 'up' ? (index > 0 ? s.doc.child(index - 1) : null) : (index < s.doc.childCount - 1 ? s.doc.child(index + 1) : null);
      if (!sibling) return;
      tr = tr.delete(at.pos, end);
      const target = action === 'up' ? at.pos - sibling.nodeSize : at.pos + sibling.nodeSize;
      tr = tr.insert(target, node);
      tr = tr.setSelection(NodeSelection.create(tr.doc, target));
    }
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    setHandleMenu(null);
  }

  // Re-render on every editor change so the toolbars show the current marks and block style.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); };
  }, [editor]);
  const ui = editor ? {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), link: editor.isActive('link'), kind: currentKind(editor),
    table: editor.isActive('table'), canUndo: editor.can().undo(), canRedo: editor.can().redo(), href: (editor.getAttributes('link').href as string | undefined) ?? '',
  } : null;

  // Selection toolbar: above the selected text while the editor (or its link field) has focus.
  const bubble = (() => {
    if (!editor || !wrap.current) return null;
    const { selection } = editor.state;
    if (selection.empty || !(selection instanceof TextSelection) || editor.isActive('faqQuestion')) return null;
    if (!editor.isFocused && linkEditing === null) return null;
    const box = wrap.current.getBoundingClientRect();
    const start = editor.view.coordsAtPos(selection.from);
    return { top: Math.max(0, start.top - box.top - 44), left: Math.max(0, Math.min(start.left - box.left, box.width - 300)) };
  })();

  if (!editor || !ui) return <div className="bed-loading">Loading editor…</div>;

  const linkProblem = linkEditing !== null && linkEditing.trim() && !isSafeHref(linkEditing.trim()) ? 'Links must start with https:// or be a Mova page like /signup.' : null;
  const applyLink = () => {
    if (linkEditing === null) return;
    const href = linkEditing.trim();
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else if (isSafeHref(href)) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    else return;
    setLinkEditing(null);
  };

  const kindSelect = (id: string) => <label className="bed-kind" htmlFor={id}>
    <EdIcon name="type" size={16} />
    <span className="bed-sr">Block style</span>
    <select id={id} value={ui.kind === 'other' ? '' : ui.kind} disabled={ui.kind === 'other'} onChange={(event) => turnInto(editor, event.currentTarget.value as Kind)}>
      {ui.kind === 'other' ? <option value="">Block</option> : null}
      {TEXT_KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
  </label>;

  return <section className="card bed" aria-labelledby="bed-title">
    <div className="bed-h"><h2 id="bed-title" className="h2">Body</h2><span className="bed-hint">Type <kbd>/</kbd> to add a block · select text to format</span></div>
    <div className="bed-tools" role="toolbar" aria-label="Formatting">
      <button type="button" className="bed-tool" aria-haspopup="menu" aria-expanded={insertMenu} onClick={() => { setInsertMenu((v) => !v); setSlash(null); }}><EdIcon name="plus" size={17} /> Insert</button>
      <i />
      <button type="button" className="bed-tool" aria-label="Bold" aria-pressed={ui.bold} onClick={() => editor.chain().focus().toggleBold().run()}><EdIcon name="bold" size={16} stroke={2.2} /></button>
      <button type="button" className="bed-tool" aria-label="Italic" aria-pressed={ui.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><EdIcon name="italic" size={16} stroke={2} /></button>
      <button type="button" className="bed-tool" aria-label="Link" aria-pressed={ui.link} onClick={() => setLinkEditing(ui.href)}><EdIcon name="link" size={16} /></button>
      <i />
      {kindSelect('bed-kind-top')}
      {ui.table ? <span className="bed-table-tools" role="group" aria-label="Table">
        <button type="button" className="bed-tool" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button>
        <button type="button" className="bed-tool" onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.can().addColumnAfter()}>+ Column</button>
        <button type="button" className="bed-tool" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Header row</button>
        <button type="button" className="bed-tool bed-danger" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
        <button type="button" className="bed-tool bed-danger" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
      </span> : null}
      <span className="bed-spacer" />
      <button type="button" className="bed-tool" aria-label="Undo" disabled={!ui.canUndo} onClick={() => editor.chain().focus().undo().run()}><EdIcon name="undo" size={16} /></button>
      <button type="button" className="bed-tool" aria-label="Redo" disabled={!ui.canRedo} onClick={() => editor.chain().focus().redo().run()}><EdIcon name="redo" size={16} /></button>
    </div>
    {linkEditing !== null && !editor.state.selection.empty ? null : linkEditing !== null ? <div className="bed-linkbar"><span>Select some text first, then add a link.</span><button type="button" className="btn sm ghost" onClick={() => setLinkEditing(null)}>Close</button></div> : null}

    <div className="bed-wrap" ref={wrap} onMouseMove={track} onMouseLeave={() => { if (!handleMenu) setHandle(null); }}>
      <EditorContent editor={editor} />

      {handle ? <div className="bed-handle" style={{ top: handle.top }}>
        <button type="button" aria-label="Add a block below" onClick={() => plusBelow(handle)}><EdIcon name="plus" size={15} /></button>
        <button type="button" draggable aria-label="Drag to move, or click for block options" aria-haspopup="menu" aria-expanded={handleMenu?.pos === handle.pos}
          onDragStart={(event) => dragStart(event, handle)} onClick={() => { selectBlock(handle); setHandleMenu(handleMenu?.pos === handle.pos ? null : handle); }}>
          <EdIcon name="grip" size={15} />
        </button>
      </div> : null}

      {handleMenu ? <Menu className="bed-hmenu" style={{ top: handleMenu.top + 30, left: 6 }} onClose={() => setHandleMenu(null)} label="Block options">
        {handleMenu.text ? <div className="bed-sub"><span className="bed-grp">Turn into</span>
          {TEXT_KINDS.map(([kind, label]) => <button key={kind} type="button" role="menuitem" className="bed-mi" onClick={() => { cursorInto(editor, handleMenu.pos); turnInto(editor, kind); setHandleMenu(null); }}>{label}</button>)}
        </div> : null}
        <button type="button" role="menuitem" className="bed-mi" onClick={() => blockAction('duplicate', handleMenu)}><EdIcon name="copy" size={15} />Duplicate</button>
        <button type="button" role="menuitem" className="bed-mi" onClick={() => blockAction('up', handleMenu)}><EdIcon name="up" size={15} />Move up</button>
        <button type="button" role="menuitem" className="bed-mi" onClick={() => blockAction('down', handleMenu)}><EdIcon name="down" size={15} />Move down</button>
        <button type="button" role="menuitem" className="bed-mi bed-danger" onClick={() => blockAction('delete', handleMenu)}><EdIcon name="trash" size={15} />Delete</button>
      </Menu> : null}

      {slash && items.length > 0 ? <BlockMenu items={items} active={active} onPick={pick} onHover={setActive} style={{ top: slash.top, left: Math.max(0, slash.left - 8) }} /> : null}
      {slash && items.length === 0 ? <div className="bed-menu bed-empty" style={{ top: slash.top, left: Math.max(0, slash.left - 8) }}>No blocks match “{slash.query}”.</div> : null}
      {insertMenu ? <Menu className="bed-insert" style={{ top: 4, left: 10 }} onClose={() => setInsertMenu(false)} label="Insert a block">
        <BlockList items={ITEMS} active={-1} onPick={(item) => { editor.commands.focus(); pick(item); }} onHover={() => undefined} />
      </Menu> : null}

      {bubble ? <div className="bed-bubble" role="toolbar" aria-label="Selected text" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(event) => { if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) event.preventDefault(); }}>
        {linkEditing !== null ? <div className="bed-bubble-link">
          <input autoFocus aria-label="Link address" placeholder="https:// or /signup" value={linkEditing} onChange={(event) => setLinkEditing(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } if (event.key === 'Escape') setLinkEditing(null); }} />
          <button type="button" onClick={applyLink} disabled={Boolean(linkProblem)}>{linkEditing.trim() ? 'Apply' : 'Remove'}</button>
          {linkProblem ? <small role="alert">{linkProblem}</small> : null}
        </div> : <>
          <button type="button" aria-label="Bold" aria-pressed={ui.bold} onClick={() => editor.chain().focus().toggleBold().run()}><EdIcon name="bold" size={15} stroke={2.2} /></button>
          <button type="button" aria-label="Italic" aria-pressed={ui.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><EdIcon name="italic" size={15} stroke={2} /></button>
          <button type="button" aria-pressed={ui.link} onClick={() => setLinkEditing(ui.href)}><EdIcon name="link" size={15} /> Link</button>
          <i />
          {ui.kind !== 'other' ? <label className="bed-bubble-kind" htmlFor="bed-kind-bubble"><span className="bed-sr">Turn into</span>
            <select id="bed-kind-bubble" value={ui.kind} onChange={(event) => turnInto(editor, event.currentTarget.value as Kind)}>
              {TEXT_KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label> : null}
        </>}
      </div> : null}
    </div>
    {problem ? <p className="error-text bed-problem" role="alert">{problem}</p> : null}
  </section>;
}

/* ---------- Menus ---------- */

function Menu({ children, className, style, onClose, label }: { children: ReactNode; className: string; style: React.CSSProperties; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as globalThis.Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);
  return <div ref={ref} className={`bed-menu ${className}`} style={style} role="menu" aria-label={label}>{children}</div>;
}

function BlockList({ items, active, onPick, onHover }: { items: Item[]; active: number; onPick: (item: Item) => void; onHover: (index: number) => void }) {
  let group = '';
  return <>{items.map((item, index) => {
    const head = item.group !== group ? (group = item.group) : null;
    return <div key={item.key}>
      {head ? <div className="bed-grp">{head}</div> : null}
      <button type="button" role="menuitem" className="bed-mi" data-active={index === active || undefined}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onPick(item)}>
        <span className="bed-ico">{item.icon === 'H2' || item.icon === 'H3' ? <b>{item.icon}</b> : <EdIcon name={item.icon} size={16} />}</span>
        <b>{item.label}</b>{item.hint ? <small>{item.hint}</small> : null}
        {item.isNew ? <span className="pill p-new">New</span> : item.keys ? <kbd>{item.keys}</kbd> : null}
      </button>
    </div>;
  })}</>;
}

function BlockMenu({ items, active, onPick, onHover, style }: { items: Item[]; active: number; onPick: (item: Item) => void; onHover: (index: number) => void; style: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return <div ref={ref} className="bed-menu bed-slash" style={style} role="menu" aria-label="Add a block">
    <BlockList items={items} active={active} onPick={onPick} onHover={onHover} />
  </div>;
}
