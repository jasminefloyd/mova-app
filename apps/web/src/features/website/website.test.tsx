import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18nReady } from '../../i18n';
import LandingPage from './LandingPage';
import PricingPage from './PricingPage';
import { GuideBlocks, safeHref } from './guides/GuideBlocks';
import { absoluteUrl, formatGuideDate, headingId } from './guides/guide-format';
import { sectionForPath } from './WebsiteNav';

const render = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe('public website', () => {
  beforeAll(async () => { await i18nReady; });

  it('landing sends every call to action to sign-up and has no waitlist', () => {
    const html = render(<LandingPage />);
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('/auth');
    expect(html).not.toContain('type="email"');
    expect(html.toLowerCase()).not.toContain('waitlist');
    expect(html.toLowerCase()).not.toContain('coming soon');
    expect(html).toContain('Start free');
  });

  it('pricing shows $0, $19 and $39 with no proposed-pricing badge', () => {
    const html = render(<PricingPage />);
    expect(html).toContain('$0');
    expect(html).toContain('$19');
    expect(html).toContain('$39');
    expect(html.toLowerCase()).not.toContain('proposed');
    expect(html.match(/href="\/signup"/g)).toHaveLength(3);
  });

  it('nav marks the current section and points sign-in at /login', () => {
    expect(sectionForPath('/guides/some-post')).toBe('guides');
    expect(sectionForPath('/pricing')).toBe('pricing');
    expect(sectionForPath('/')).toBeNull();
  });
});

describe('guide body rendering', () => {
  it('renders contract blocks as elements and never as raw HTML', () => {
    const html = renderToStaticMarkup(<MemoryRouter>
      <GuideBlocks blocks={[
        { type: 'heading', level: 2, text: 'The client remembers' },
        { type: 'paragraph', content: [{ text: 'Plain ' }, { text: 'bold', bold: true }, { text: ' and a ' }, { text: 'link', href: 'https://mova.example/x' }] },
        { type: 'paragraph', content: [{ text: '<img src=x onerror=alert(1)>' }] },
        { type: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] },
        { type: 'quote', content: [{ text: 'Quoted' }], cite: 'Source' },
        { type: 'callout', tone: 'tip', content: [{ text: 'Tip text' }] },
        { type: 'divider' },
      ]} />
    </MemoryRouter>);
    expect(html).toContain('<h2 id="the-client-remembers">The client remembers</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://mova.example/x" rel="noopener noreferrer"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<cite>Source</cite>');
    expect(html).toContain('mova-site__callout--tip');
    expect(html).toContain('<hr/>');
  });

  it('drops unsafe hrefs and image sources even if they reach the client', () => {
    const html = renderToStaticMarkup(<MemoryRouter>
      <GuideBlocks blocks={[
        { type: 'paragraph', content: [{ text: 'bad', href: 'javascript:alert(1)' }] },
        { type: 'image', url: 'data:text/html,hi', alt: 'nope' },
      ]} />
    </MemoryRouter>);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<img');
  });

  it('safeHref accepts http(s), site paths and fragments only', () => {
    expect(safeHref('https://a.example')).toBe('https://a.example');
    expect(safeHref('/guides/x')).toBe('/guides/x');
    expect(safeHref('#top')).toBe('#top');
    expect(safeHref('//evil.example')).toBeUndefined();
    expect(safeHref('mailto:x@example.com')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe('guide helpers', () => {
  it('formats dates in UTC for both locales', () => {
    expect(formatGuideDate('2026-11-05T00:00:00Z', 'en-US')).toBe('Nov 5, 2026');
    expect(formatGuideDate('2026-11-05T00:00:00Z', 'es-US')).toMatch(/nov/i);
    expect(formatGuideDate('nope', 'en-US')).toBe('');
  });

  it('builds absolute URLs from paths and keeps absolute ones', () => {
    expect(absoluteUrl('/media/x.jpg', 'https://mova-beauty.co/')).toBe('https://mova-beauty.co/media/x.jpg');
    expect(absoluteUrl('https://cdn.example/x.jpg', 'https://mova-beauty.co')).toBe('https://cdn.example/x.jpg');
  });

  it('makes stable heading ids', () => {
    expect(headingId("AI isn't what's making beauty less personal")).toBe('ai-isn-t-what-s-making-beauty-less-personal');
    expect(headingId('Ñandú & más')).toBe('nandu-mas');
    expect(headingId('!!!')).toBe('section');
  });
});
