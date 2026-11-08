// Missed-call text-back wording (draft; final wording is part of SMS sender registration, O4/O5).
export function missedCallText(locale: 'en-US' | 'es-US', businessName: string, handle: string | null) {
  const name = businessName.slice(0, 60);
  const link = handle && /^[a-z0-9-]{3,30}$/.test(handle) ? ` https://mova-beauty.co/a/${handle}/book` : '';
  return locale === 'es-US'
    ? `Hola, perdón por no contestar. Soy ${name}. Puedes reservar aquí:${link || ' respóndeme por mensaje.'} Responde STOP para cancelar.`
    : `Hi, sorry I missed your call. It's ${name}. You can book here:${link || ' just text me back.'} Reply STOP to opt out.`;
}
