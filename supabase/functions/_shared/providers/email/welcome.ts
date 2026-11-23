import type { EmailLocale } from './types.ts';

/**
 * EM11 · Welcome to Mova (stylist). Sent once onboarding is finished and the page is live.
 * Layout follows the Mova App Screens board "Email-Welcome" exactly; the three steps point at
 * adding more services and places, then sharing the link or QR code.
 */
export type WelcomeEmailVars = {
  firstName: string;
  /** Public page, e.g. https://mova-beauty.co/a/ari */
  pageUrl?: string | null;
  /** Operator links. Each step row links to its Settings screen; the button opens Settings. */
  settingsUrl?: string | null; servicesUrl?: string | null; locationsUrl?: string | null; qrUrl?: string | null;
  /** Where the hero leaf image is hosted (the web app's public folder). */
  assetBaseUrl?: string | null;
  postalAddress?: string | null;
  /** WP7: the free trial is on (trial_enabled), so the plan line talks about the trial instead of Free. */
  trial?: boolean;
};

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const https = (value?: string | null) => (value && /^https:\/\//i.test(value) ? value : null);

const COPY = {
  'en-US': {
    subject: (n: string) => `Welcome to Mova, ${n}`,
    preview: 'Your business moves with you. Three steps to your first booking.',
    headline: (n: string) => `Welcome to Mova, ${n}.`,
    lead: 'Your clients follow you. Now your business can too.',
    yourPage: 'Your page',
    stepsTitle: 'Three steps to your first booking',
    steps: [
      ['Add more services and prices', 'Durations, deposits and the looks that go with them.'],
      ['Add every place you work', 'Your suite, the salon, or both. Each with its own hours.'],
      ['Share your link or QR code', 'On your mirror, in your bio, or by text. Clients book without an app.'],
    ],
    action: 'Finish setting up',
    plan: 'You’re on the Free plan: $0 a month, and no Mova fee on cash or on payments the salon collects.',
    planTrial: 'Your 30-day AI + Growth trial starts when you open Mova. You can switch to Pro or Free anytime.',
    why: 'You got this email because you have a Mova account. Questions? Reply to this email and a person will answer.',
    tagline: 'Your business moves with you.',
  },
  'es-US': {
    subject: (n: string) => `Te damos la bienvenida a Mova, ${n}`,
    preview: 'Tu negocio se mueve contigo. Tres pasos para tu primera reserva.',
    headline: (n: string) => `Te damos la bienvenida a Mova, ${n}.`,
    lead: 'Tus clientes te siguen. Ahora tu negocio también.',
    yourPage: 'Tu página',
    stepsTitle: 'Tres pasos para tu primera reserva',
    steps: [
      ['Agrega más servicios y precios', 'Duración, depósitos y los looks que van con cada uno.'],
      ['Agrega cada lugar donde trabajas', 'Tu suite, el salón o ambos. Cada uno con su horario.'],
      ['Comparte tu enlace o código QR', 'En tu espejo, en tu bio o por mensaje. Tus clientes reservan sin app.'],
    ],
    action: 'Terminar configuración',
    plan: 'Estás en el plan Gratis: $0 al mes, y Mova no cobra comisión por efectivo ni por pagos que cobre el salón.',
    planTrial: 'Tu prueba de 30 días de AI + Growth empieza cuando abras Mova. Puedes cambiar a Pro o Gratis cuando quieras.',
    why: 'Recibiste este correo porque tienes una cuenta de Mova. ¿Preguntas? Responde a este correo y una persona te contestará.',
    tagline: 'Tu negocio se mueve contigo.',
  },
} as const;

const DISPLAY = "Manrope,'DM Sans',Arial,sans-serif";
const UI = "'DM Sans',Arial,sans-serif";

export function renderWelcomeEmail(locale: EmailLocale, vars: WelcomeEmailVars) {
  const lang = locale === 'es-US' ? 'es-US' : 'en-US';
  const c = COPY[lang];
  const name = vars.firstName.trim().split(/\s+/)[0]?.slice(0, 40) || 'there';
  const page = https(vars.pageUrl);
  const pageLabel = page ? page.replace(/^https:\/\//i, '').replace(/\/$/, '') : '';
  const settings = https(vars.settingsUrl);
  const stepLinks = [https(vars.servicesUrl), https(vars.locationsUrl), https(vars.qrUrl)];
  const leaf = https(vars.assetBaseUrl) ? `${vars.assetBaseUrl!.replace(/\/$/, '')}/email/welcome-leaf.png` : null;
  const address = vars.postalAddress ? esc(vars.postalAddress).replace(/\n/g, '<br>') : '[MAILING ADDRESS]';

  const pill = pageLabel ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;border-collapse:separate"><tr><td style="background:#264E3E;border-radius:14px;padding:8px 14px;font-family:${UI};font-size:14px;line-height:20px;color:#F7F5EF"><span style="color:#C9E6D4">${esc(c.yourPage)}</span>&nbsp;&nbsp;<a href="${esc(page!)}" style="color:#F7F5EF;font-weight:700;text-decoration:none">${esc(pageLabel)}</a></td></tr></table>` : '';
  const heroBg = leaf ? `background-color:#18392F;background-image:url('${esc(leaf)}');background-repeat:no-repeat;background-position:right top;background-size:190px 200px;` : 'background-color:#18392F;';
  const hero = `<tr><td style="padding:18px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr><td bgcolor="#18392F" style="${heroBg}border-radius:24px;padding:28px 24px;color:#F7F5EF">`
    + `<div style="margin:0;max-width:450px;font-family:${DISPLAY};font-size:34px;line-height:1.08;font-weight:800;letter-spacing:-0.8px;color:#F7F5EF">${esc(c.headline(name))}</div>`
    + `<p style="margin:10px 0 0;font-family:${UI};font-size:16px;line-height:1.5;color:#C9E6D4">${esc(c.lead)}</p>${pill}</td></tr></table></td></tr>`;

  const rows = c.steps.map(([title, body], index) => {
    const last = index === c.steps.length - 1;
    const link = stepLinks[index];
    const titleHtml = link ? `<a href="${esc(link)}" style="color:#18392F;text-decoration:none">${esc(title)}</a>` : esc(title);
    return `<tr><td style="padding:12px 0;${last ? '' : 'border-bottom:1px solid #EBEEE8;'}"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>`
      + `<td width="36" valign="top" style="width:36px"><div style="width:36px;height:36px;border-radius:18px;background:#C9E6D4;text-align:center;font-family:${DISPLAY};font-size:16px;font-weight:800;line-height:36px;color:#18392F">${index + 1}</div></td>`
      + `<td valign="top" style="padding-left:14px;font-family:${UI};color:#18392F"><div style="font-size:15px;line-height:1.4;font-weight:700">${titleHtml}</div><p style="margin:2px 0 0;font-size:14px;line-height:1.55;color:#3F4D46">${esc(body)}</p></td>`
      + `</tr></table></td></tr>`;
  }).join('');
  const steps = `<tr><td style="padding:20px 32px 0"><div style="font-family:${DISPLAY};font-size:17px;line-height:1.3;font-weight:700;color:#18392F">${esc(c.stepsTitle)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:#FFFFFF;border:1px solid #DCE1D9;border-radius:20px;border-collapse:separate"><tr><td style="padding:6px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table></td></tr>`;

  const cta = settings ? `<tr><td style="padding:20px 32px 0"><a href="${esc(settings)}" style="display:block;height:54px;line-height:54px;border-radius:27px;background:#18392F;color:#F7F5EF;text-align:center;text-decoration:none;font-family:${UI};font-size:16px;font-weight:700">${esc(c.action)}</a></td></tr>` : '';
  const plan = `<tr><td style="padding:20px 32px 0"><p style="margin:0;font-family:${UI};font-size:15px;line-height:1.55;color:#3F4D46">${esc(vars.trial ? c.planTrial : c.plan)}</p></td></tr>`;
  const footer = `<tr><td style="padding-top:24px"><div style="border-top:1px solid #DCE1D9;padding:20px 32px 26px;font-family:${UI};font-size:12px;line-height:1.55;color:#4F5F57">${esc(c.why)}<br><br><b style="font-family:${DISPLAY};font-size:14px;font-weight:800;color:#18392F">mova</b> · ${esc(c.tagline)} · mova-beauty.co<br>${address}</div></td></tr>`;

  const html = `<!doctype html><html lang="${lang === 'es-US' ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&amp;family=Manrope:wght@600;700;800&amp;display=swap"><title>${esc(c.subject(name))}</title></head>`
    + `<body style="margin:0;padding:0;background:#EBEEE8;color:#18392F;font-family:${UI}"><div style="display:none;max-height:0;overflow:hidden">${esc(c.preview)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEEE8;padding:24px 12px"><tr><td align="center">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#F7F5EF;border:1px solid #DCE1D9;border-radius:28px;overflow:hidden;border-collapse:separate">`
    + `<tr><td style="padding:22px 32px 0;font-family:${DISPLAY};font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#18392F">mova</td></tr>`
    + hero + steps + cta + plan + footer
    + `</table></td></tr></table></body></html>`;

  const text = [
    c.headline(name), '', c.lead, page ? `${c.yourPage}: ${page}` : '', '', c.stepsTitle,
    ...c.steps.map(([title, body], index) => `${index + 1}. ${title}: ${body}${stepLinks[index] ? ` ${stepLinks[index]}` : ''}`),
    '', settings ? `${c.action}: ${settings}` : '', '', vars.trial ? c.planTrial : c.plan, '', c.why, '', `Mova · ${vars.postalAddress || '[MAILING ADDRESS]'}`,
  ].filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');

  return { subject: c.subject(name), preview: c.preview, text, html };
}
