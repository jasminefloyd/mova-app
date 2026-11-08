import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';

// Task 5.10: each client account action reaches customer-profile with the right action.
const mocks = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signOut: vi.fn(), calls: [] as Array<{ name: string; body: Record<string, unknown> }> }));
vi.mock('../../lib/env', async (original) => ({ ...(await original<typeof import('../../lib/env')>()), clientProfilesEnabled: true, publicEnv: { VITE_SUPABASE_URL: 'https://api.mova.invalid', VITE_SUPABASE_ANON_KEY: 'anon' } }));
vi.mock('../../lib/supabase', () => ({
  createMovaSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }), signInWithOtp: mocks.signInWithOtp, verifyOtp: mocks.verifyOtp, signOut: mocks.signOut } }),
}));
vi.mock('./QrCode', () => ({ QrCode: () => null }));

const { ClientProfilePage } = await import('./ClientProfilePage');
const profile = { profile: { display_name: 'Dana', preferred_locale: 'en-US', verified_contacts: [{ type: 'email', value: 'dana@example.invalid' }] }, stylists: [{ business_id: 'biz-1', name: 'Nia Flores', handle: 'nia-flores', consents: { appointment_updates: true, reminders: false, offers: false } }], upcoming: [] };

async function flush(times = 6) { for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
const button = (host: HTMLElement, text: string) => Array.from(host.ownerDocument.querySelectorAll('button')).find((item) => item.textContent?.trim() === text) as HTMLButtonElement;

describe('client account actions (5.10)', () => {
  let root: Root; let host: HTMLDivElement;
  beforeAll(async () => { await i18nReady; HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); }; });
  beforeEach(async () => {
    mocks.calls.length = 0;
    mocks.signInWithOtp.mockResolvedValue({ error: null }); mocks.verifyOtp.mockResolvedValue({ data: {}, error: null }); mocks.signOut.mockResolvedValue({ error: null });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const name = url.split('/').pop() ?? ''; const body = JSON.parse(String(init.body)); mocks.calls.push({ name, body });
      const data = body.action === 'profile' ? profile : body.action === 'claim-options' ? { options: [] } : body.action === 'export' ? { exported_at: 'now', profile: {} } : name === 'client-card-token' ? { url: '' } : { saved: true, deleted: true };
      return new Response(JSON.stringify({ data, error: null }), { status: 200 });
    }));
    URL.createObjectURL = (() => 'blob:x') as typeof URL.createObjectURL; URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    host = document.createElement('div'); document.body.append(host);
    act(() => { root = createRoot(host); root.render(<MemoryRouter><ClientProfilePage /></MemoryRouter>); });
    await flush();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it('TC-D11-ACTION-01 updates details', async () => {
    act(() => button(host, 'Edit details').click());
    const input = host.querySelector('.mova-client-profile__edit input') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Dana R.'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { (host.querySelector('.mova-client-profile__edit') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(mocks.calls.find((call) => call.body.action === 'update-profile')?.body).toMatchObject({ display_name: 'Dana R.', preferred_locale: 'en-US' });
  });

  it('TC-D11-ACTION-02 changes a consent', async () => {
    const toggle = Array.from(host.querySelectorAll<HTMLInputElement>('.mova-client-profile__consents input[role="switch"]'))[1]!;
    await act(async () => { toggle.click(); });
    await flush();
    expect(mocks.calls.find((call) => call.body.action === 'consent')?.body).toMatchObject({ business_id: 'biz-1', channel: 'sms', granted: true });
  });

  it('TC-D11-ACTION-03 downloads my data', async () => {
    await act(async () => { button(host, 'Download my data').click(); });
    await flush();
    expect(mocks.calls.some((call) => call.body.action === 'export')).toBe(true);
  });

  it('TC-D11-ACTION-04 deletes the profile after a verified code', async () => {
    await act(async () => { button(host, 'Delete profile').click(); });
    await act(async () => { button(host, 'Send verification code').click(); });
    await flush();
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: 'dana@example.invalid', options: { shouldCreateUser: false } });
    const code = host.ownerDocument.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(code, '123456'); code.dispatchEvent(new Event('input', { bubbles: true })); });
    const confirm = Array.from(host.ownerDocument.querySelectorAll('button')).filter((item) => item.textContent?.trim() === 'Delete profile').pop()!;
    await act(async () => { confirm.click(); });
    await flush();
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: 'dana@example.invalid', token: '123456', type: 'email' });
    expect(mocks.calls.some((call) => call.body.action === 'delete-profile')).toBe(true);
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
