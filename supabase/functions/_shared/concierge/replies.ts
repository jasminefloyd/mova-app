// Fixed reply templates for the concierge (task 5.4). The model never writes free text: every reply
// is one of these, filled with the stylist's approved answers, catalog prices and real open times.
export type Locale = 'en-US' | 'es-US';

const T = {
  'en-US': {
    greeting: (name: string) => `Hi! I'm ${name}'s booking assistant. I can answer questions, share prices and find open times.`,
    price: (service: string, price: string) => `${service} is ${price}.`,
    priceFrom: (service: string, price: string) => `${service} starts at ${price}. The final price depends on your hair; ${'{name}'} confirms it at your visit.`,
    whichService: (list: string) => `Happy to check times. Which service would you like? ${list}`,
    times: (service: string, list: string, link: string) => `Here are the next open times for ${service}: ${list}. Book here: ${link}`,
    requestTimes: (service: string, list: string, link: string) => `These times are available to request for ${service}: ${list}. Your stylist confirms each request. Request here: ${link}`,
    noTimes: (service: string) => `I don't see open times for ${service} in the next two weeks. I've let your stylist know so they can follow up.`,
    quote: (name: string) => `Thanks! ${name} prices this one personally. Tell me a little about your hair now and the look you want, and add photos if you can. ${name} will reply with a quote.`,
    handoff: (name: string) => `Thanks for your message. I've passed it to ${name}, who will reply to you directly.`,
    paused: (name: string) => `Thanks for your message. ${name} will reply to you directly.`,
  },
  'es-US': {
    greeting: (name: string) => `¡Hola! Soy el asistente de reservas de ${name}. Puedo responder preguntas, compartir precios y buscar horarios disponibles.`,
    price: (service: string, price: string) => `${service} cuesta ${price}.`,
    priceFrom: (service: string, price: string) => `${service} desde ${price}. El precio final depende de tu cabello; ${'{name}'} lo confirma en tu cita.`,
    whichService: (list: string) => `Con gusto busco horarios. ¿Qué servicio te interesa? ${list}`,
    times: (service: string, list: string, link: string) => `Estos son los próximos horarios para ${service}: ${list}. Reserva aquí: ${link}`,
    requestTimes: (service: string, list: string, link: string) => `Puedes solicitar estos horarios para ${service}: ${list}. Tu estilista confirma cada solicitud. Solicita aquí: ${link}`,
    noTimes: (service: string) => `No veo horarios disponibles para ${service} en las próximas dos semanas. Ya le avisé a tu estilista para que te contacte.`,
    quote: (name: string) => `¡Gracias! ${name} cotiza este servicio personalmente. Cuéntame cómo está tu cabello ahora y qué look quieres, y agrega fotos si puedes. ${name} te responderá con una cotización.`,
    handoff: (name: string) => `Gracias por tu mensaje. Se lo pasé a ${name}, quien te responderá directamente.`,
    paused: (name: string) => `Gracias por tu mensaje. ${name} te responderá directamente.`,
  },
} as const;

export const replies = (locale: Locale) => T[locale];

export function formatMoney(minor: number, locale: Locale) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
}

export function formatSlot(startsAt: string, timeZone: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(startsAt));
}

export function joinList(items: string[], locale: Locale) {
  return new Intl.ListFormat(locale, { style: 'long', type: 'disjunction' }).format(items);
}
