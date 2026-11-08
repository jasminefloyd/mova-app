// Task 5.4: the concierge's model adapter. The vendor waits on owner decision O8, so the only
// implementation is the deterministic fake in fake.ts. A real adapter must return the same shape
// and never produce reply text itself: replies are composed from the stylist's approved information.
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
};

export interface ConciergeModel {
  readonly name: string;
  classify(input: ModelInput): Promise<ModelDecision>;
}
