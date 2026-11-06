import { describe, expect, it } from 'vitest';
import { validateLocaleCatalogs } from '../../../../scripts/check-locales.mjs';

describe('locale catalog validation', () => {
  it('passes matching catalogs with all critical strings', () => {
    const catalogs = {
      'en-US': { common: { language: 'Language', error: { title: 'Error' } } },
      'es-US': { common: { language: 'Idioma', error: { title: 'Error' } } },
    };
    expect(validateLocaleCatalogs(catalogs, ['common.language', 'common.error.title'])).toEqual([]);
  });

  it('reports a missing critical key and locale parity mismatch', () => {
    const catalogs = {
      'en-US': { common: { language: 'Language', error: { title: 'Error' } } },
      'es-US': { common: { language: 'Idioma', error: {} } },
    };
    expect(validateLocaleCatalogs(catalogs, ['common.error.title'])).toEqual([
      'es-US is missing common.error.title',
      'es-US is missing critical string common.error.title',
    ]);
  });
});
