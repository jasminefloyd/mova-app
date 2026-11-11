import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18nReady } from '../../i18n';
import { PublicArtistPage } from './PublicArtistPage';

const artist = {
  profile: {
    display_name: 'Nia Flores', handle: 'nia-flores', specialties: ['Color'], bio: 'Color specialist',
    preferred_locale: 'en-US', search_index_enabled: true, photo_urls: {},
  },
  services: [{ id: 'svc-1', name: 'Signature color', category: 'Color', duration_minutes: 90, base_price_minor: 12000, deposit_type: 'fixed' as const, deposit_value: 2500, location_deposits: [{location_id:'loc-1',price_minor:12000,duration_minutes:90,deposit_amount_minor:2500}] }],
  locations: [{id:'loc-1',name:'North studio',booking_mode:'request' as const,time_zone:'America/New_York'}],
  looks: [], bookable: true,
};

function renderPublicPage(path: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/a/:handle" element={<PublicArtistPage initialArtist={artist} />} />
  </Routes></MemoryRouter>);
}

describe('public artist server rendering', () => {
  beforeAll(async () => { await i18nReady; });
  it('TC-F04-DEP-03 renders deposit booking guidance without an online booking CTA', () => {
    const html = renderPublicPage('/a/nia-flores');
    expect(html).toContain('Nia Flores');
    expect(html).toContain('Color specialist');
    expect(html).toContain('Signature color');
    expect(html).toContain('1 h 30 min · $25.00 deposit at North studio');
    expect(html).toContain('Online booking is unavailable for this service');
    expect(html).not.toContain('role="status">Loading');
    expect(html).not.toContain('Book now');
  });

  it('TC-F13-V1-02 uses the requested UI locale while retaining artist-authored content', () => {
    const html = renderPublicPage('/a/nia-flores?locale=es-US&tab=services');
    expect(html).toContain('lang="es-US"');
    expect(html).toContain('Servicios');
    expect(html).toContain('Signature color');
  });
});
