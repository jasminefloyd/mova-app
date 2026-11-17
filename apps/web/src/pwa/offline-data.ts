const SAVED_KEY = 'mova_last_synced';
const HOME_KEY = 'mova_last_home';

/** When the app last had a connection; shown in the offline bar ("Showing what was saved at 9:42 AM"). */
export function markSynced(now = Date.now()) { try { window.localStorage.setItem(SAVED_KEY, String(now)); } catch { /* optional */ } }
export function lastSynced(): number | null {
  try { const value = Number(window.localStorage.getItem(SAVED_KEY)); return Number.isFinite(value) && value > 0 ? value : null; } catch { return null; }
}
/** The stylist's Home (e.g. /BID-12) for the offline page's "Open saved Home" button. */
export function rememberHome(path: string) { try { window.localStorage.setItem(HOME_KEY, path); } catch { /* optional */ } }

/** Signing out removes saved pages and data from this device. */
export async function clearOfflineData() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHES' });
    if (typeof caches !== 'undefined') await Promise.all(['mova-pages-v1', 'mova-data-v1'].map((name) => caches.delete(name)));
    window.localStorage.removeItem(SAVED_KEY);
    window.localStorage.removeItem(HOME_KEY);
  } catch { /* best effort */ }
}
