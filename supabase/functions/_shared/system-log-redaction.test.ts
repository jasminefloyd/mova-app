import { describe, expect, it } from 'vitest';
import { redactSystemText, safeSystemContext } from './system-log-redaction.ts';

describe('system log privacy redaction', () => {
  it('masks emails, phone numbers, card-like numbers and known secret formats', () => {
    const text = redactSystemText('jasmine@example.com +1 (555) 214-0971 4242 4242 4242 4242 Bearer abc.def sk_live_123456 re_abcdefghijklmnop');
    expect(text).not.toMatch(/jasmine@example\.com|555\) 214|4242 4242|Bearer abc|sk_live_123456|re_abcdefghijklmnop/i);
    expect(text).toContain('[EMAIL]');
    expect(text).toContain('[PHONE]');
    expect(text).toContain('[CARD]');
    expect(text).toContain('[REDACTED]');
  });

  it('drops message bodies, notes, arbitrary keys and nested payloads from context', () => {
    const context = safeSystemContext({ route: '/admin/logs', body: 'private message', client_note: 'allergy details', token: 'secret', nested: { email: 'jasmine@example.com' }, app_version: '1.2.3' });
    expect(context).toEqual({ route: '/admin/logs', app_version: '1.2.3' });
    expect(JSON.stringify(context)).not.toMatch(/private message|allergy|secret|jasmine@example/i);
  });

  it('keeps Price Pilot log metadata while dropping submitted menu URLs and extracted data', () => {
    const context = safeSystemContext({ action: 'import_menu', provider: 'firecrawl', outcome: 'completed', extraction_count: 12, submitted_url: 'https://salon.example/menu', service_name: 'Silk press', price: 150 });
    expect(context).toEqual({ action: 'import_menu', provider: 'firecrawl', outcome: 'completed', extraction_count: 12 });
    expect(JSON.stringify(context)).not.toMatch(/salon\.example|Silk press|150/);
  });
});
