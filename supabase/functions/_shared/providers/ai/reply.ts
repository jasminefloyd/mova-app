// RV-D2: one suggested reply to a review, written for the stylist to edit. Claude first; OpenAI when Claude is
// unavailable or returns nothing usable (the same order as the concierge, O8). Tests inject `fetcher`.

export type ReviewReplyInput = {
  businessName: string; reviewerName: string; rating: number; tags: string[]; body: string;
  serviceName: string | null; source: 'mova' | 'google'; locale: 'en-US' | 'es-US';
};
export type ReviewReplySuggestion = { text: string; servedBy: string; costMicros: number };
export interface ReviewReplyWriter { readonly name: string; suggest(input: ReviewReplyInput): Promise<ReviewReplySuggestion>; }
type Pricing = { inputMicrosPerToken: number; outputMicrosPerToken: number };

const TAG_WORDS: Record<string, string> = { great_results: 'great results', listened_to_me: 'listened to me', on_time: 'on time', clean_space: 'clean space', healthy_hair: 'healthy hair' };
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 40) ?? '';

export function replyPrompt(input: ReviewReplyInput) {
  const spanish = input.locale === 'es-US';
  return [
    `You write a short reply from a hairstylist, ${JSON.stringify(input.businessName)}, to a client's ${input.source === 'google' ? 'Google' : 'Mova'} review.`,
    `Write it in ${spanish ? 'Spanish (US)' : 'English (US)'}, in the stylist's own warm, natural voice, first person.`,
    'Rules: 1 to 3 short sentences, under 60 words. Use the client\'s first name once if it is given. Mention one specific thing from the review.',
    'No emoji, no hashtags, no quotation marks, no sign-off or signature, no placeholders like [name].',
    'Never offer discounts, refunds or free services, never promise anything, never mention other clients, never repeat personal details.',
    'If the rating is 3 stars or lower: thank them, acknowledge the problem without arguing or blaming, and invite them to reach out directly so you can make it right.',
    'Reply with the reply text only.',
    `Client first name: ${JSON.stringify(firstName(input.reviewerName))}`,
    `Rating: ${Math.round(input.rating)} of 5`,
    `Service: ${JSON.stringify(input.serviceName ?? '')}`,
    `What stood out: ${JSON.stringify(input.tags.map((tag) => TAG_WORDS[tag] ?? '').filter(Boolean))}`,
    `Review: ${JSON.stringify(input.body.slice(0, 1500))}`,
  ].join('\n');
}

/** Trims the model's text to a clean reply, or null when it isn't usable. */
export function cleanReply(raw: string): string | null {
  let text = raw.replace(/\r/g, '').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
  text = text.replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ');
  if (!text || text.length < 8 || /\[[^\]]*\]|\{\{|<\/?[a-z]/i.test(text)) return null;
  if (text.length > 600) text = text.slice(0, 600).replace(/\s+\S*$/, '').trim();
  return text;
}

const cost = (pricing: Pricing, input: number, output: number) => Math.ceil(input * pricing.inputMicrosPerToken + output * pricing.outputMicrosPerToken);

export class ClaudeReplyWriter implements ReviewReplyWriter {
  readonly name: string;
  constructor(private readonly apiKey: string, private readonly model: string, private readonly pricing: Pricing, private readonly fetcher: typeof fetch = fetch) { this.name = `claude:${model}`; }
  async suggest(input: ReviewReplyInput): Promise<ReviewReplySuggestion> {
    const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: 300, temperature: 0.4, messages: [{ role: 'user', content: replyPrompt(input) }] }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json) throw new Error('CLAUDE_REQUEST_FAILED');
    const raw = Array.isArray(json.content) ? json.content.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('') : '';
    const text = cleanReply(raw);
    if (!text) throw new Error('CLAUDE_OUTPUT_INVALID');
    return { text, servedBy: this.name, costMicros: cost(this.pricing, Number(json.usage?.input_tokens ?? 0), Number(json.usage?.output_tokens ?? 0)) };
  }
}

export class OpenAiReplyWriter implements ReviewReplyWriter {
  readonly name: string;
  constructor(private readonly apiKey: string, private readonly model: string, private readonly pricing: Pricing, private readonly fetcher: typeof fetch = fetch) { this.name = `openai:${model}`; }
  async suggest(input: ReviewReplyInput): Promise<ReviewReplySuggestion> {
    const response = await this.fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0.4, max_tokens: 300, messages: [{ role: 'user', content: replyPrompt(input) }] }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json) throw new Error('OPENAI_REQUEST_FAILED');
    const text = cleanReply(String(json.choices?.[0]?.message?.content ?? ''));
    if (!text) throw new Error('OPENAI_OUTPUT_INVALID');
    return { text, servedBy: this.name, costMicros: cost(this.pricing, Number(json.usage?.prompt_tokens ?? 0), Number(json.usage?.completion_tokens ?? 0)) };
  }
}

/** Deterministic writer for tests and local work. Never calls a provider. */
export class FakeReplyWriter implements ReviewReplyWriter {
  readonly name = 'fake';
  async suggest(input: ReviewReplyInput): Promise<ReviewReplySuggestion> {
    const name = firstName(input.reviewerName);
    const es = input.locale === 'es-US';
    const text = input.rating <= 3
      ? (es ? `Gracias por contarme, ${name}. Siento que no saliera como esperabas; escríbeme y lo arreglamos.` : `Thank you for telling me, ${name}. I'm sorry it wasn't what you hoped for. Please reach out so I can make it right.`)
      : (es ? `¡Gracias, ${name}! Me alegra mucho que te encantara. Te espero pronto.` : `Thank you, ${name}! I'm so glad you loved it. See you next time.`);
    return { text, servedBy: this.name, costMicros: 0 };
  }
}

export class FallbackReplyWriter implements ReviewReplyWriter {
  readonly name: string;
  constructor(private readonly primary: ReviewReplyWriter, private readonly fallback: ReviewReplyWriter | null) { this.name = fallback ? `${primary.name}+${fallback.name}` : primary.name; }
  async suggest(input: ReviewReplyInput): Promise<ReviewReplySuggestion> {
    try { return await this.primary.suggest(input); }
    catch (error) { if (!this.fallback) throw error; return await this.fallback.suggest(input); }
  }
}

const num = (value: string | undefined, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; };

/**
 * MOVA_REVIEW_REPLY_AI: unset or 'off' (default) = no suggestions; 'fake' = local/test writer; 'live' = Claude,
 * with OpenAI as the fallback when its key and model are set. Uses the same keys and model names as the
 * concierge (ANTHROPIC_API_KEY, MOVA_CLAUDE_MODEL, OPENAI_API_KEY, MOVA_OPENAI_MODEL). Without OpenAI, Claude
 * alone; without Claude but with OpenAI, OpenAI alone. Returns null when nothing usable is configured.
 */
export function replyWriterFromEnv(env: (name: string) => string | undefined, fetcher: typeof fetch = fetch): ReviewReplyWriter | null {
  const mode = env('MOVA_REVIEW_REPLY_AI');
  if (mode === 'fake') return new FakeReplyWriter();
  if (mode !== 'live') return null;
  const claudeKey = env('ANTHROPIC_API_KEY'); const claudeModel = env('MOVA_CLAUDE_MODEL');
  const openAiKey = env('OPENAI_API_KEY'); const openAiModel = env('MOVA_OPENAI_MODEL');
  const claude = claudeKey && claudeModel ? new ClaudeReplyWriter(claudeKey, claudeModel, { inputMicrosPerToken: num(env('MOVA_CLAUDE_INPUT_MICROS_PER_TOKEN'), 3), outputMicrosPerToken: num(env('MOVA_CLAUDE_OUTPUT_MICROS_PER_TOKEN'), 15) }, fetcher) : null;
  const openAi = openAiKey && openAiModel ? new OpenAiReplyWriter(openAiKey, openAiModel, { inputMicrosPerToken: num(env('MOVA_OPENAI_INPUT_MICROS_PER_TOKEN'), 3), outputMicrosPerToken: num(env('MOVA_OPENAI_OUTPUT_MICROS_PER_TOKEN'), 15) }, fetcher) : null;
  if (claude) return new FallbackReplyWriter(claude, openAi);
  return openAi;
}
