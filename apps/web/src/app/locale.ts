import type { Locale } from '@mova/contracts';

export const ARTIST_LOCALE_KEY = 'mova_artist_locale';
export const ONBOARDING_LOCALE_KEY = 'mova_onboarding_locale';
export const CLIENT_LOCALE_KEY = 'mova_client_locale';
export const GUEST_LOCALE_KEY = 'mova_guest_locale';

export function readStoredLocale(key: string): Locale {
  if (typeof window === 'undefined') return 'en-US';
  const stored = window.localStorage.getItem(key);
  return stored === 'es-US' ? 'es-US' : 'en-US';
}

export function storeLocale(key: string, locale: Locale): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(key, locale);
}
