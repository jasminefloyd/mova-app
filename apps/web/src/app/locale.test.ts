import { afterEach, describe, expect, it } from 'vitest';
import { ARTIST_LOCALE_KEY, CLIENT_LOCALE_KEY, GUEST_LOCALE_KEY, readStoredLocale, storeLocale } from './locale';

afterEach(() => localStorage.clear());

describe('locale persistence', () => {
  it('persists locales independently for artist, client, and guest shells', () => {
    storeLocale(ARTIST_LOCALE_KEY, 'en-US');
    storeLocale(CLIENT_LOCALE_KEY, 'es-US');
    storeLocale(GUEST_LOCALE_KEY, 'es-US');

    expect(readStoredLocale(ARTIST_LOCALE_KEY)).toBe('en-US');
    expect(readStoredLocale(CLIENT_LOCALE_KEY)).toBe('es-US');
    expect(readStoredLocale(GUEST_LOCALE_KEY)).toBe('es-US');
  });

  it('uses en-US for an unsupported stored value', () => {
    localStorage.setItem(GUEST_LOCALE_KEY, 'fr-FR');
    expect(readStoredLocale(GUEST_LOCALE_KEY)).toBe('en-US');
  });
});
