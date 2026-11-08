// SMS provider interface (task 4.4). One interface, many implementations: today only the fake.
// The real provider waits on owner decisions O4/O5 (vendor, sending identity registration).

export type SmsSendInput = {
  /** E.164 recipient, e.g. +15551234567. */
  to: string;
  /** E.164 sender (the stylist's sending identity). */
  from: string;
  body: string;
  /** Stable per logical message; providers must de-duplicate on it. */
  idempotencyKey: string;
};

export type SmsSendResult = { providerMessageId: string; status: 'queued' | 'sent' };

export type SmsInbound = { from: string; to: string; text: string; providerMessageId: string | null };

export interface SmsProvider {
  /** Stored in mova_messages.provider. */
  readonly name: string;
  /** True only for providers that reach real phones. The fake returns false. */
  readonly live: boolean;
  send(input: SmsSendInput): Promise<SmsSendResult>;
  /** Estimated cost in micro-dollars, reserved against the shared monthly cap before sending (0047). */
  estimateCostMicros?(input: SmsSendInput): number;
  /** Verifies and parses an inbound webhook; returns null when the signature or payload is invalid. */
  parseInbound(request: Request): Promise<SmsInbound | null>;
}
