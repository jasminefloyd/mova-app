import type { ConciergeIntent, ConciergeModel, ModelDecision, ModelInput } from './types.ts';
import { FakeConciergeModel } from './fake.ts';

// Task 5.4, owner decision O8: Claude primary, OpenAI fallback. Both only classify the message into
// a fixed JSON shape; anything else is rejected and the turn hands off. No test calls these live:
// tests inject `fetcher`.
const INTENTS: ConciergeIntent[] = ['answer', 'price', 'offer_times', 'quote', 'complaint', 'greeting', 'unknown'];

export function classificationPrompt(input: ModelInput) {
  return [
    'You classify one message a client sent to a hair stylist. Reply with JSON only, no prose:',
    '{"intent":"answer|price|offer_times|quote|complaint|greeting|unknown","confidence":0-1,"knowledgeId":"<id or omit>","serviceId":"<id or omit>"}',
    'answer = the client asks something one knowledge item answers (give its id). price = asks a service price (give serviceId).',
    'offer_times = wants to book or asks for open times (serviceId if named). quote = custom work, color correction, bridal, extensions.',
    'complaint = unhappy, refund, damage, injury. greeting = only a greeting. unknown = anything else. Be cautious: use low confidence when unsure.',
    `Locale: ${input.locale}`,
    `Knowledge: ${JSON.stringify(input.knowledge.map((item) => ({ id: item.id, kind: item.kind, text: item.text.slice(0, 400) })))}`,
    `Services: ${JSON.stringify(input.services)}`,
    `Message: ${JSON.stringify(input.message.slice(0, 1000))}`,
  ].join('\n');
}

/** Validates model JSON; ids must be ones we sent. */
export function parseDecision(text: string, input: ModelInput): ModelDecision | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(match[0]); } catch { return null; }
  const intent = raw.intent as ConciergeIntent;
  const confidence = Number(raw.confidence);
  if (!INTENTS.includes(intent) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const knowledgeId = typeof raw.knowledgeId === 'string' && input.knowledge.some((item) => item.id === raw.knowledgeId) ? raw.knowledgeId : undefined;
  const serviceId = typeof raw.serviceId === 'string' && input.services.some((item) => item.id === raw.serviceId) ? raw.serviceId : undefined;
  return { intent, confidence, ...(knowledgeId ? { knowledgeId } : {}), ...(serviceId ? { serviceId } : {}) };
}

export type Pricing = { inputMicrosPerToken: number; outputMicrosPerToken: number };
const cost = (pricing: Pricing, input: number, output: number) => Math.ceil(input * pricing.inputMicrosPerToken + output * pricing.outputMicrosPerToken);

export class ClaudeConciergeModel implements ConciergeModel {
  readonly name: string;
  constructor(private readonly apiKey: string, private readonly model: string, private readonly pricing: Pricing, private readonly fetcher: typeof fetch = fetch) { this.name = `claude:${model}`; }
  async classify(input: ModelInput): Promise<ModelDecision> {
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 200, temperature: 0, messages: [{ role: 'user', content: classificationPrompt(input) }] }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json) throw new Error('CLAUDE_REQUEST_FAILED');
    const text = Array.isArray(json.content) ? json.content.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('') : '';
    const decision = parseDecision(text, input);
    if (!decision) throw new Error('CLAUDE_OUTPUT_INVALID');
    return { ...decision, servedBy: this.name, costMicros: cost(this.pricing, Number(json.usage?.input_tokens ?? 0), Number(json.usage?.output_tokens ?? 0)) };
  }
}

export class OpenAiConciergeModel implements ConciergeModel {
  readonly name: string;
  constructor(private readonly apiKey: string, private readonly model: string, private readonly pricing: Pricing, private readonly fetcher: typeof fetch = fetch) { this.name = `openai:${model}`; }
  async classify(input: ModelInput): Promise<ModelDecision> {
    const response = await this.fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0, max_tokens: 200, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: classificationPrompt(input) }] }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json) throw new Error('OPENAI_REQUEST_FAILED');
    const decision = parseDecision(String(json.choices?.[0]?.message?.content ?? ''), input);
    if (!decision) throw new Error('OPENAI_OUTPUT_INVALID');
    return { ...decision, servedBy: this.name, costMicros: cost(this.pricing, Number(json.usage?.prompt_tokens ?? 0), Number(json.usage?.completion_tokens ?? 0)) };
  }
}

/** Primary first; on any error or invalid output, the fallback; if both fail the turn hands off. */
export class FallbackConciergeModel implements ConciergeModel {
  readonly name: string;
  constructor(private readonly primary: ConciergeModel, private readonly fallback: ConciergeModel | null) { this.name = fallback ? `${primary.name}+${fallback.name}` : primary.name; }
  async classify(input: ModelInput): Promise<ModelDecision> {
    try { return await this.primary.classify(input); }
    catch (error) { if (!this.fallback) throw error; return await this.fallback.classify(input); }
  }
}

const num = (value: string | undefined, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; };

/**
 * MOVA_CONCIERGE_MODEL: 'fake' (default for tests/local) or 'live' (Claude + OpenAI fallback, O8).
 * 'live' needs ANTHROPIC_API_KEY; OPENAI_API_KEY adds the fallback. Model names and per-token prices
 * (millionths of a dollar per token, for the monthly cap) come from env. Returns null when not configured.
 */
export function conciergeModelFromEnv(env: (name: string) => string | undefined, fetcher: typeof fetch = fetch): ConciergeModel | null {
  const mode = env('MOVA_CONCIERGE_MODEL');
  if (mode === 'fake') return new FakeConciergeModel();
  if (mode !== 'live') return null;
  const claudeKey = env('ANTHROPIC_API_KEY');
  const claudeModel = env('MOVA_CLAUDE_MODEL');
  if (!claudeKey || !claudeModel) return null;
  const claude = new ClaudeConciergeModel(claudeKey, claudeModel, { inputMicrosPerToken: num(env('MOVA_CLAUDE_INPUT_MICROS_PER_TOKEN'), 3), outputMicrosPerToken: num(env('MOVA_CLAUDE_OUTPUT_MICROS_PER_TOKEN'), 15) }, fetcher);
  const openAiKey = env('OPENAI_API_KEY');
  const openAiModel = env('MOVA_OPENAI_MODEL');
  const openAi = openAiKey && openAiModel ? new OpenAiConciergeModel(openAiKey, openAiModel, { inputMicrosPerToken: num(env('MOVA_OPENAI_INPUT_MICROS_PER_TOKEN'), 3), outputMicrosPerToken: num(env('MOVA_OPENAI_OUTPUT_MICROS_PER_TOKEN'), 15) }, fetcher) : null;
  return new FallbackConciergeModel(claude, openAi);
}

/** O8: the platform-wide concierge spend cap, $25 a month, in millionths of a dollar. */
export const MONTHLY_CAP_MICROS = 25_000_000;
