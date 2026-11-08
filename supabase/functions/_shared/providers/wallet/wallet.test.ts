import { describe, expect, it } from 'vitest';
import { buildClientCardPass } from './pass';
import { FakeWalletSigner, walletSignerFromEnv } from './fake';

const input = { platform: 'apple' as const, serial: 'serial-1', authToken: 'a'.repeat(32), stylistName: 'Nia Flores', clientName: 'Dana', cardUrl: 'https://mova-beauty.co/c/abc_123', nextAppointment: { startsAt: '2026-11-20T15:00:00Z', timeZone: 'America/New_York', service: 'Silk press' }, locale: 'en-US' as const };

describe('client card wallet pass (task 5.7)', () => {
  it('builds the pass with the client card QR and next visit', () => {
    const pass = buildClientCardPass(input);
    expect(pass.barcode).toEqual({ format: 'QR', message: 'https://mova-beauty.co/c/abc_123', altText: 'Scan to rebook or check in' });
    expect(pass.fields).toEqual([{ key: 'client', label: 'Client', value: 'Dana' }, { key: 'stylist', label: 'Stylist', value: 'Nia Flores' }, { key: 'next', label: 'Next visit', value: 'Fri, Nov 20, 10:00 AM · Silk press' }]);
  });
  it('speaks Spanish and handles no booked visit', () => {
    const pass = buildClientCardPass({ ...input, locale: 'es-US', nextAppointment: null });
    expect(pass.description).toBe('Tarjeta de cliente de Nia Flores');
    expect(pass.fields[2]).toEqual({ key: 'next', label: 'Próxima cita', value: 'Sin cita reservada' });
  });
  it('refuses anything but a client card link and short auth tokens', () => {
    expect(() => buildClientCardPass({ ...input, cardUrl: 'http://evil.example/c/x' })).toThrow('CARD_URL_INVALID');
    expect(() => buildClientCardPass({ ...input, authToken: 'short' })).toThrow('PASS_AUTH_TOKEN_INVALID');
  });
  it('signs deterministically with the fake and never claims to be live', async () => {
    const signer = new FakeWalletSigner();
    const [a, b] = [await signer.sign(buildClientCardPass(input)), await signer.sign(buildClientCardPass(input))];
    expect(a).toEqual(b);
    expect(a.live).toBe(false);
    expect(JSON.parse(atob(a.base64))).toMatchObject({ signer: 'fake', pass: { serialNumber: 'serial-1' } });
    expect(walletSignerFromEnv(() => undefined)).toBeNull();
    expect(walletSignerFromEnv(() => 'fake')?.name).toBe('fake');
  });
});
