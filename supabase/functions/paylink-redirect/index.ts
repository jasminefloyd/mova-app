import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { serviceClient } from '../_shared/booking.ts';

const page = (title: string, message: string, language: 'en' | 'es') => new Response(`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><main><h1>${title}</h1><p>${message}</p></main></html>`, {
  status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
});

Deno.serve(withSystemRequestLogging('paylink-redirect', async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  if (!/^[A-Za-z0-9_-]{40,96}$/.test(code)) return new Response('Not found', { status: 404 });
  const { data: result, error } = await serviceClient().rpc('mova_stripe_paylink_resolve', { p_short_code: code });
  if (error) return new Response('Payment link temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  if (!result) return new Response('Payment link not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const spanish = result.locale === 'es-US';
  const language = spanish ? 'es' : 'en';
  if (url.searchParams.get('result') === 'cancelled') return page(spanish ? 'Pago no completado' : 'Payment not completed', spanish ? 'Puedes volver a abrir este enlace mientras siga vigente.' : 'You can reopen this link while it remains valid.', language);
  if (url.searchParams.get('result') === 'complete') {
    if (result.status === 'paid') return page(spanish ? 'Pago recibido' : 'Payment received', spanish ? 'El pago se registró correctamente.' : 'Your payment was recorded.', language);
    return page(spanish ? 'Pago en proceso' : 'Payment processing', spanish ? 'Tu pago está en proceso. Actualiza esta página en un momento.' : 'Your payment is processing. Refresh this page shortly.', language);
  }
  if (result.status === 'paid') return page(spanish ? 'Enlace ya pagado' : 'Link already paid', spanish ? 'Este enlace ya se pagó.' : 'This payment link has already been paid.', language);
  if (result.status !== 'open') return page(spanish ? 'Enlace vencido' : 'Link expired', spanish ? 'Pídele a tu estilista un enlace de pago nuevo.' : 'Ask your stylist for a new payment link.', language);
  if (typeof result.checkout_url !== 'string') return new Response('Payment link temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    const checkout = new URL(result.checkout_url);
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com') throw new Error();
    return Response.redirect(checkout.toString(), 303);
  } catch {
    return new Response('Payment link temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}));
