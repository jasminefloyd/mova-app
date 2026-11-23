import type { EmailLocale } from './types.ts';

/**
 * Trial and billing emails to the stylist (EM13 trial ending, EM14 payment failed, EM15 trial ended).
 * Same shell as EM11: forest hero, a white card of rows, one button, footer with the postal address.
 * The words are built by _shared/account-messages.ts so email, push and text say the same thing.
 */
export type AccountEmailVars = {
  subject: string; preview: string; headline: string; lead: string;
  rows: Array<[string, string]>; action: string; url: string; after: string;
  secondary?: { label: string; url: string };
  firstName: string; tone?: 'forest' | 'alert'; postalAddress?: string | null;
};

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const DISPLAY = "Manrope,'DM Sans',Arial,sans-serif";
const UI = "'DM Sans',Arial,sans-serif";
const COPY = {
  'en-US': { for: (n: string) => `For ${n}`, why: 'You got this email because you have a Mova account. Questions? Reply to this email and a person will answer.', tagline: 'Your business moves with you.' },
  'es-US': { for: (n: string) => `Para ${n}`, why: 'Recibiste este correo porque tienes una cuenta de Mova. ¿Preguntas? Responde a este correo y una persona te contestará.', tagline: 'Tu negocio se mueve contigo.' },
} as const;

export function renderAccountEmail(locale: EmailLocale, vars: AccountEmailVars) {
  const lang = locale === 'es-US' ? 'es-US' : 'en-US';
  const c = COPY[lang];
  const url = /^https:\/\//i.test(vars.url) ? vars.url : 'https://mova-beauty.co/login';
  const secondary = vars.secondary && /^https:\/\//i.test(vars.secondary.url) ? vars.secondary : null;
  const address = vars.postalAddress ? esc(vars.postalAddress).replace(/\n/g, '<br>') : '[MAILING ADDRESS]';
  const alert = vars.tone === 'alert';
  const heroStyle = alert ? 'background:#F6E3DF;border:1px solid #E8C4BC' : 'background:#18392F';
  const heroHead = alert ? '#9A3B2E' : '#F7F5EF';
  const heroLead = alert ? '#3F4D46' : '#C9E6D4';
  const rows = vars.rows.map(([title, body], index) => `<tr><td style="padding:12px 0;${index < vars.rows.length - 1 ? 'border-bottom:1px solid #EBEEE8;' : ''}">`
    + `<div style="font-family:${UI};color:#18392F;font-size:15px;line-height:1.4;font-weight:700">${esc(title)}</div>`
    + `<p style="margin:2px 0 0;font-family:${UI};font-size:14px;line-height:1.55;color:#3F4D46">${esc(body)}</p></td></tr>`).join('');
  const html = `<!doctype html><html lang="${lang === 'es-US' ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(vars.subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#EBEEE8;color:#18392F;font-family:${UI}"><div style="display:none;max-height:0;overflow:hidden">${esc(vars.preview)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEEE8;padding:24px 12px"><tr><td align="center">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#F7F5EF;border:1px solid #DCE1D9;border-radius:28px;overflow:hidden;border-collapse:separate">`
    + `<tr><td style="padding:22px 32px 0"><span style="font-family:${DISPLAY};font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#18392F">mova</span><span style="float:right;font-family:${UI};font-size:13px;color:#4F5F57;line-height:30px">${esc(c.for(vars.firstName))}</span></td></tr>`
    + `<tr><td style="padding:18px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${heroStyle};border-radius:22px;border-collapse:separate"><tr><td style="padding:26px 24px">`
    + `<div style="font-family:${DISPLAY};font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.5px;color:${heroHead}">${esc(vars.headline)}</div>`
    + `<p style="margin:10px 0 0;font-family:${UI};font-size:16px;line-height:1.5;color:${heroLead}">${esc(vars.lead)}</p></td></tr></table></td></tr>`
    + `<tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #DCE1D9;border-radius:20px;border-collapse:separate"><tr><td style="padding:6px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table></td></tr>`
    + `<tr><td style="padding:20px 32px 0"><a href="${esc(url)}" style="display:block;height:54px;line-height:54px;border-radius:27px;background:#18392F;color:#F7F5EF;text-align:center;text-decoration:none;font-family:${UI};font-size:16px;font-weight:700">${esc(vars.action)}</a></td></tr>`
    + `<tr><td style="padding:16px 32px 0;font-family:${UI};font-size:14px;line-height:1.55;color:#3F4D46">${esc(vars.after)}</td></tr>`
    + (secondary ? `<tr><td style="padding:14px 32px 0;font-family:${UI};font-size:14px"><a style="color:#18392F" href="${esc(secondary.url)}">${esc(secondary.label)}</a></td></tr>` : '')
    + `<tr><td style="padding-top:24px"><div style="border-top:1px solid #DCE1D9;padding:20px 32px 26px;font-family:${UI};font-size:12px;line-height:1.55;color:#4F5F57">${esc(c.why)}<br><br><b style="font-family:${DISPLAY};font-size:14px;font-weight:800;color:#18392F">mova</b> · ${esc(c.tagline)} · mova-beauty.co<br>${address}</div></td></tr>`
    + `</table></td></tr></table></body></html>`;
  const text = [c.for(vars.firstName), '', vars.headline, vars.lead, '', ...vars.rows.map(([title, body]) => `${title}: ${body}`), '', `${vars.action}: ${url}`, '', vars.after, ...(secondary ? [`${secondary.label}: ${secondary.url}`] : []), '', c.why].join('\n');
  return { subject: vars.subject, preview: vars.preview, text, html };
}
