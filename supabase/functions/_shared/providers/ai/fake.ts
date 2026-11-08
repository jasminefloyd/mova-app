import type { ConciergeModel, ModelDecision, ModelInput } from './types.ts';

// Deterministic stand-in for the concierge model (no network, no vendor). Used by tests, the eval
// set and local/dev web chat while O8 is open. It only classifies; it never writes reply text.
const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (value: string) => fold(value).split(/[^a-z0-9]+/).filter((word) => word.length > 2);
const STOP = new Set(['the', 'and', 'you', 'your', 'for', 'can', 'what', 'how', 'que', 'los', 'las', 'para', 'con', 'una', 'por', 'del', 'tus', 'como', 'est', 'are', 'does', 'have', 'there', 'puedo', 'tienes']);

const COMPLAINT = /\b(refund|complain|complaint|angry|terrible|awful|ruined|burn(?:ed|t)?|damaged|lawyer|sue|reembolso|queja|quemad[oa]|arruin|danad[oa]|abogad[oa]|horrible|pesim[oa])\b/;
const QUOTE = /\b(quote|estimate|color correction|big chop|extensions?|bridal|wedding|consult(?:ation)?|cotizacion|presupuesto|correccion de color|extensiones|novia|boda|consulta)\b/;
const TIMES = /\b(available|availability|opening|openings|open|book|booking|appointment|slot|slots|when|today|tomorrow|this week|next week|disponible|disponibilidad|cita|reservar|reserva|horario|cuando|hoy|manana|esta semana|proxima semana|hueco|espacio)\b/;
const PRICE = /\b(how much|price|prices|cost|costs|rate|cuanto|precio|precios|cuesta|cobras|vale)\b/;
// How to get ready for a visit: answered from the stylist's prep notes, never with booking times.
const PREP = /\b(how should (my hair|i come|i arrive|i prepare)|how do i prepare|prepare|prep|before (my|the) (appointment|visit)|come with|como (debo|tengo que) (venir|llegar|traer)|preparar|prepararme|antes de (mi|la) cita)\b/;
const GREETING = /^(hi|hello|hey|hola|buenas|buenos dias|buenas tardes)[!.\s]*$/;

export class FakeConciergeModel implements ConciergeModel {
  readonly name = 'fake-concierge-v1';

  classify(input: ModelInput): Promise<ModelDecision> {
    const text = fold(input.message).replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    const service = input.services
      .map((item) => ({ item, score: words(item.name).filter((word) => text.includes(word)).length / Math.max(1, words(item.name).length) }))
      .filter((match) => match.score >= 0.5)
      .sort((a, b) => b.score - a.score)[0]?.item;
    const serviceId = service?.id;
    if (COMPLAINT.test(text)) return Promise.resolve({ intent: 'complaint', confidence: 0.95 });
    if (QUOTE.test(text)) return Promise.resolve({ intent: 'quote', confidence: 0.85, ...(serviceId ? { serviceId } : {}) });
    if (PRICE.test(text) && serviceId) return Promise.resolve({ intent: 'price', confidence: 0.9, serviceId });
    const prep = PREP.test(text) ? input.knowledge.find((item) => item.kind === 'prep') : undefined;
    if (prep) return Promise.resolve({ intent: 'answer', confidence: 0.85, knowledgeId: prep.id });
    if (TIMES.test(text) && serviceId) return Promise.resolve({ intent: 'offer_times', confidence: 0.9, serviceId });
    const asked = [...new Set(words(input.message).filter((word) => !STOP.has(word)))];
    const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
    const best = input.knowledge
      .map((item) => {
        const known = words(item.text);
        const hits = asked.filter((word) => known.some((other) => same(word, other))).length;
        return { item, score: asked.length ? hits / asked.length : 0, hits };
      })
      .filter((match) => match.hits > 0)
      .sort((a, b) => b.score - a.score || b.hits - a.hits)[0];
    if (best && best.score >= 0.5) return Promise.resolve({ intent: 'answer', confidence: Math.min(0.95, 0.55 + best.score / 2), knowledgeId: best.item.id });
    if (TIMES.test(text)) return Promise.resolve({ intent: 'offer_times', confidence: 0.75 });
    if (GREETING.test(text)) return Promise.resolve({ intent: 'greeting', confidence: 0.9 });
    return Promise.resolve({ intent: 'unknown', confidence: 0.2 });
  }
}
