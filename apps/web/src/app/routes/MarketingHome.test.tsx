import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18nReady } from '../../i18n';
import MarketingHome from './MarketingHome';

describe('temporary public landing page', () => {
  beforeAll(async () => { await i18nReady; });

  it('renders both account actions to /auth and the supplied walkthrough', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MarketingHome /></MemoryRouter>);
    expect(html.match(/href="\/auth"/g)).toHaveLength(2);
    expect(html).toContain('Your business moves with you.');
    expect(html).toContain('/media/Mova_Loop_40s.mp4');
    expect(html).toContain('Join the waitlist');
  });

  it('keeps waitlist collection closed by default and leaves legal links non-interactive', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MarketingHome /></MemoryRouter>);
    expect(html).not.toContain('type="email"');
    expect(html).toContain("Early access registration isn&#x27;t open yet.");
    expect(html).toContain('aria-disabled="true">Privacy policy');
    expect(html).toContain('aria-disabled="true">Terms');
  });
});
