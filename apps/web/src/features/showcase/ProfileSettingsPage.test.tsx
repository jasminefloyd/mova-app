import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { ProfileSettingsPage } from './ProfileSettingsPage';

const mocks = vi.hoisted(() => ({
  profile: { current: { display_name: 'Nia Flores', bio: 'Color specialist', specialties: ['Color'], handle: 'nia-flores', preferred_locale: 'en-US' as const, profile_photo_path: null as string | null } },
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
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
    mocks.profile.current = { display_name: 'Nia Flores', bio: 'Color specialist', specialties: ['Color'], handle: 'nia-flores', preferred_locale: 'en-US', profile_photo_path: null };
    mocks.maybeSingle.mockImplementation(async () => ({ data: mocks.profile.current, error: null }));
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
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
    mocks.rpc.mockImplementation(async (_name: string, payload: Record<string, unknown>) => {
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
      setValue(view.host.querySelector('.mova-inline-field input') as HTMLInputElement, 'Balayage');
    });
    act(() => { (Array.from(view.host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Add') as HTMLButtonElement).click(); });
    const fileInput = view.host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['synthetic image'], 'profile.png', { type: 'image/png' })] });
    act(() => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitFor(() => view.host.querySelector('img[src="blob:profile-preview"]') !== null);

    await act(async () => {
      (view.host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => view.host.querySelector('[role="status"]')?.textContent === 'Profile updated.');

    expect(mocks.rpc).toHaveBeenCalledWith('mova_update_artist_profile', expect.objectContaining({
      p_artist_business_id: 'artist-a', p_display_name: 'Nia Updated', p_bio: 'Updated bio for clients.', p_specialties: ['Color', 'Balayage'],
    }));
    expect(mocks.functions.invoke).toHaveBeenCalledWith('photo-upload-url', expect.objectContaining({ body: { kind: 'profile', size: 15, contentType: 'image/png' } }));
    expect(mocks.uploadToSignedUrl).toHaveBeenCalled();
    expect(mocks.functions.invoke).toHaveBeenCalledWith('photo-process', expect.objectContaining({ body: { path: 'profile/profile-photo.png', kind: 'profile', zoom: 1 } }));
    expect(view.host.textContent).toContain('Updated bio for clients.');
    expect(view.host.textContent).toContain('Balayage');
    expect(view.host.querySelector('img')?.getAttribute('src')).toBe('https://images.mova.invalid/profile/profile-photo.png');
  });
});
