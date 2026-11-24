// Custom guide blocks for the A13·v2 body editor. Text blocks (callout, takeaways, FAQ) are edited in place;
// media and button blocks are small cards with their own fields. Each card shows its own problems.
import { Node, mergeAttributes } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { useId, useState } from 'react';
import { isButtonHref, isHttpsUrl, parseVideoUrl, VIDEO_ID, type VideoProvider } from '../blog-model';
import { EdIcon } from './icons';

const str = (value: unknown) => (typeof value === 'string' ? value : '');

function Flag({ children }: { children: string }) {
  return <span className="eb-flag" role="note"><EdIcon name="alert" size={13} stroke={2} />{children}</span>;
}

function Field({ label, value, onChange, placeholder, maxLength, invalid, hint }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; maxLength?: number; invalid?: boolean; hint?: string }) {
  const id = useId();
  return <div className="eb-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="input" value={value} placeholder={placeholder} maxLength={maxLength} aria-invalid={invalid || undefined}
      aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.currentTarget.value)} />
    {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
  </div>;
}

/* ---------- Quote keeps its optional credit ---------- */
export const GuideQuote = Blockquote.extend({
  content: 'paragraph+',
  addAttributes() {
    return { cite: { default: null, parseHTML: (el) => el.getAttribute('cite'), renderHTML: (attrs) => (attrs.cite ? { cite: attrs.cite } : {}) } };
  },
});

/* ---------- Tip / note callout ---------- */
function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const tone = node.attrs.tone === 'note' ? 'note' : 'tip';
  return <NodeViewWrapper className={`eb-callout eb-callout--${tone}`}>
    <button type="button" contentEditable={false} className="eb-callout-tone" onClick={() => updateAttributes({ tone: tone === 'tip' ? 'note' : 'tip' })} aria-label={`Callout style: ${tone}. Switch to ${tone === 'tip' ? 'note' : 'tip'}`}>{tone === 'tip' ? 'Tip' : 'Note'}</button>
    <NodeViewContent className="eb-callout-text" />
  </NodeViewWrapper>;
}
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() { return { tone: { default: 'tip' } }; },
  parseHTML() { return [{ tag: 'aside[data-callout]', getAttrs: (el) => ({ tone: (el as HTMLElement).dataset.callout === 'note' ? 'note' : 'tip' }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs.tone }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

/* ---------- Key takeaways ---------- */
function TakeawaysView() {
  return <NodeViewWrapper className="eb-take"><b contentEditable={false}>Key takeaways</b><NodeViewContent /></NodeViewWrapper>;
}
export const Takeaways = Node.create({
  name: 'takeaways',
  group: 'block',
  content: 'bulletList',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-takeaways]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-takeaways': '' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(TakeawaysView); },
});

/* ---------- Image ---------- */
function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const url = str(node.attrs.url); const alt = str(node.attrs.alt); const caption = str(node.attrs.caption);
  const ok = isHttpsUrl(url);
  return <NodeViewWrapper className={`eb-card eb-image${selected ? ' is-selected' : ''}`} contentEditable={false}>
    {ok ? <img className="eb-img" src={url} alt="" /> : <div className="eb-img eb-img--empty"><EdIcon name="image" size={26} /><span>Paste an image link below</span></div>}
    <div className="eb-fields">
      <Field label="Image link (https://)" value={url} onChange={(value) => updateAttributes({ url: value })} placeholder="https://" invalid={url.length > 0 && !ok} />
      <Field label="Alt text" value={alt} onChange={(value) => updateAttributes({ alt: value })} maxLength={240} hint="Describes the photo for screen readers and Google." invalid={!alt.trim()} />
      <Field label="Caption (optional)" value={caption} onChange={(value) => updateAttributes({ caption: value })} maxLength={240} />
    </div>
    <div className="eb-flags">
      {url.length > 0 && !ok ? <Flag>Image links must start with https://</Flag> : null}
      {!alt.trim() ? <Flag>Add alt text</Flag> : null}
    </div>
  </NodeViewWrapper>;
}
export const GuideImage = Node.create({
  name: 'guideImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { url: { default: '' }, alt: { default: '' }, caption: { default: '' } }; },
  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: (el) => {
        const src = (el as HTMLImageElement).getAttribute('src') ?? '';
        return src.startsWith('https://') ? { url: src, alt: (el as HTMLImageElement).getAttribute('alt') ?? '' } : false;
      },
    }];
  },
  renderHTML({ HTMLAttributes }) { return ['figure', mergeAttributes({ 'data-guide-image': '' }), ['img', { src: HTMLAttributes.url, alt: HTMLAttributes.alt }]]; },
  addNodeView() { return ReactNodeViewRenderer(ImageView); },
});

/* ---------- Before and after ---------- */
function BeforeAfterView({ node, updateAttributes, selected }: NodeViewProps) {
  const a = node.attrs as Record<string, unknown>;
  const side = (key: 'before' | 'after') => {
    const url = str(a[`${key}Url`]); const alt = str(a[`${key}Alt`]);
    const ok = isHttpsUrl(url);
    return <div className="eb-ba-side">
      {ok ? <span className="eb-ba-img"><img src={url} alt="" /><b>{key === 'before' ? 'Before' : 'After'}</b></span>
        : <span className="eb-ba-img eb-img--empty"><b>{key === 'before' ? 'Before' : 'After'}</b><EdIcon name="image" size={22} /></span>}
      <Field label={`${key === 'before' ? 'Before' : 'After'} photo link`} value={url} onChange={(value) => updateAttributes({ [`${key}Url`]: value })} placeholder="https://" invalid={url.length > 0 && !ok} />
      <Field label="Alt text" value={alt} onChange={(value) => updateAttributes({ [`${key}Alt`]: value })} maxLength={240} invalid={!alt.trim()} />
    </div>;
  };
  const missingPhoto = !isHttpsUrl(str(a.beforeUrl)) || !isHttpsUrl(str(a.afterUrl));
  const missingAlt = !str(a.beforeAlt).trim() || !str(a.afterAlt).trim();
  return <NodeViewWrapper className={`eb-card eb-ba${selected ? ' is-selected' : ''}`} contentEditable={false}>
    <div className="eb-ba-grid">{side('before')}{side('after')}</div>
    <Field label="Caption (optional)" value={str(a.caption)} onChange={(value) => updateAttributes({ caption: value })} maxLength={240} />
    <div className="eb-flags">{missingPhoto ? <Flag>Add both photos</Flag> : null}{missingAlt ? <Flag>Add alt text for both photos</Flag> : null}</div>
  </NodeViewWrapper>;
}
export const BeforeAfter = Node.create({
  name: 'beforeAfter',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { beforeUrl: { default: '' }, beforeAlt: { default: '' }, afterUrl: { default: '' }, afterAlt: { default: '' }, caption: { default: '' } }; },
  parseHTML() { return [{ tag: 'figure[data-before-after]' }]; },
  renderHTML() { return ['figure', { 'data-before-after': '' }]; },
  addNodeView() { return ReactNodeViewRenderer(BeforeAfterView); },
});

/* ---------- Video ---------- */
const PROVIDER_NAME: Record<VideoProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo', instagram: 'Instagram' };
function videoLink(provider: VideoProvider, id: string) {
  if (provider === 'youtube') return `https://www.youtube.com/watch?v=${id}`;
  if (provider === 'vimeo') return `https://vimeo.com/${id}`;
  return `https://www.instagram.com/p/${id}/`;
}
function VideoView({ node, updateAttributes, selected }: NodeViewProps) {
  const provider = (['youtube', 'vimeo', 'instagram'].includes(str(node.attrs.provider)) ? node.attrs.provider : 'youtube') as VideoProvider;
  const id = str(node.attrs.id);
  const valid = VIDEO_ID[provider].test(id);
  const [link, setLink] = useState(valid ? videoLink(provider, id) : '');
  const parsed = link.trim() ? parseVideoUrl(link) : null;
  return <NodeViewWrapper className={`eb-card eb-video${selected ? ' is-selected' : ''}`} contentEditable={false}>
    <div className="eb-vd"><span className="eb-vd-play"><EdIcon name="play" size={22} /></span><small>{valid ? `${PROVIDER_NAME[provider]} · loads only when a reader taps play` : 'Paste a YouTube, Vimeo or Instagram link'}</small></div>
    <div className="eb-fields">
      <Field label="Video link" value={link} placeholder="https://www.youtube.com/watch?v=…" invalid={link.trim().length > 0 && !parsed}
        onChange={(value) => { setLink(value); const next = parseVideoUrl(value); updateAttributes(next ? { provider: next.provider, id: next.id } : { id: '' }); }} />
      <Field label="Caption (optional)" value={str(node.attrs.caption)} onChange={(value) => updateAttributes({ caption: value })} maxLength={240} />
    </div>
    <div className="eb-flags">{!valid ? <Flag>Paste a YouTube, Vimeo or Instagram link</Flag> : null}</div>
  </NodeViewWrapper>;
}
export const GuideVideo = Node.create({
  name: 'guideVideo',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { provider: { default: 'youtube' }, id: { default: '' }, caption: { default: '' } }; },
  parseHTML() { return [{ tag: 'figure[data-guide-video]' }]; },
  renderHTML() { return ['figure', { 'data-guide-video': '' }]; },
  addNodeView() { return ReactNodeViewRenderer(VideoView); },
});

/* ---------- Button / banner ---------- */
function ButtonView({ node, updateAttributes, selected }: NodeViewProps) {
  const a = node.attrs as Record<string, unknown>;
  const banner = a.variant !== 'button';
  const label = str(a.label); const href = str(a.href);
  return <NodeViewWrapper className={`eb-card eb-button${selected ? ' is-selected' : ''}`} contentEditable={false}>
    <div className={banner ? 'eb-cta' : 'eb-cta eb-cta--plain'}>
      {banner ? <div><b>{str(a.title) || 'Banner title'}</b><span>{str(a.text) || 'A line of supporting text.'}</span></div> : null}
      <i>{label || 'Button label'}</i>
    </div>
    <div className="eb-fields eb-fields--2">
      <Field label="Label" value={label} onChange={(value) => updateAttributes({ label: value })} maxLength={60} invalid={!label.trim()} />
      <Field label="Link" value={href} onChange={(value) => updateAttributes({ href: value })} placeholder="/signup" invalid={!isButtonHref(href)} hint="https:// or a Mova page like /signup" />
      {banner ? <Field label="Banner title" value={str(a.title)} onChange={(value) => updateAttributes({ title: value })} maxLength={120} /> : null}
      {banner ? <Field label="Banner text" value={str(a.text)} onChange={(value) => updateAttributes({ text: value })} maxLength={240} /> : null}
    </div>
    <div className="eb-seg" role="radiogroup" aria-label="Button style">
      <button type="button" role="radio" aria-checked={banner} onClick={() => updateAttributes({ variant: 'banner' })}>Banner</button>
      <button type="button" role="radio" aria-checked={!banner} onClick={() => updateAttributes({ variant: 'button' })}>Button only</button>
    </div>
    <div className="eb-flags">{!label.trim() ? <Flag>Add a label</Flag> : null}{!isButtonHref(href) ? <Flag>Use an https:// link or a Mova page</Flag> : null}</div>
  </NodeViewWrapper>;
}
export const GuideButton = Node.create({
  name: 'guideButton',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { label: { default: 'Start free' }, href: { default: '/signup' }, variant: { default: 'banner' }, title: { default: '' }, text: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-guide-button]' }]; },
  renderHTML() { return ['div', { 'data-guide-button': '' }]; },
  addNodeView() { return ReactNodeViewRenderer(ButtonView); },
});

/* ---------- FAQ ---------- */
function FaqView({ editor, node, getPos }: NodeViewProps) {
  const add = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const end = pos + node.nodeSize - 1;
    editor.chain().insertContentAt(end, { type: 'faqItem', content: [{ type: 'faqQuestion' }, { type: 'faqAnswer' }] })
      .command(({ tr }) => { tr.setSelection(TextSelection.create(tr.doc, end + 2)); return true; }).focus().run();
  };
  return <NodeViewWrapper className="eb-faq">
    <NodeViewContent />
    <button type="button" contentEditable={false} className="eb-faq-add" onClick={add}><EdIcon name="plus" size={15} /> Add a question</button>
  </NodeViewWrapper>;
}
export const Faq = Node.create({
  name: 'faq',
  group: 'block',
  content: 'faqItem+',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-faq]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-faq': '' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(FaqView); },
});
export const FaqItem = Node.create({
  name: 'faqItem',
  content: 'faqQuestion faqAnswer',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-faq-item]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-faq-item': '', class: 'eb-faq-item' }), 0]; },
});
export const FaqQuestion = Node.create({
  name: 'faqQuestion',
  content: 'text*',
  marks: '',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-faq-q]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-faq-q': '', class: 'eb-faq-q' }), 0]; },
  addKeyboardShortcuts() {
    return {
      // Enter in a question moves to its answer.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== 'faqQuestion') return false;
        const answerStart = $from.after() + 1;
        return editor.commands.setTextSelection(answerStart);
      },
    };
  },
});
export const FaqAnswer = Node.create({
  name: 'faqAnswer',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-faq-a]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-faq-a': '', class: 'eb-faq-a' }), 0]; },
  addKeyboardShortcuts() {
    return {
      // Enter at the end of an answer starts the next question.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if ($from.parent.type.name !== 'faqAnswer' || !empty || $from.parentOffset !== $from.parent.content.size) return false;
        const itemEnd = $from.after($from.depth - 1);
        return editor.chain().insertContentAt(itemEnd, { type: 'faqItem', content: [{ type: 'faqQuestion' }, { type: 'faqAnswer' }] })
          .setTextSelection(itemEnd + 2).run();
      },
    };
  },
});

export const GUIDE_NODES = [Callout, Takeaways, GuideImage, BeforeAfter, GuideVideo, GuideButton, Faq, FaqItem, FaqQuestion, FaqAnswer];
