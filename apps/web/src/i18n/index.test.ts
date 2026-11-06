import { describe, expect, it } from 'vitest';
import { criticalTranslation, i18nReady } from './index';

describe('critical translations', () => {
  it('returns the requested locale without falling back to English', async () => {
    await i18nReady;
    expect(criticalTranslation('error.title', 'es-US')).toBe('Ocurrió un error');
  });

  it('fails explicitly when a critical string is missing', async () => {
    await i18nReady;
    expect(() => criticalTranslation('policy.missing', 'es-US')).toThrow('Missing critical translation: es-US:policy.missing');
  });
});
