import { useCallback, useEffect, useState } from 'react';
import type { createMovaSupabaseClient } from '../lib/supabase';
import { isIOSBrowser } from './device';

type Client = ReturnType<typeof createMovaSupabaseClient>;

/**
 * Push on this device:
 * - unsupported: the browser has no web push
 * - install-needed: iPhone in Safari (push only reaches the Home Screen app)
 * - unavailable: push isn't configured on the server yet
 * - blocked: the stylist denied notifications for this site in the browser
 * - off: allowed or not yet asked, but this device isn't subscribed
 * - on: subscribed and allowed
 */
export type PushDeviceState = 'checking' | 'unsupported' | 'install-needed' | 'unavailable' | 'blocked' | 'off' | 'on';

function supported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyToBytes(base64Url: string) {
  const padded = base64Url.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toBase64Url(buffer: ArrayBuffer | null) {
  if (!buffer) return '';
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function family() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return 'other';
}

async function call<T>(client: Client, businessId: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke<{ data?: T }>('push-subscription', { body, headers: { 'x-mova-artist-business-id': businessId } });
  if (error || !data?.data) throw new Error('PUSH_REQUEST_FAILED');
  return data.data;
}

export function usePushDevice(client: Client | null, businessId: string | null | undefined) {
  const [state, setState] = useState<PushDeviceState>('checking');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported()) { setState(isIOSBrowser() ? 'install-needed' : 'unsupported'); return; }
    if (isIOSBrowser()) { setState('install-needed'); return; }
    if (!client || !businessId) return;
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    try {
      const config = await call<{ publicKey: string | null }>(client, businessId, { action: 'config' });
      if (!config.publicKey) { setState('unavailable'); return; }
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || Notification.permission !== 'granted') { setState('off'); return; }
      const status = await call<{ subscribed: boolean }>(client, businessId, { action: 'status', endpoint: subscription.endpoint });
      setState(status.subscribed ? 'on' : 'off');
    } catch { setState('off'); }
  }, [businessId, client]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Asks the browser for permission (must run from a tap), subscribes this device and saves it. */
  const enable = useCallback(async (): Promise<boolean> => {
    if (!client || !businessId || !supported()) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'blocked' : 'off'); return false; }
      const config = await call<{ publicKey: string | null }>(client, businessId, { action: 'config' });
      if (!config.publicKey) { setState('unavailable'); return false; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(config.publicKey) as BufferSource });
      await call(client, businessId, {
        action: 'subscribe', endpoint: subscription.endpoint, userAgentFamily: family(),
        p256dh: toBase64Url(subscription.getKey('p256dh')), auth: toBase64Url(subscription.getKey('auth')),
      });
      setState('on');
      return true;
    } catch {
      await refresh();
      return false;
    } finally { setBusy(false); }
  }, [businessId, client, refresh]);

  return { state, busy, enable, refresh };
}

/** Updates the number on the Home Screen icon (Needs you count). Unsupported browsers ignore it. */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { void (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch?.(() => undefined); } catch { /* optional */ }
}
