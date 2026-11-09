import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18nReady } from '../../i18n';
import MarketingHome from './MarketingHome';

describe('temporary public landing page', () => {
  beforeAll(async () => { await i18nReady; });

  it('links sign-in to /login and sign-up to /signup, and keeps the walkthrough', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MarketingHome /></MemoryRouter>);
    expect(html.match(/href="\/login"/g)).toHaveLength(1);
    expect(html.match(/href="\/signup"/g)).toHaveLength(3);
    expect(html).not.toContain('href="/auth"');
    expect(html).toContain('Your business moves with you.');
    expect(html).toContain('/media/Mova_Loop_40s.mp4');
  });

  it('has no waitlist form or email collection, and leaves legal links non-interactive', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MarketingHome /></MemoryRouter>);
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('waitlist');
    expect(html).toContain('aria-disabled="true">Privacy policy');
    expect(html).toContain('aria-disabled="true">Terms');
  });
});
