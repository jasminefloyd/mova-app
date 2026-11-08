import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { HCaptcha } from './HCaptcha';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('HCaptcha (O1)', () => {
  afterEach(() => { delete window.hcaptcha; document.body.innerHTML = ''; });

  it('renders nothing and loads no script without a site key', () => {
    const host = document.createElement('div'); document.body.append(host);
    act(() => createRoot(host).render(<HCaptcha siteKey={null} locale="en-US" onToken={() => {}} />));
    expect(host.innerHTML).toBe('');
    expect(document.querySelector('script[src*="hcaptcha"]')).toBeNull();
  });

  it('renders the widget with the site key, passes tokens on, and clears them on reset', async () => {
    const calls: { sitekey?: unknown; resets: number } = { resets: 0 };
    let solve: (token: string) => void = () => {};
    window.hcaptcha = {
      render: (_el, options) => { calls.sitekey = options.sitekey; solve = options.callback as (token: string) => void; return 'w1'; },
      reset: () => { calls.resets += 1; },
      remove: () => {},
    };
    const tokens: Array<string | null> = [];
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<HCaptcha siteKey="10000000-ffff-ffff-ffff-000000000001" locale="es-US" onToken={(t) => tokens.push(t)} resetKey={0} />));
    expect(calls.sitekey).toBe('10000000-ffff-ffff-ffff-000000000001');
    act(() => solve('P1_token'));
    await act(async () => root.render(<HCaptcha siteKey="10000000-ffff-ffff-ffff-000000000001" locale="es-US" onToken={(t) => tokens.push(t)} resetKey={1} />));
    expect(tokens).toEqual(['P1_token', null]);
    expect(calls.resets).toBe(1);
  });
});
