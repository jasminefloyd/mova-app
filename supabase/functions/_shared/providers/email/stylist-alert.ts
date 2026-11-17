import type { EmailLocale } from './types.ts';

/** Email version of a stylist alert (cancellation, client message, reminder, new review). Same look as EM11. */
export type StylistAlertEmailVars = { firstName: string; title: string; body: string; actionLabel: string; url: string; postalAddress?: string | null };

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const DISPLAY = "Manrope,'DM Sans',Arial,sans-serif";
const UI = "'DM Sans',Arial,sans-serif";
const COPY = {
  'en-US': { hi: (n: string) => `Hi ${n},`, why: 'You get this email because it’s on in Settings › Language & notifications. Turn it off there any time.', tagline: 'Your business moves with you.' },
  'es-US': { hi: (n: string) => `Hola, ${n}:`, why: 'Recibes este correo porque está activado en Configuración › Idioma y notificaciones. Puedes desactivarlo allí cuando quieras.', tagline: 'Tu negocio se mueve contigo.' },
} as const;

export function renderStylistAlertEmail(locale: EmailLocale, vars: StylistAlertEmailVars) {
  const lang = locale === 'es-US' ? 'es-US' : 'en-US';
  const c = COPY[lang];
  const url = /^https:\/\//i.test(vars.url) ? vars.url : 'https://mova-beauty.co/login';
  const address = vars.postalAddress ? esc(vars.postalAddress).replace(/\n/g, '<br>') : '[MAILING ADDRESS]';
  const html = `<!doctype html><html lang="${lang === 'es-US' ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(vars.title)}</title></head>`
    + `<body style="margin:0;padding:0;background:#EBEEE8;color:#18392F;font-family:${UI}"><div style="display:none;max-height:0;overflow:hidden">${esc(vars.body)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEEE8;padding:24px 12px"><tr><td align="center">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#F7F5EF;border:1px solid #DCE1D9;border-radius:28px;overflow:hidden;border-collapse:separate">`
    + `<tr><td style="padding:22px 32px 0;font-family:${DISPLAY};font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#18392F">mova</td></tr>`
    + `<tr><td style="padding:20px 32px 0;font-family:${UI};font-size:15px;color:#3F4D46">${esc(c.hi(vars.firstName))}</td></tr>`
    + `<tr><td style="padding:12px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #DCE1D9;border-radius:20px;border-collapse:separate"><tr><td style="padding:18px 20px">`
    + `<div style="font-family:${DISPLAY};font-size:20px;line-height:1.25;font-weight:800;color:#18392F">${esc(vars.title)}</div>`
    + `<p style="margin:8px 0 0;font-family:${UI};font-size:15px;line-height:1.55;color:#3F4D46">${esc(vars.body)}</p></td></tr></table></td></tr>`
    + `<tr><td style="padding:20px 32px 0"><a href="${esc(url)}" style="display:block;height:54px;line-height:54px;border-radius:27px;background:#18392F;color:#F7F5EF;text-align:center;text-decoration:none;font-family:${UI};font-size:16px;font-weight:700">${esc(vars.actionLabel)}</a></td></tr>`
    + `<tr><td style="padding-top:24px"><div style="border-top:1px solid #DCE1D9;padding:20px 32px 26px;font-family:${UI};font-size:12px;line-height:1.55;color:#4F5F57">${esc(c.why)}<br><br><b style="font-family:${DISPLAY};font-size:14px;font-weight:800;color:#18392F">mova</b> · ${esc(c.tagline)} · mova-beauty.co<br>${address}</div></td></tr>`
    + `</table></td></tr></table></body></html>`;
  const text = [c.hi(vars.firstName), '', vars.title, vars.body, '', `${vars.actionLabel}: ${url}`, '', c.why].join('\n');
  return { subject: vars.title, preview: vars.body, text, html };
}
