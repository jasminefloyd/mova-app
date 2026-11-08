import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../app/LocaleProvider';
import { i18nReady } from '../../i18n';
import { HomeNeedsSection } from './HomeAppointments';

const now = Date.parse('2026-11-07T12:00:00.000Z');
const locations = new Map([['loc-1', { id: 'loc-1', name: 'Rooted Studio', time_zone: 'America/New_York', display_color_index: 0 }]]);

function renderNeeds() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LocaleProvider storageKey="mova-home-needs-test">
        <HomeNeedsSection
          businessId="BID-1"
          now={now}
          locationById={locations}
          needsYou={[{ id: 'booking-1', appointment_number: 12, location_id: 'loc-1', service_name_snapshot: 'Silk Press', client_name: 'Taylor Client', status: 'pending_artist', starts_at: '2026-11-09T15:00:00.000Z', ends_at: '2026-11-09T16:00:00.000Z', request_expires_at: '2026-11-08T12:00:00.000Z' }]}
          quoteNeeds={[{ id: 'quote-1', conversation_id: 'conversation-1', service_category: 'Color correction', created_at: '2026-11-07T11:00:00.000Z' }]}
          slotNeeds={[{ id: 'slot-1', location_id: 'loc-1', starts_at: '2026-11-10T15:00:00.000Z' }]}
        />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('Home needs-you items', () => {
  beforeAll(async () => { await i18nReady; });

  it('TC-SCR-07-01 renders booking, quote, and slot approval rows', () => {
    const markup = renderNeeds();
    expect(markup).toContain('Needs you · 3');
    expect(markup).toContain('Booking request · Taylor Client');
    expect(markup).toContain('Quote request');
    expect(markup).toContain('Color correction');
    expect(markup).toContain('Open slot needs approval');
    expect(markup).toContain('/BID-1/appointments/AID-12');
    expect(markup).toContain('/BID-1/growth/concierge/conversation-1');
    expect(markup).toContain('/BID-1/growth/slots');
  });
});
