import type { SmsDb } from './send.ts';
import type { SmsInbound, SmsProvider } from './types.ts';
import { keywordReply, parseKeyword, type SmsKeyword } from './policy.ts';
import { reserveSpend } from '../spend.ts';
import { accountKeywordReply } from './account.ts';

export type InboundOutcome = { keyword: SmsKeyword | null; businesses: number; replies: number };

/**
 * Records an inbound text and applies STOP/START/HELP (task 4.4). Keyword confirmations are the only
 * texts sent without consent, as carriers require; they are logged as transactional replies.
 */
export async function handleInboundSms(db: SmsDb, provider: SmsProvider, inbound: SmsInbound, now = new Date(), accountNumber?: string | null): Promise<InboundOutcome> {
  const keyword = parseKeyword(inbound.text);
  // Mova's platform number carries only trial and billing texts to stylists (account consent, not client consent).
  if (accountNumber && inbound.to === accountNumber) {
    if (!keyword) return { keyword: null, businesses: 0, replies: 0 };
    if (keyword !== 'help') {
      const { error } = await db.rpc('mova_account_sms_keyword', { p_phone: inbound.from, p_keyword: keyword });
      if (error) throw new Error('INBOUND_SAVE_FAILED');
    }
    try {
      await provider.send({ to: inbound.from, from: inbound.to, body: accountKeywordReply(keyword), idempotencyKey: `account-keyword:${inbound.providerMessageId ?? `${inbound.from}:${now.toISOString()}`}` });
      return { keyword, businesses: 0, replies: 1 };
    } catch {
      return { keyword, businesses: 0, replies: 0 };
    }
  }
  const { data, error } = await db.rpc('mova_sms_handle_inbound', {
    p_to: inbound.to, p_from: inbound.from, p_text: inbound.text, p_keyword: keyword,
    p_provider: provider.name, p_provider_message_id: inbound.providerMessageId, p_now: now.toISOString(),
  });
  if (error || !data) throw new Error('INBOUND_SAVE_FAILED');
  const businesses = Array.isArray(data.businesses) ? data.businesses as { artist_business_id: string; locale: string; business_name: string; client_ids: string[] }[] : [];
  let replies = 0;
  if (keyword) {
    for (const business of businesses) {
      const locale = business.locale === 'es-US' ? 'es-US' : 'en-US';
      const body = keywordReply(keyword, locale, business.business_name);
      const key = `keyword-reply:${provider.name}:${inbound.providerMessageId ?? `${inbound.from}:${now.toISOString()}`}:${business.artist_business_id}`;
      const { data: row, error: insertError } = await db.from('mova_messages').insert({
        artist_business_id: business.artist_business_id, client_id: business.client_ids[0] ?? null, direction: 'outbound', channel: 'sms',
        purpose: `keyword_${keyword}`, origin: 'transactional', body, provider: provider.name, status: 'queued', idempotency_key: key,
      }).select('id').single();
      if (insertError || !row) continue;
      const replyInput = { to: inbound.from, from: inbound.to, body, idempotencyKey: key };
      // The keyword itself is always recorded (above); only the confirmation text is subject to the cap.
      const spend = await reserveSpend(db, row.id, provider.estimateCostMicros?.(replyInput) ?? 0, now);
      if (!spend.allowed) {
        if (spend.reason !== 'spend_cap_reached') await db.from('mova_messages').update({ status: 'failed', error_code: 'SPEND_CHECK_UNAVAILABLE' }).eq('id', row.id);
        continue;
      }
      try {
        const sent = await provider.send(replyInput);
        await db.from('mova_messages').update({ status: 'sent', provider_message_id: sent.providerMessageId, sent_at: now.toISOString() }).eq('id', row.id);
        replies += 1;
      } catch {
        await db.from('mova_messages').update({ status: 'failed', error_code: 'PROVIDER_ERROR' }).eq('id', row.id);
      }
    }
  }
  return { keyword, businesses: businesses.length, replies };
}
