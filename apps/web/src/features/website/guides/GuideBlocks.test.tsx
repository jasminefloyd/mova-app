import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { GuideBlocks, faqLd, videoEmbedUrl } from './GuideBlocks';
import type { Block } from './guide-types';

// A13·v2 blocks on the public guide page.
const blocks: Block[] = [
  { type: 'takeaways', items: [[{ text: 'Price the time first.' }]] },
  { type: 'button', label: 'Start free', href: '/signup', variant: 'banner', title: 'Know what salons charge', text: 'Free for 30 days.' },
  { type: 'button', label: 'Bad', href: 'javascript:alert(1)', variant: 'button' },
  { type: 'before_after', before: { url: 'https://img.example/b.jpg', alt: 'Before the retwist' }, after: { url: 'https://img.example/a.jpg', alt: 'After the retwist' } },
  { type: 'video', provider: 'youtube', id: 'dQw4w9WgXcQ', caption: 'Watch it' },
  { type: 'table', header: true, rows: [['Length', 'Price'], ['Shoulder', '$95']] },
  { type: 'faq', items: [{ question: 'How long?', answer: [{ text: 'Two to three hours.' }] }] },
];
const html = renderToStaticMarkup(<MemoryRouter><GuideBlocks blocks={blocks} /></MemoryRouter>);

describe('guide blocks', () => {
  it('renders the new blocks as plain elements', () => {
    expect(html).toContain('Key takeaways');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('alt="Before the retwist"');
    expect(html).toContain('<th scope="col">Length</th>');
    expect(html).toContain('<summary>How long?</summary>');
  });

  it('loads no video until the reader taps play', () => {
    expect(html).not.toContain('<iframe');
    expect(html).toContain('aria-label="Play Watch it"');
    expect(videoEmbedUrl('youtube', 'dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    expect(videoEmbedUrl('vimeo', '76979871')).toBe('https://player.vimeo.com/video/76979871?autoplay=1&dnt=1');
    expect(videoEmbedUrl('youtube', '"><x')).toBeNull();
  });

  it('describes FAQ blocks for search engines', () => {
    expect(faqLd(blocks)).toEqual({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'How long?', acceptedAnswer: { '@type': 'Answer', text: 'Two to three hours.' } }] });
    expect(faqLd([{ type: 'divider' }])).toBeNull();
  });
});
