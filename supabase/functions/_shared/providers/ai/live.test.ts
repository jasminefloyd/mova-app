import { describe, expect, it, vi } from 'vitest';
import { ClaudeConciergeModel, conciergeModelFromEnv, FallbackConciergeModel, MONTHLY_CAP_MICROS, OpenAiConciergeModel, parseDecision } from './live';

// Task 5.4 / O8. No live calls: every request goes to an injected fetcher.
const input = { message: 'How much is a silk press?', locale: 'en-US' as const, knowledge: [{ id: 'k1', kind: 'faq', text: 'Where do I park?' }], services: [{ id: 's1', name: 'Silk press' }] };
const pricing = { inputMicrosPerToken: 3, outputMicrosPerToken: 15 };
const claudeReply = (text: string, ok = true) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 400, output_tokens: 20 } }), { status: ok ? 200 : 529 }));
const openAiReply = (text: string) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 380, completion_tokens: 18 } }), { status: 200 }));

describe('parseDecision', () => {
  it('accepts only known intents and ids we sent', () => {
    expect(parseDecision('{"intent":"price","confidence":0.92,"serviceId":"s1"}', input)).toEqual({ intent: 'price', confidence: 0.92, serviceId: 's1' });
    expect(parseDecision('{"intent":"answer","confidence":0.9,"knowledgeId":"made-up"}', input)).toEqual({ intent: 'answer', confidence: 0.9 });
    expect(parseDecision('{"intent":"book_now","confidence":0.9}', input)).toBeNull();
    expect(parseDecision('{"intent":"price","confidence":7}', input)).toBeNull();
    expect(parseDecision('Sure! It is $95.', input)).toBeNull();
  });
});

describe('Claude primary with OpenAI fallback (O8)', () => {
  it('calls Claude with the key in a header and prices the tokens', async () => {
    const fetcher = claudeReply('{"intent":"price","confidence":0.9,"serviceId":"s1"}');
    const decision = await new ClaudeConciergeModel('sk-ant-test', 'claude-test', pricing, fetcher).classify(input);
    expect(decision).toMatchObject({ intent: 'price', serviceId: 's1', costMicros: 400 * 3 + 20 * 15, servedBy: 'claude:claude-test' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    expect(String(init!.body)).not.toContain('sk-ant-test');
  });
  it('falls back to OpenAI when Claude errors or returns invalid output', async () => {
    const openAi = new OpenAiConciergeModel('sk-openai-test', 'gpt-test', pricing, openAiReply('{"intent":"greeting","confidence":0.8}'));
    for (const claude of [claudeReply('', false), claudeReply('not json')]) {
      const decision = await new FallbackConciergeModel(new ClaudeConciergeModel('k', 'claude-test', pricing, claude), openAi).classify(input);
      expect(decision).toMatchObject({ intent: 'greeting', servedBy: 'openai:gpt-test', costMicros: 380 * 3 + 18 * 15 });
    }
  });
  it('throws when both fail, so the turn hands off', async () => {
    const both = new FallbackConciergeModel(new ClaudeConciergeModel('k', 'c', pricing, claudeReply('', false)), new OpenAiConciergeModel('k', 'o', pricing, openAiReply('nope')));
    await expect(both.classify(input)).rejects.toThrow();
  });
  it('builds from env: fake, live with keys, nothing otherwise', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    expect(conciergeModelFromEnv(env({ MOVA_CONCIERGE_MODEL: 'fake' }))?.name).toBe('fake-concierge-v1');
    expect(conciergeModelFromEnv(env({ MOVA_CONCIERGE_MODEL: 'live' }))).toBeNull();
    expect(conciergeModelFromEnv(env({ MOVA_CONCIERGE_MODEL: 'live', ANTHROPIC_API_KEY: 'a', MOVA_CLAUDE_MODEL: 'c' }))?.name).toBe('claude:c');
    expect(conciergeModelFromEnv(env({ MOVA_CONCIERGE_MODEL: 'live', ANTHROPIC_API_KEY: 'a', MOVA_CLAUDE_MODEL: 'c', OPENAI_API_KEY: 'o', MOVA_OPENAI_MODEL: 'g' }))?.name).toBe('claude:c+openai:g');
    expect(conciergeModelFromEnv(env({}))).toBeNull();
  });
  it('keeps the platform cap at $25 a month', () => expect(MONTHLY_CAP_MICROS).toBe(25_000_000));
});
