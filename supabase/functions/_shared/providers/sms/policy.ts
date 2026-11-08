// Pure SMS rules shared by Edge Functions (task 4.4). Mirrors the SQL in mova_can_send / migration 0042.

export type SmsKeyword = 'stop' | 'start' | 'help';

const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'PARAR', 'ALTO', 'BAJA']);
const START = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE', 'OPTIN']);
const HELP = new Set(['HELP', 'INFO', 'AYUDA']);

/** Carrier keywords are whole-message, case- and accent-insensitive, ignoring trailing punctuation. */
export function parseKeyword(text: string): SmsKeyword | null {
  const word = text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/[.!¡?¿\s]+$/g, '').replace(/^[¡¿\s]+/g, '').toUpperCase();
  if (STOP.has(word)) return 'stop';
  if (START.has(word)) return 'start';
  if (HELP.has(word)) return 'help';
  return null;
}

/** US numbers to E.164 (+1XXXXXXXXXX); null when it cannot be a valid number. */
export function toE164(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Same rule as mova_can_send: marketing texts only between 09:00 and 20:00 in the client's time zone. */
export function isQuietHours(now: Date, timeZone: string, start = 20, end = 9) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** Default per-client cap for non-transactional texts in a rolling 24 hours (server setting mova.sms_daily_cap). */
export const DEFAULT_DAILY_CAP = 1;

export function underDailyCap(sentInLast24h: number, cap = DEFAULT_DAILY_CAP) {
  return sentInLast24h < cap;
}

/** Fixed auto-replies. The stylist's business name is the only variable. */
export function keywordReply(keyword: SmsKeyword, locale: 'en-US' | 'es-US', businessName: string) {
  const name = businessName.slice(0, 60);
  const copy = {
    'en-US': {
      stop: `You're unsubscribed from ${name} texts on Mova. No more messages will be sent. Reply START to resubscribe.`,
      start: `You're resubscribed to ${name} texts on Mova. Reply STOP to unsubscribe, HELP for help.`,
      help: `${name} on Mova: appointment texts. Msg & data rates may apply. Reply STOP to unsubscribe.`,
    },
    'es-US': {
      stop: `Cancelaste los mensajes de ${name} en Mova. No recibirás más mensajes. Responde START para volver a suscribirte.`,
      start: `Volviste a suscribirte a los mensajes de ${name} en Mova. Responde STOP para cancelar o HELP para ayuda.`,
      help: `${name} en Mova: mensajes sobre citas. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar.`,
    },
  } as const;
  return copy[locale][keyword];
}
