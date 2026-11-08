// Owner decision O4: a $50/month hard-stop spend cap shared by email and SMS (migration 0047).
// Every send reserves its estimated cost on the queued message before the provider is called.

type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type SpendDb = { rpc(name: string, args: Record<string, unknown>): Result<Record<string, unknown>> };

export const SPEND_CAP_MICROS = 50_000_000; // $50.00; the server setting mova.messaging_spend_cap_micros is authoritative.

export async function reserveSpend(db: SpendDb, messageId: string, costMicros: number, now = new Date()): Promise<{ allowed: boolean; reason?: string }> {
  const cost = Math.max(0, Math.round(costMicros));
  const { data, error } = await db.rpc('mova_messaging_reserve_spend', { p_message_id: messageId, p_cost_micros: cost, p_now: now.toISOString() });
  if (error || !data) return { allowed: false, reason: 'SPEND_CHECK_UNAVAILABLE' };
  return data.allowed === true ? { allowed: true } : { allowed: false, reason: 'spend_cap_reached' };
}

/** SMS segments: GSM-7 160/153 characters, otherwise UCS-2 70/67. */
export function smsSegments(body: string) {
  const gsm = /^[\n\r -~£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/.test(body);
  // UCS-2 counts UTF-16 code units, so an emoji takes two.
  const chars = gsm ? [...body].length : body.length;
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return chars <= single ? 1 : Math.ceil(chars / multi);
}
