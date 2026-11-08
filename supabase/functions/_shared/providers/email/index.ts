export type { EmailLocale, EmailProvider, EmailSendInput, EmailSendResult, EmailTemplateId } from './types.ts';
export { FakeEmailProvider } from './fake.ts';
export { EMAIL_TEMPLATES, formatWhen, renderEmail, type AppointmentEmailVars } from './templates.ts';
export { emailProviderFromEnv, sendEmail, type EmailDb, type SendEmailInput, type SendEmailOutcome } from './send.ts';
