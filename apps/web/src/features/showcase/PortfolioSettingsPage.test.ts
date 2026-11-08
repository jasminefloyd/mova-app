import { describe, expect, it } from 'vitest';
import { lookTitle, moveItem } from './PortfolioSettingsPage';

describe('moveItem', () => {
  it('swaps neighbours and refuses moves off either end', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toBeNull();
    expect(moveItem(['a', 'b'], 1, 1)).toBeNull();
  });
});

describe('lookTitle', () => {
  const services = [{ id: 's1', name: 'Silk press', status: 'active' }];
  it('uses the first linked service, else the fallback', () => {
    expect(lookTitle({ service_ids: ['missing', 's1'] }, services, 'Look 1')).toBe('Silk press');
    expect(lookTitle({ service_ids: [] }, services, 'Look 2')).toBe('Look 2');
  });
});
