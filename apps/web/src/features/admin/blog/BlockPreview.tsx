import type { Block, InlineRun } from './blog-model';

function Runs({ runs }: { runs: InlineRun[] }) {
  return <>{runs.map((run, i) => {
    let node: React.ReactNode = run.text;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    if (run.href) node = <a href={run.href} target="_blank" rel="noopener noreferrer">{node}</a>;
    return <span key={i}>{node}</span>;
  })}</>;
}

/** Quick preview of the body as readers will see it, using the same block types. */
export function BlockPreview({ blocks }: { blocks: Block[] }) {
  return <article className="preview">
    {blocks.map((block, index) => {
      switch (block.type) {
        case 'heading': return block.level === 3 ? <h3 key={index}>{block.text}</h3> : <h2 key={index}>{block.text}</h2>;
        case 'paragraph': return <p key={index}><Runs runs={block.content} /></p>;
        case 'list': {
          const Tag = block.ordered ? 'ol' : 'ul';
          return <Tag key={index}>{block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}</Tag>;
        }
        case 'quote': return <blockquote key={index}><Runs runs={block.content} />{block.cite ? <cite> {block.cite}</cite> : null}</blockquote>;
        case 'image': return <figure key={index}>{block.url.startsWith('https://') ? <img src={block.url} alt={block.alt} style={{ maxWidth: '100%', borderRadius: 12 }} /> : <div className="cover" role="img" aria-label={block.alt} />}{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
        case 'callout': return <aside key={index} className={`tag ${block.tone}`}><Runs runs={block.content} /></aside>;
        case 'divider': return <hr key={index} />;
        case 'takeaways': return <aside key={index} className="eb-take"><b>Key takeaways</b><ul>{block.items.map((item, i) => <li key={i}><Runs runs={item} /></li>)}</ul></aside>;
        case 'button': return <div key={index} className={block.variant === 'banner' ? 'eb-cta' : 'eb-cta eb-cta--plain'}>{block.variant === 'banner' ? <div><b>{block.title}</b><span>{block.text}</span></div> : null}<i>{block.label}</i></div>;
        case 'before_after': return <figure key={index} className="eb-ba-grid">{[block.before, block.after].map((photo, i) => <span key={i} className="eb-ba-img">{photo.url.startsWith('https://') ? <img src={photo.url} alt={photo.alt} /> : null}<b>{i ? 'After' : 'Before'}</b></span>)}{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
        case 'video': return <figure key={index}><div className="eb-vd"><span className="eb-vd-play">▶</span><small>{block.provider} video</small></div>{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
        case 'table': return <table key={index}><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => (block.header && r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}</tr>)}</tbody></table>;
        case 'faq': return <div key={index} className="eb-faq">{block.items.map((item, i) => <details key={i} className="eb-faq-item" open><summary className="eb-faq-q">{item.question}</summary><p className="eb-faq-a"><Runs runs={item.answer} /></p></details>)}</div>;
      }
    })}
  </article>;
}
