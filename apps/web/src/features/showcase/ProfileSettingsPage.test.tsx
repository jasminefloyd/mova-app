import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { ProfileSettingsPage } from './ProfileSettingsPage';

const mocks = vi.hoisted(() => ({
  profile: { current: { display_name: 'Nia Flores', bio: 'Color specialist', specialties: ['Color'], handle: 'nia-flores', preferred_locale: 'en-US' as const, profile_photo_path: null as string | null, cover_photo_path: null as string | null } },
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(),
  storage: { from: vi.fn() }, createSignedUrl: vi.fn(), uploadToSignedUrl: vi.fn(),
  functions: { invoke: vi.fn() }, rpc: vi.fn(),
}));

vi.mock('../settings/useArtistBusiness', () => ({
  useArtistBusiness: () => ({ client: mocks, businessId: 'artist-a', loading: false }),
}));

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(<MemoryRouter><ProfileSettingsPage /></MemoryRouter>);
  });
  return { host, root: root! };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  throw new Error(`Timed out waiting for profile settings: ${document.body.textContent} (RPC calls: ${mocks.rpc.mock.calls.length})`);
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('profile settings edit', () => {
  let mounted: Array<{ host: HTMLDivElement; root: Root }> = [];
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeAll(async () => { await i18nReady; });
  beforeEach(() => {
    mocks.profile.current = { display_name: 'Nia Flores', bio: 'Color specialist', specialties: ['Color'], handle: 'nia-flores', preferred_locale: 'en-US', profile_photo_path: null, cover_photo_path: null, contact_phone: '+1 404 555 0100', contact_email: 'nia@example.com', website_url: null, social_links: {} };
    mocks.maybeSingle.mockImplementation(async () => ({ data: mocks.profile.current, error: null }));
    mocks.order.mockResolvedValue({ data: [], error: null });
    mocks.eq.mockReturnValue({ eq: mocks.eq, maybeSingle: mocks.maybeSingle, order: mocks.order });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.createSignedUrl.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://images.mova.invalid/${path}` }, error: null }));
    mocks.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
    mocks.storage.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl, uploadToSignedUrl: mocks.uploadToSignedUrl });
    mocks.functions.invoke.mockImplementation(async (name: string) => {
      if (name === 'photo-upload-url') return { data: { data: { path: 'profile/profile-photo.png', token: 'synthetic-upload-token', bucket: 'mova_profile_photos' } }, error: null };
      mocks.profile.current.profile_photo_path = 'profile/profile-photo.png';
      return { data: { data: { processed: true } }, error: null };
    });
    mocks.rpc.mockImplementation(async (name: string, payload: Record<string, unknown>) => {
      if (name === 'mova_update_artist_contact') {
        mocks.profile.current = { ...mocks.profile.current, contact_phone: String(payload.p_contact_phone), contact_email: String(payload.p_contact_email), website_url: payload.p_website_url ? String(payload.p_website_url) : null, social_links: payload.p_social_links as Record<string, string> };
        return { data: [{ handle: 'nia-flores' }], error: null };
      }
      mocks.profile.current = { ...mocks.profile.current, display_name: String(payload.p_display_name), bio: String(payload.p_bio), specialties: payload.p_specialties as string[] };
      return { data: [], error: null };
    });
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = (() => 'blob:profile-preview') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  });
  afterEach(() => {
    act(() => { mounted.forEach(({ root }) => root.unmount()); });
    mounted.forEach(({ host }) => host.remove());
    mounted = [];
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('TC-F01-PROFILE-01 edits public fields and photo through the owner-scoped save path', async () => {
    const view = mount();
    mounted.push(view);
    await waitFor(() => view.host.querySelector('.mova-form-stack input:not([type="file"])') !== null);

    act(() => {
      setValue(view.host.querySelector('.mova-form-stack input:not([type="file"])') as HTMLInputElement, 'Nia Updated');
      setValue(view.host.querySelector('textarea') as HTMLTextAreaElement, 'Updated bio for clients.');
    });
    act(() => { (Array.from(view.host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Braids') as HTMLButtonElement).click(); });
    const fileInput = view.host.querySelector('.mova-profile-edit__photo-button input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['synthetic image'], 'profile.png', { type: 'image/png' })] });
    act(() => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitFor(() => view.host.querySelector('img[src="blob:profile-preview"]') !== null);

    await act(async () => {
      (view.host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => view.host.querySelector('[role="status"]')?.textContent === 'Profile updated.');

    expect(mocks.rpc).toHaveBeenCalledWith('mova_update_artist_profile', expect.objectContaining({
      p_artist_business_id: 'artist-a', p_display_name: 'Nia Updated', p_bio: 'Updated bio for clients.', p_specialties: ['Color', 'Braids'],
    }));
    expect(mocks.rpc).toHaveBeenCalledWith('mova_update_artist_contact', expect.objectContaining({ p_artist_business_id: 'artist-a', p_contact_phone: '+1 404 555 0100', p_contact_email: 'nia@example.com', p_social_links: {} }));
    expect(mocks.functions.invoke).toHaveBeenCalledWith('photo-upload-url', expect.objectContaining({ body: expect.objectContaining({ kind: 'profile', size: 15, contentType: 'image/png', artist_business_id: 'artist-a' }) }));
    expect(mocks.uploadToSignedUrl).toHaveBeenCalled();
    expect(mocks.functions.invoke).toHaveBeenCalledWith('photo-process', expect.objectContaining({ body: { path: 'profile/profile-photo.png', kind: 'profile', zoom: 1 } }));
    expect(view.host.textContent).toContain('Updated bio for clients.');
    expect(Array.from(view.host.querySelectorAll('.mova-chip.is-selected')).map((chip) => chip.textContent)).toEqual(['Color', 'Braids']);
    expect(view.host.querySelector('.mova-profile-edit__avatar img')?.getAttribute('src')).toBe('https://images.mova.invalid/profile/profile-photo.png');
  });
  it('TC-F01-CONTACT-01 requires phone and email, and sends only the social links the stylist entered', async () => {
    const view = mount();
    mounted.push(view);
    await waitFor(() => view.host.querySelector('.mova-profile-edit__contact') !== null);
    const submit = () => view.host.querySelector('form button[type="submit"]') as HTMLButtonElement;
    const phone = () => view.host.querySelector('.mova-profile-edit__contact input[type="tel"]') as HTMLInputElement;
    expect(submit().disabled).toBe(true);

    act(() => { setValue(phone(), ''); });
    expect(submit().disabled).toBe(true);
    act(() => { setValue(phone(), '+1 404 555 0111'); });
    act(() => { setValue(view.host.querySelector('.mova-profile-edit__contact input[type="url"]') as HTMLInputElement, 'https://nia.example'); });
    const instagram = Array.from(view.host.querySelectorAll('.mova-profile-edit__contact input[type="url"]'))[1] as HTMLInputElement;
    act(() => { setValue(instagram, 'https://instagram.com/nia.flores'); });
    expect(submit().disabled).toBe(false);

    await act(async () => {
      (view.host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => view.host.querySelector('[role="status"]')?.textContent === 'Profile updated.');
    expect(mocks.rpc).toHaveBeenCalledWith('mova_update_artist_contact', expect.objectContaining({
      p_contact_phone: '+1 404 555 0111', p_website_url: 'https://nia.example', p_social_links: { instagram: 'https://instagram.com/nia.flores' },
    }));
  });
});
