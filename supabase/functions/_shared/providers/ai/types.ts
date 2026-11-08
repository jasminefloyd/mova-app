// Task 5.4: the concierge's model adapter. Owner decision O8 (Nov 8): Claude is primary and OpenAI the
// fallback (live.ts); the deterministic fake (fake.ts) serves tests, the eval set and local runs. Every
// adapter only classifies — it never writes reply text; replies come from the stylist's approved info.
export type ConciergeIntent = 'answer' | 'price' | 'offer_times' | 'quote' | 'complaint' | 'greeting' | 'unknown';

/** text = the question and its approved answers in every language, for matching only. */
export type ModelKnowledge = { id: string; text: string; kind: string };
export type ModelService = { id: string; name: string };

export type ModelInput = {
  message: string;
  locale: 'en-US' | 'es-US';
  knowledge: ModelKnowledge[];
  services: ModelService[];
};

export type ModelDecision = {
  intent: ConciergeIntent;
  /** 0–1. Below the engine's threshold the turn goes to the stylist. */
  confidence: number;
  knowledgeId?: string;
  serviceId?: string;
  /** What the call cost, in millionths of a dollar (0 for the fake). Counts toward the monthly cap. */
  costMicros?: number;
  /** Which model actually answered (the fallback when the primary failed). */
  servedBy?: string;
};

export interface ConciergeModel {
  readonly name: string;
  classify(input: ModelInput): Promise<ModelDecision>;
}
