import type { EmailLocale } from './types.ts';

/**
 * The stylist's first reply to a client's Mova review (RV-D1). Sent once, to the email on file, from the
 * stylist's Mova address with replies going to the stylist. Carries a one-use unsubscribe link: the
 * reply is part of the review the client chose to leave, so it is not marketing, but they can stop it.
 */
export type ReviewReplyEmailVars = {
  firstName: string; businessName: string; rating: number; reviewBody: string; reply: string;
  unsubscribeUrl: string; bookingUrl?: string | null; postalAddress?: string | null;
};

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const https = (value?: string | null) => value && /^https:\/\//i.test(value) ? value : null;
const DISPLAY = "Manrope,'DM Sans',Arial,sans-serif";
const UI = "'DM Sans',Arial,sans-serif";
const COPY = {
  'en-US': {
    subject: (b: string) => `${b} replied to your review`,
    preview: (b: string) => `A note from ${b} about your visit.`,
    for: (n: string) => `For ${n}`,
    headline: (b: string) => `${b} replied to your review.`,
    yourReview: 'Your review', theirReply: (b: string) => `${b}'s reply`,
    book: 'Book again', why: (b: string) => `You got this email because you left a review for ${b} on Mova. Reply to this email to answer ${b} directly.`,
    unsubscribe: (b: string) => `Stop review emails from ${b}`, tagline: 'Your business moves with you.',
  },
  'es-US': {
    subject: (b: string) => `${b} respondió a tu reseña`,
    preview: (b: string) => `Un mensaje de ${b} sobre tu visita.`,
    for: (n: string) => `Para ${n}`,
    headline: (b: string) => `${b} respondió a tu reseña.`,
    yourReview: 'Tu reseña', theirReply: (b: string) => `Respuesta de ${b}`,
    book: 'Reservar otra vez', why: (b: string) => `Recibiste este correo porque dejaste una reseña para ${b} en Mova. Responde a este correo para escribirle a ${b} directamente.`,
    unsubscribe: (b: string) => `Dejar de recibir correos sobre reseñas de ${b}`, tagline: 'Tu negocio se mueve contigo.',
  },
} as const;

export function renderReviewReplyEmail(locale: EmailLocale, vars: ReviewReplyEmailVars) {
  const lang = locale === 'es-US' ? 'es-US' : 'en-US';
  const c = COPY[lang];
  const b = vars.businessName || 'Mova';
  const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(vars.rating)))) + '☆'.repeat(5 - Math.max(1, Math.min(5, Math.round(vars.rating))));
  const unsubscribe = https(vars.unsubscribeUrl) ?? 'https://mova-beauty.co';
  const booking = https(vars.bookingUrl);
  const address = vars.postalAddress ? esc(vars.postalAddress).replace(/\n/g, '<br>') : '[MAILING ADDRESS]';
  const para = (text: string) => esc(text).replace(/\n/g, '<br>');
  const html = `<!doctype html><html lang="${lang === 'es-US' ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject(b))}</title></head>`
    + `<body style="margin:0;padding:0;background:#EBEEE8;color:#18392F;font-family:${UI}"><div style="display:none;max-height:0;overflow:hidden">${esc(c.preview(b))}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEEE8;padding:24px 12px"><tr><td align="center">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#F7F5EF;border:1px solid #DCE1D9;border-radius:28px;overflow:hidden;border-collapse:separate">`
    + `<tr><td style="padding:22px 32px 0"><span style="font-family:${DISPLAY};font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#18392F">mova</span><span style="float:right;font-family:${UI};font-size:13px;color:#4F5F57;line-height:30px">${esc(c.for(vars.firstName))}</span></td></tr>`
    + `<tr><td style="padding:18px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18392F;border-radius:22px;border-collapse:separate"><tr><td style="padding:26px 24px">`
    + `<div style="font-family:${DISPLAY};font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-0.5px;color:#F7F5EF">${esc(c.headline(b))}</div>`
    + `<p style="margin:14px 0 0;font-family:${UI};font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#C9E6D4">${esc(c.theirReply(b))}</p>`
    + `<p style="margin:6px 0 0;font-family:${UI};font-size:17px;line-height:1.55;color:#F7F5EF">${para(vars.reply)}</p></td></tr></table></td></tr>`
    + `<tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #DCE1D9;border-radius:20px;border-collapse:separate"><tr><td style="padding:16px 20px">`
    + `<div style="font-family:${UI};font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#4F5F57">${esc(c.yourReview)}</div>`
    + `<div style="margin-top:6px;font-size:18px;letter-spacing:2px;color:#C98F66">${stars}</div>`
    + (vars.reviewBody ? `<p style="margin:6px 0 0;font-family:${UI};font-size:15px;line-height:1.55;color:#3F4D46">“${para(vars.reviewBody)}”</p>` : '')
    + `</td></tr></table></td></tr>`
    + (booking ? `<tr><td style="padding:20px 32px 0"><a href="${esc(booking)}" style="display:block;height:54px;line-height:54px;border-radius:27px;background:#18392F;color:#F7F5EF;text-align:center;text-decoration:none;font-family:${UI};font-size:16px;font-weight:700">${esc(c.book)}</a></td></tr>` : '')
    + `<tr><td style="padding-top:24px"><div style="border-top:1px solid #DCE1D9;padding:20px 32px 26px;font-family:${UI};font-size:12px;line-height:1.55;color:#4F5F57">${esc(c.why(b))}<br><br>`
    + `<a href="${esc(unsubscribe)}" style="color:#4F5F57">${esc(c.unsubscribe(b))}</a><br><br>`
    + `<b style="font-family:${DISPLAY};font-size:14px;font-weight:800;color:#18392F">mova</b> · ${esc(c.tagline)}<br>${address}</div></td></tr>`
    + `</table></td></tr></table></body></html>`;
  const text = [`${lang === 'es-US' ? 'Hola' : 'Hi'} ${vars.firstName},`, '', c.headline(b), '', `${c.theirReply(b)}:`, vars.reply, '',
    `${c.yourReview}: ${stars}`, ...(vars.reviewBody ? [`“${vars.reviewBody}”`] : []), '', ...(booking ? [`${c.book}: ${booking}`, ''] : []),
    c.why(b), `${c.unsubscribe(b)}: ${unsubscribe}`].join('\n');
  return { subject: c.subject(b), preview: c.preview(b), text, html };
}
