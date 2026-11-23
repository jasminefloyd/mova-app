import type { ClosureDb } from './account-closure.ts';
import { closureSignature } from './account-closure.ts';
import { renderAccountEmail, type AccountEmailVars } from './providers/email/account.ts';
import { emailProviderFromEnv, MOVA_EMAIL_DOMAIN } from './providers/email/send.ts';

type Mail = {
  closure_id: string; business_id: string; kind: 'admin' | 'farewell'; email: string | null;
  display_name: string; locale: string; ends_at: string;
};

export function farewellEmail(locale: 'en-US' | 'es-US', name: string, url: string): AccountEmailVars {
  const spanish = locale === 'es-US';
  const subject = spanish ? 'Sentimos que te vayas' : 'Sorry to see you go';
  const lead = spanish ? 'Tu acceso a Mova terminó. Gracias por dejarnos acompañar a tu negocio.' : 'Your access to Mova has ended. Thank you for letting us be part of your business.';
  return {
    subject, headline: subject, preview: lead, lead, firstName: name,
    rows: [[spanish ? '¿Qué podríamos mejorar?' : 'What could we do better?',
      spanish ? 'Si quieres, cuéntanos por qué te vas o déjanos un comentario.' : 'If you’d like, tell us why you’re leaving or leave us a comment.']],
    action: spanish ? 'Compartir comentarios' : 'Share feedback', url,
    after: spanish ? 'Tus comentarios son opcionales.' : 'Feedback is optional.',
    secondary: { label: spanish ? 'Reactivar tu cuenta' : 'Reactivate your account', url: url.replace('mode=feedback', 'mode=reactivate') },
  };
}

export async function processAccountClosures(db: ClosureDb, env: (key: string) => string | undefined) {
  const { error: transitionError } = await db.rpc('mova_account_finish_due');
  if (transitionError) throw new Error('ACCOUNT_CLOSE_DUE_FAILED');
  const { data, error } = await db.rpc('mova_account_mail');
  if (error) throw new Error('ACCOUNT_MAIL_READ_FAILED');
  if (!data?.length) return;

  const provider = emailProviderFromEnv(name => name === 'MOVA_MESSAGING_LIVE_EMAIL'
    && env('MOVA_EMAIL_ACCOUNT_CLOSURE_ENABLED') === 'true' ? 'true' : env(name));
  const secret = env('MOVA_JOB_DISPATCH_SECRET');
  if (!provider || !secret) throw new Error('ACCOUNT_MAIL_PROVIDER_NOT_CONFIGURED');
  const base = (env('MOVA_EMAIL_PUBLIC_BASE_URL') ?? 'https://mova-beauty.co').replace(/\/$/, '');
  for (const record of data as Mail[]) {
    try {
      const admin = record.kind === 'admin';
      const email = admin ? env('MOVA_ACCOUNT_REQUEST_ADMIN_EMAIL') ?? record.email : record.email;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const { data: gate, error: gateError } = await db.rpc('mova_email_send_gate', { p_artist_business_id: record.business_id, p_email: email });
      if (gateError || !gate) throw new Error('ACCOUNT_MAIL_POLICY_FAILED');
      const locale = record.locale === 'es-US' ? 'es-US' : 'en-US';
      if (gate.allowed === true) {
        const adminUrl = (env('MOVA_ADMIN_BASE_URL') ?? 'https://admin.mova-beauty.co').replace(/\/$/, '');
        const token = admin ? '' : `${record.closure_id}.${record.business_id}.${await closureSignature(record.closure_id, record.business_id, secret)}`;
        const vars = admin ? {
          subject: 'Stylist account deletion requested', preview: 'Review the deletion request in the admin portal.',
          headline: 'Account deletion requested', lead: `${record.display_name} requested account deletion.`,
          rows: [['Access ends', new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(record.ends_at)) + ' UTC']] as [string, string][],
          action: 'Review request', url: `${adminUrl}/admin/stylists/${record.business_id}`,
          after: 'Open the stylist record to review the request and take action.', firstName: 'Mova Admin',
        } : farewellEmail(locale, record.display_name, `${base}/account-closure?mode=feedback&lang=${locale}#${token}`);
        await provider.send({ ...renderAccountEmail(locale, { ...vars, postalAddress: env('MOVA_EMAIL_POSTAL_ADDRESS') }),
          from: `Mova <hello@${MOVA_EMAIL_DOMAIN}>`, to: email, locale,
          templateId: admin ? 'stylist_account_deletion_requested' : 'stylist_account_farewell',
          idempotencyKey: `account-closure:${record.closure_id}:${record.kind}`,
        });
      }
      // Suppression is terminal. Provider outages leave the row pending for the next run.
      const { error: markError } = await db.from('mova_account_closures')
        .update({ [admin ? 'admin_notified_at' : 'farewell_sent_at']: new Date().toISOString() }).eq('id', record.closure_id);
      if (markError) throw new Error('ACCOUNT_MAIL_MARK_FAILED');
    } catch (error) {
      console.error('Account closure email failed', { kind: record.kind, error: error instanceof Error ? error.message : 'UNKNOWN' });
    }
  }
}
