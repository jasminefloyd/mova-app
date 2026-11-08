import type { ConciergeModel } from '../providers/ai/types.ts';
import { authorizeConciergeTool, validateConciergeOutput, type ToolName } from '../concierge-policy.ts';
import { formatMoney, formatSlot, joinList, replies, type Locale } from './replies.ts';

// Task 5.4: one concierge turn. The model only classifies the message; this engine decides what to
// do, composes the reply from the stylist's approved information and hands off whenever it is unsure,
// out of policy, or a tool fails. Pure apart from the injected model and availability lookup.
export const CONFIDENCE_FLOOR = 0.6;

export type TurnKnowledge = { id: string; kind: string; question: string; answer_en: string; answer_es: string | null };
export type TurnService = { id: string; name: string; price_minor: number; price_type?: 'fixed' | 'from' | 'quote' };
export type OpenTime = { starts_at: string; time_zone: string; location_name: string; booking_mode: 'instant' | 'request' };

export type TurnContext = {
  stylistName: string;
  bookUrl: string;
  locale: Locale;
  languages: Locale[];
  permissions: Record<string, boolean>;
  bookingMode?: 'instant' | 'request';
  paymentCollector?: 'artist' | 'salon';
  knowledge: TurnKnowledge[];
  services: TurnService[];
};

export type TurnDeps = { model: ConciergeModel; findTimes: (serviceId: string) => Promise<OpenTime[]> };

export type HandoffType = 'quote' | 'exception' | 'complaint' | 'low_confidence' | 'tool_error';
export type TurnResult = {
  decision: 'replied' | 'handoff' | 'blocked';
  intent: string;
  confidence: number;
  reply: string;
  handoff?: { type: HandoffType; summary: string };
  quote?: { service_category: string; details: { message: string; service_id?: string } };
  toolCalls: Array<{ tool: ToolName | 'answer_from_knowledge'; allowed: boolean; reason: string }>;
  offeredTimes?: OpenTime[];
  model: string;
  /** Model spend for this turn in millionths of a dollar (O8 monthly cap). */
  costMicros: number;
};

const summary = (message: string) => message.replace(/\s+/g, ' ').trim().slice(0, 500);

export async function handleTurn(message: string, context: TurnContext, deps: TurnDeps): Promise<TurnResult> {
  const r = replies(context.locale);
  const name = context.stylistName;
  const base = { model: deps.model.name, costMicros: 0, toolCalls: [] as TurnResult['toolCalls'] };
  const handoff = (type: HandoffType, intent: string, confidence: number, extra: Partial<TurnResult> = {}): TurnResult => ({
    ...base, ...extra, decision: 'handoff', intent, confidence, reply: r.handoff(name), handoff: { type, summary: summary(message) },
  });
  const decision = await deps.model.classify({
    message, locale: context.locale,
    knowledge: context.knowledge.map((item) => ({ id: item.id, kind: item.kind, text: [item.question, item.answer_en, item.answer_es ?? ''].join(' ') })),
    services: context.services.map((item) => ({ id: item.id, name: item.name })),
  }).catch(() => null);
  if (!decision) return handoff('tool_error', 'unknown', 0);
  base.model = decision.servedBy ?? deps.model.name;
  base.costMicros = decision.costMicros ?? 0;
  const { intent, confidence } = decision;
  if (intent === 'complaint') return handoff('complaint', intent, confidence);
  if (!context.languages.includes(context.locale)) return handoff('exception', intent, confidence);
  if (confidence < CONFIDENCE_FLOOR) return handoff('low_confidence', intent, confidence);
  const service = context.services.find((item) => item.id === decision.serviceId);
  const prices = context.services.map((item) => item.price_minor);
  const checked = (reply: string, extra: Partial<TurnResult> = {}): TurnResult => {
    const verdict = validateConciergeOutput(reply, { ...(context.bookingMode ? { bookingMode: context.bookingMode } : {}), allowedCatalogPricesMinor: prices });
    if (!verdict.allowed) return { ...base, ...extra, decision: 'blocked', intent, confidence, reply: r.handoff(name), handoff: { type: 'exception', summary: `${verdict.reason}: ${summary(message)}` } };
    return { ...base, ...extra, decision: 'replied', intent, confidence, reply };
  };

  if (intent === 'greeting') return checked(r.greeting(name));

  if (intent === 'answer') {
    const item = context.knowledge.find((entry) => entry.id === decision.knowledgeId);
    const answer = item ? (context.locale === 'es-US' ? item.answer_es : item.answer_en) : null;
    // Only the stylist's approved words go out; a missing translation is a handoff, never a guess.
    if (!answer) return handoff('low_confidence', intent, confidence);
    return checked(answer, { toolCalls: [{ tool: 'answer_from_knowledge', allowed: true, reason: item!.id }] });
  }

  if (intent === 'price') {
    if (!service) return handoff('low_confidence', intent, confidence);
    if (service.price_type === 'quote') return quoteTurn();
    const price = formatMoney(service.price_minor, context.locale);
    const text = service.price_type === 'from' ? r.priceFrom(service.name, price).replace('{name}', name) : r.price(service.name, price);
    return checked(text, { toolCalls: [{ tool: 'get_services', allowed: true, reason: 'permitted' }] });
  }

  if (intent === 'quote') return quoteTurn();

  if (intent === 'offer_times') {
    if (!service) return checked(r.whichService(joinList(context.services.filter((item) => item.price_type !== 'quote').map((item) => item.name), context.locale)));
    const policy = authorizeConciergeTool('search_availability', { ...(context.bookingMode ? { bookingMode: context.bookingMode } : {}), ...(context.paymentCollector ? { paymentCollector: context.paymentCollector } : {}), allowedCatalogPricesMinor: prices, permissions: context.permissions });
    const toolCalls: TurnResult['toolCalls'] = [{ tool: 'search_availability', allowed: policy.allowed, reason: policy.reason }];
    if (!policy.allowed) return handoff('exception', intent, confidence, { toolCalls });
    let times: OpenTime[];
    try {
      // Offer the first open time on each of the next three days that have one.
      const seen = new Set<string>();
      times = (await deps.findTimes(service.id)).filter((time) => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: time.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time.starts_at));
        if (seen.has(day)) return false; seen.add(day); return true;
      }).slice(0, 3);
    } catch { return handoff('tool_error', intent, confidence, { toolCalls }); }
    if (!times.length) return { ...base, toolCalls, decision: 'handoff', intent, confidence, reply: r.noTimes(service.name), handoff: { type: 'exception', summary: `no_open_times: ${summary(message)}` } };
    const list = joinList(times.map((time) => `${formatSlot(time.starts_at, time.time_zone, context.locale)} (${time.location_name})`), context.locale);
    const text = times.every((time) => time.booking_mode === 'request') ? r.requestTimes(service.name, list, context.bookUrl) : r.times(service.name, list, context.bookUrl);
    return checked(text, { toolCalls, offeredTimes: times });
  }

  return handoff('low_confidence', intent, confidence);

  function quoteTurn(): TurnResult {
    const policy = authorizeConciergeTool('create_quote_request', { allowedCatalogPricesMinor: prices, permissions: context.permissions });
    return {
      ...base, decision: 'handoff', intent: 'quote', confidence: confidence, reply: r.quote(name),
      handoff: { type: 'quote', summary: summary(message) },
      quote: { service_category: (service?.name ?? 'Quote').slice(0, 120), details: { message: summary(message), ...(service ? { service_id: service.id } : {}) } },
      toolCalls: [{ tool: 'create_quote_request', allowed: policy.allowed, reason: policy.reason }],
    };
  }
}
