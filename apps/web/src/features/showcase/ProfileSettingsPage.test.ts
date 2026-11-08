import { describe, expect, it } from 'vitest';
import { handleErrorKey, specialtyOptions } from './ProfileSettingsPage';

describe('handleErrorKey', () => {
  it('maps the 0038 function errors', () => {
    expect(handleErrorKey('HANDLE_RESERVED')).toBe('reserved');
    expect(handleErrorKey('HANDLE_TAKEN')).toBe('taken');
    expect(handleErrorKey('HANDLE_INVALID')).toBe('invalid');
    expect(handleErrorKey('DISPLAY_NAME_INVALID')).toBeNull();
    expect(handleErrorKey(undefined)).toBeNull();
  });
});

describe('specialtyOptions', () => {
  it('keeps custom specialties first and drops case-insensitive duplicates', () => {
    expect(specialtyOptions(['Silk press', 'Sew-ins'], ['Silk Press', 'Braids'])).toEqual(['Silk press', 'Sew-ins', 'Braids']);
  });
});
