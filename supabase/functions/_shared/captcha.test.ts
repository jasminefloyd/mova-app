import { describe, expect, it } from 'vitest';
import { checkCaptcha, HCAPTCHA_VERIFY_URL } from './captcha';

const on = (extra: Record<string, string> = {}) => (name: string) => ({ MOVA_CAPTCHA_PROVIDER: 'hcaptcha', HCAPTCHA_SECRET: '0xsecret', HCAPTCHA_SITE_KEY: 'site-key-1', ...extra } as Record<string, string>)[name];
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const token = 'P1_token-from-widget';

describe('checkCaptcha (O1 hCaptcha)', () => {
  it('is skipped while the provider is off', async () => {
    let called = false;
    expect(await checkCaptcha(undefined, () => undefined, async () => { called = true; return new Response('{}'); })).toEqual({ ok: true });
    expect(called).toBe(false);
  });
  it('fails closed when switched on without keys', async () => {
    expect(await checkCaptcha(token, on({ HCAPTCHA_SECRET: '' }), reply({ success: true }))).toMatchObject({ ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' });
  });
  it('requires a token', async () => {
    expect(await checkCaptcha('', on(), reply({ success: true }))).toMatchObject({ ok: false, status: 403, code: 'CAPTCHA_REQUIRED' });
  });
  it('sends only the secret, token and site key, and accepts a success', async () => {
    let sent: { url: string; body: string } | null = null;
    const result = await checkCaptcha(token, on(), async (url, init) => { sent = { url, body: String(init.body) }; return new Response(JSON.stringify({ success: true, sitekey: 'site-key-1' })); });
    expect(result).toEqual({ ok: true });
    expect(sent!.url).toBe(HCAPTCHA_VERIFY_URL);
    expect(Object.fromEntries(new URLSearchParams(sent!.body))).toEqual({ secret: '0xsecret', response: token, sitekey: 'site-key-1' });
  });
  it('rejects a failed check or a token for another site key', async () => {
    expect(await checkCaptcha(token, on(), reply({ success: false, 'error-codes': ['invalid-input-response'] }))).toMatchObject({ ok: false, status: 403, code: 'CAPTCHA_FAILED' });
    expect(await checkCaptcha(token, on(), reply({ success: true, sitekey: 'other' }))).toMatchObject({ ok: false, code: 'CAPTCHA_FAILED' });
  });
  it('reports hCaptcha outages as unavailable', async () => {
    expect(await checkCaptcha(token, on(), reply({}, 500))).toMatchObject({ ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' });
    expect(await checkCaptcha(token, on(), async () => { throw new Error('network'); })).toMatchObject({ ok: false, status: 503 });
  });
});
