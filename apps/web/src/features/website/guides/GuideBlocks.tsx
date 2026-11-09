import { Fragment, type ReactNode } from 'react';
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
    default:
      return null;
  }
}

/** Renders stored article blocks as React elements only. Raw HTML never reaches the page. */
export function GuideBlocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, index) => <BlockView key={index} block={block} />)}</>;
}
