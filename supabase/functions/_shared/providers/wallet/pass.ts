// Task 5.7: the client card as a wallet pass. Apple and Google signing wait on O11's provider set-up
// (certificates, issuer account); until then the only signer is the fake in fake.ts.
export type WalletPlatform = 'apple' | 'google';
export type ClientCardPassInput = {
  platform: WalletPlatform;
  serial: string;
  authToken: string;
  stylistName: string;
  clientName: string;
  cardUrl: string;
  nextAppointment: { startsAt: string; timeZone: string; service: string } | null;
  locale: 'en-US' | 'es-US';
};
export type ClientCardPass = {
  formatVersion: 1;
  platform: WalletPlatform;
  serialNumber: string;
  authenticationToken: string;
  organizationName: 'Mova';
  description: string;
  logoText: 'mova';
  colors: { background: string; foreground: string; label: string };
  barcode: { format: 'QR'; message: string; altText: string };
  fields: Array<{ key: string; label: string; value: string }>;
};

const COPY = {
  'en-US': { description: (name: string) => `Client card for ${name}`, client: 'Client', stylist: 'Stylist', next: 'Next visit', none: 'No visit booked', scan: 'Scan to rebook or check in' },
  'es-US': { description: (name: string) => `Tarjeta de cliente de ${name}`, client: 'Cliente', stylist: 'Estilista', next: 'Próxima cita', none: 'Sin cita reservada', scan: 'Escanea para reservar o registrarte' },
} as const;

export function buildClientCardPass(input: ClientCardPassInput): ClientCardPass {
  if (!/^https:\/\/[^\s]+\/c\/[A-Za-z0-9_-]+$/.test(input.cardUrl)) throw new Error('CARD_URL_INVALID');
  if (input.authToken.length < 16) throw new Error('PASS_AUTH_TOKEN_INVALID');
  const t = COPY[input.locale];
  const next = input.nextAppointment
    ? `${new Intl.DateTimeFormat(input.locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: input.nextAppointment.timeZone }).format(new Date(input.nextAppointment.startsAt))} · ${input.nextAppointment.service}`
    : t.none;
  return {
    formatVersion: 1,
    platform: input.platform,
    serialNumber: input.serial,
    authenticationToken: input.authToken,
    organizationName: 'Mova',
    description: t.description(input.stylistName),
    logoText: 'mova',
    // Brand forest, ivory and mint from the design tokens.
    colors: { background: '#18392F', foreground: '#F7F5EF', label: '#C9E6D4' },
    barcode: { format: 'QR', message: input.cardUrl, altText: t.scan },
    fields: [
      { key: 'client', label: t.client, value: input.clientName.slice(0, 60) },
      { key: 'stylist', label: t.stylist, value: input.stylistName.slice(0, 60) },
      { key: 'next', label: t.next, value: next },
    ],
  };
}
