import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Block, Inline } from './guide-types';
import { headingId } from './guide-format';

/** Second line of defense after the server's sanitizer: only http(s), site paths and fragments are rendered as links. */
export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const value = href.trim();
  if (value.startsWith('//')) return undefined;
  if (value.startsWith('/') || value.startsWith('#')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return undefined;
}

function isInternal(href: string) {
  return href.startsWith('/') || href.startsWith('#');
}

function InlineContent({ content }: { content: Inline[] }) {
  return <>{content.map((inline, index) => {
    let node: ReactNode = inline.text;
    if (inline.italic) node = <em>{node}</em>;
    if (inline.bold) node = <strong>{node}</strong>;
    const href = safeHref(inline.href);
    if (href && isInternal(href)) return <Fragment key={index}><Link to={href}>{node}</Link></Fragment>;
    if (href) return <Fragment key={index}><a href={href} rel="noopener noreferrer">{node}</a></Fragment>;
    return <Fragment key={index}>{node}</Fragment>;
  })}</>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const id = block.id ?? headingId(block.text);
      return block.level === 3 ? <h3 id={id}>{block.text}</h3> : <h2 id={id}>{block.text}</h2>;
    }
    case 'paragraph':
      return <p><InlineContent content={block.content} /></p>;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}><InlineContent content={item} /></li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'quote':
      return <blockquote><p><InlineContent content={block.content} /></p>{block.cite && <cite>{block.cite}</cite>}</blockquote>;
    case 'image':
      if (!safeHref(block.url)) return null;
      return <figure><img src={block.url} alt={block.alt} loading="lazy" decoding="async" />{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
    case 'callout':
      return <div className={`mova-site__callout mova-site__callout--${block.tone}`}><p><InlineContent content={block.content} /></p></div>;
    case 'divider':
      return <hr />;
    case 'takeaways':
      return <aside className="mova-site__takeaways" aria-label="Key takeaways"><strong>Key takeaways</strong><ul>{block.items.map((item, index) => <li key={index}><InlineContent content={item} /></li>)}</ul></aside>;
    case 'button': {
      const href = safeHref(block.href);
      if (!href) return null;
      const link = isInternal(href) ? <Link className="mova-site__button" to={href}>{block.label}</Link> : <a className="mova-site__button" href={href} rel="noopener noreferrer">{block.label}</a>;
      if (block.variant !== 'banner') return <p className="mova-site__guide-button">{link}</p>;
      return <div className="mova-site__guide-banner"><div>{block.title && <strong>{block.title}</strong>}{block.text && <span>{block.text}</span>}</div>{link}</div>;
    }
    case 'before_after':
      if (!safeHref(block.before.url) || !safeHref(block.after.url)) return null;
      return <figure className="mova-site__before-after">
        <div><span><img src={block.before.url} alt={block.before.alt} loading="lazy" decoding="async" /><b>Before</b></span><span><img src={block.after.url} alt={block.after.alt} loading="lazy" decoding="async" /><b>After</b></span></div>
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>;
    case 'video':
      return <VideoEmbed provider={block.provider} id={block.id} caption={block.caption} />;
    case 'table': {
      const [first, ...rest] = block.rows;
      const head = block.header ? first : undefined;
      const body = block.header ? rest : block.rows;
      return <div className="mova-site__guide-table"><table>
        {head && <thead><tr>{head.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr></thead>}
        <tbody>{body.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody>
      </table></div>;
    }
    case 'faq':
      return <div className="mova-site__faq mova-site__guide-faq">{block.items.map((item, index) => <details key={index}><summary>{item.question}</summary><p><InlineContent content={item.answer} /></p></details>)}</div>;
    default:
      return null;
  }
}

const VIDEO_ID = { youtube: /^[A-Za-z0-9_-]{11}$/, vimeo: /^[0-9]{6,12}$/, instagram: /^[A-Za-z0-9_-]{5,40}$/ } as const;
const VIDEO_NAME = { youtube: 'YouTube', vimeo: 'Vimeo', instagram: 'Instagram' } as const;

/** The player is only loaded when the reader taps play, so nothing is sent to the video site before that. */
export function videoEmbedUrl(provider: keyof typeof VIDEO_ID, id: string): string | null {
  if (!VIDEO_ID[provider]?.test(id)) return null;
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  if (provider === 'vimeo') return `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1`;
  return `https://www.instagram.com/p/${id}/embed`;
}

function VideoEmbed({ provider, id, caption }: { provider: keyof typeof VIDEO_ID; id: string; caption?: string | undefined }) {
  const [playing, setPlaying] = useState(false);
  const src = videoEmbedUrl(provider, id);
  if (!src) return null;
  const label = caption || `${VIDEO_NAME[provider]} video`;
  return <figure className="mova-site__video" data-provider={provider}>
    <div className="mova-site__video-frame">
      {playing
        ? <iframe src={src} title={label} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        : <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${label}`}><span aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" /></svg></span><small>Plays from {VIDEO_NAME[provider]}</small></button>}
    </div>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}

/** FAQ blocks as schema.org FAQPage, so search engines can show the questions. */
export function faqLd(blocks: Block[]) {
  const items = blocks.flatMap((block) => (block.type === 'faq' ? block.items : []));
  if (!items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer.map((run) => run.text).join('') } })),
  };
}

/** Renders stored article blocks as React elements only. Raw HTML never reaches the page. */
export function GuideBlocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, index) => <BlockView key={index} block={block} />)}</>;
}
