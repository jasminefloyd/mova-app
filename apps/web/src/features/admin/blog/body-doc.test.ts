import { describe, expect, it } from 'vitest';
import type { Block } from './blog-model';
import { blocksToDoc, docToBlocks } from './body-doc';

// A13·v2: the editor document round-trips every stored block type without changing it.
const every: Block[] = [
  { type: 'heading', level: 2, text: 'Start with your time' },
  { type: 'heading', level: 3, text: 'Then length' },
  { type: 'paragraph', content: [{ text: 'A retwist takes ' }, { text: 'two to three hours', bold: true }, { text: '. See ' }, { text: 'PricePilot', href: '/features', italic: true }, { text: '.' }] },
  { type: 'list', ordered: true, items: [[{ text: 'Measure' }], [{ text: 'Add for length' }]] },
  { type: 'list', ordered: false, items: [[{ text: 'One' }]] },
  { type: 'quote', content: [{ text: 'Price the chair time.' }], cite: 'A stylist' },
  { type: 'image', url: 'https://img.example/a.jpg', alt: 'Retwist', caption: 'Mid-back' },
  { type: 'callout', tone: 'note', content: [{ text: 'Tell regulars first.' }] },
  { type: 'divider' },
  { type: 'takeaways', items: [[{ text: 'Price the time first.' }], [{ text: 'Add for length.' }]] },
  { type: 'button', label: 'Start free', href: '/signup', variant: 'banner', title: 'Know what salons charge', text: 'Free for 30 days.' },
  { type: 'button', label: 'Read more', href: 'https://mova-beauty.co/guides', variant: 'button' },
  { type: 'before_after', before: { url: 'https://img.example/b.jpg', alt: 'Before' }, after: { url: 'https://img.example/c.jpg', alt: 'After' }, caption: '2 h 40 min' },
  { type: 'video', provider: 'youtube', id: 'dQw4w9WgXcQ', caption: 'Watch it' },
  { type: 'table', header: true, rows: [['Length', 'Price'], ['Shoulder', '$95']] },
  { type: 'faq', items: [{ question: 'How long?', answer: [{ text: 'Two to three ' }, { text: 'hours', bold: true }] }] },
];

describe('guide body document', () => {
  it('round-trips every block type', () => {
    expect(docToBlocks(blocksToDoc(every))).toEqual(every);
  });

  it('starts an empty body with one empty paragraph and saves it as nothing', () => {
    const doc = blocksToDoc([]);
    expect(doc.content).toEqual([{ type: 'paragraph' }]);
    expect(docToBlocks(doc)).toEqual([]);
  });

  it('drops empty paragraphs, headings and list items, and joins runs with the same marks', () => {
    const blocks = docToBlocks({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there' }] },
      { type: 'paragraph' },
      { type: 'heading', attrs: { level: 2 }, content: [] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }] }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ] },
    ] });
    expect(blocks).toEqual([
      { type: 'paragraph', content: [{ text: 'Hi there' }] },
      { type: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'nested' }]] },
    ]);
  });

  it('keeps a table rectangular and reads the header row', () => {
    const blocks = docToBlocks({ type: 'doc', content: [{ type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph' }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
    ] }] });
    expect(blocks).toEqual([{ type: 'table', header: false, rows: [['a', ''], ['b', '']] }]);
  });

  it('leaves banner text off a plain button', () => {
    const blocks = docToBlocks({ type: 'doc', content: [{ type: 'guideButton', attrs: { label: 'Go', href: '/signup', variant: 'button', title: 'Left over', text: 'x' } }] });
    expect(blocks).toEqual([{ type: 'button', label: 'Go', href: '/signup', variant: 'button' }]);
  });
});
