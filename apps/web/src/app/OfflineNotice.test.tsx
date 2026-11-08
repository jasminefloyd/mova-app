import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { i18nReady } from '../i18n';
import { OfflineNotice } from './OfflineNotice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('OfflineNotice (TC-STATE-OFFLINE-01)', () => {
  beforeAll(async () => { await i18nReady; });

  it('shows while the browser is offline and hides when it reconnects', () => {
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<OfflineNotice />));
    expect(host.querySelector('[role="status"]')).toBeNull();

    online = false;
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('You appear to be offline.');

    online = true;
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.unmount());
  });
});
