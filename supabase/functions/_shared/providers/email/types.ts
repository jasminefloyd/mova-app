// Email provider interface (task 4.3). Only the fake exists; the vendor waits on owner decision O4.

export type EmailTemplateId = 'booking_confirmation' | 'request_received' | 'request_accepted' | 'request_declined' | 'appointment_reminder';
export type EmailLocale = 'en-US' | 'es-US';
/** Emails from Mova itself, not tied to a stylist (O2 invites). */
export type PlatformEmailId = 'early_access_invite';

export type EmailSendInput = {
  to: string;
  /** Sender address; the fake ignores it. */
  from: string;
  subject: string;
  text: string;
  html: string;
  templateId: EmailTemplateId | PlatformEmailId;
  locale: EmailLocale;
  /** Stable per logical email; providers must de-duplicate on it. */
  idempotencyKey: string;
};

export type EmailSendResult = { providerMessageId: string; status: 'queued' | 'sent' };

export interface EmailProvider {
  readonly name: string;
  readonly live: boolean;
  send(input: EmailSendInput): Promise<EmailSendResult>;
  /** Estimated cost in micro-dollars, reserved against the shared monthly cap before sending (0047). */
  estimateCostMicros?(input: EmailSendInput): number;
}
