import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { i18nReady } from '../../i18n';
import { WebChat } from './WebChat';

vi.mock('../../lib/env', async (original) => ({ ...(await original<typeof import('../../lib/env')>()), publicEnv: { VITE_SUPABASE_URL: 'https://api.mova.invalid' } }));

const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe('WebChat (task 5.4)', () => {
  beforeAll(async () => { await i18nReady; });
  it('sends a message on one thread and shows the assistant reply', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { reply: 'Free parking is behind the building.', needs_you: false } }), { status: 200 }); }));
    const host = document.createElement('div'); document.body.append(host);
    act(() => createRoot(host).render(<WebChat artistHandle="nia-flores" stylistName="Nia Flores" />));
    act(() => (host.querySelector('button') as HTMLButtonElement).click());
    expect(host.textContent).toContain('Booking assistant (AI) · Nia sees every chat');
    const input = host.querySelector('input') as HTMLInputElement;
    for (const text of ['Where do I park?', 'Thanks']) {
      act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
      await act(async () => { (host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      await flush();
    }
    expect(host.querySelector('[role="log"]')?.textContent).toContain('Free parking is behind the building.');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ artist_handle: 'nia-flores', message: 'Where do I park?', locale: 'en-US' });
    expect(bodies[0]!.thread_id).toBe(bodies[1]!.thread_id);
    vi.unstubAllGlobals(); host.remove();
  });
  it('shows an error when chat is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { code: 'CHAT_NOT_AVAILABLE' } }), { status: 503 })));
    const host = document.createElement('div'); document.body.append(host);
    act(() => createRoot(host).render(<WebChat artistHandle="nia-flores" stylistName="Nia Flores" />));
    act(() => (host.querySelector('button') as HTMLButtonElement).click());
    const input = host.querySelector('input') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Hi'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { (host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Chat is not available yet');
    vi.unstubAllGlobals(); host.remove();
  });
});
