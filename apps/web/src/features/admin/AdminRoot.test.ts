import { describe, expect, it } from 'vitest';
import { isAdminHost } from './AdminRoot';
import { deviceLabel, safeReturnTo } from './admin-session';

describe('admin host gate', () => {
  it('serves the admin only on the admin subdomain and local development hosts', () => {
    expect(isAdminHost('admin.mova-beauty.co')).toBe(true);
    expect(isAdminHost('localhost')).toBe(true);
    expect(isAdminHost('mova-p6-admin-preview.vercel.app')).toBe(true);
    expect(isAdminHost('mova-beauty.co')).toBe(false);
    expect(isAdminHost('ops.mova-beauty.co')).toBe(false);
  });
});

describe('safeReturnTo', () => {
  it('allows only paths inside the admin portal', () => {
    expect(safeReturnTo('/admin/stylists')).toBe('/admin/stylists');
    expect(safeReturnTo('https://evil.example.com/admin')).toBe('/admin');
    expect(safeReturnTo('//evil.example.com')).toBe('/admin');
    expect(safeReturnTo('/calendar')).toBe('/admin');
    expect(safeReturnTo(null)).toBe('/admin');
  });
});

describe('deviceLabel', () => {
  it('names the browser and system without the full user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Chrome/130.0 Safari/537.36')).toBe('Chrome · Mac');
  });
});
