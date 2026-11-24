import { describe, expect, it } from 'vitest';
import { cleanReply, replyPrompt, replyWriterFromEnv, type ReviewReplyInput } from './reply';

// RV-D2: one suggested reply, Claude first and OpenAI when Claude is unavailable.
const input: ReviewReplyInput = { businessName: 'Ari Monroe Hair', reviewerName: 'Keisha D.', rating: 5, tags: ['great_results', 'healthy_hair'], body: 'Best silk press.', serviceName: 'Silk press', source: 'mova', locale: 'en-US' };
const env = (values: Record<string, string>) => (name: string) => values[name];
const claudeOk = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 30 } }), { status: 200 });
const openAiOk = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 30 } }), { status: 200 });
const keys = { MOVA_REVIEW_REPLY_AI: 'live', ANTHROPIC_API_KEY: 'k', MOVA_CLAUDE_MODEL: 'claude-test', OPENAI_API_KEY: 'o', MOVA_OPENAI_MODEL: 'gpt-test' };

describe('review reply suggestions', () => {
  it('RV-AI-01 stays off unless switched on', () => {
    expect(replyWriterFromEnv(env({}))).toBeNull();
    expect(replyWriterFromEnv(env({ MOVA_REVIEW_REPLY_AI: 'off', ANTHROPIC_API_KEY: 'k', MOVA_CLAUDE_MODEL: 'm' }))).toBeNull();
  });

  it('RV-AI-02 asks Claude first', async () => {
    const calls: string[] = [];
    const writer = replyWriterFromEnv(env(keys), (async (url: string) => { calls.push(url); return claudeOk('Thank you, Keisha! So glad your ends feel healthy.'); }) as unknown as typeof fetch)!;
    const result = await writer.suggest(input);
    expect(calls).toEqual(['https://api.anthropic.com/v1/messages']);
    expect(result).toMatchObject({ servedBy: 'claude:claude-test', text: 'Thank you, Keisha! So glad your ends feel healthy.' });
  });

  it('RV-AI-03 uses OpenAI when Claude is unavailable', async () => {
    const calls: string[] = [];
    const writer = replyWriterFromEnv(env(keys), (async (url: string) => { calls.push(url); return url.includes('anthropic') ? new Response('overloaded', { status: 529 }) : openAiOk('Thank you, Keisha!'); }) as unknown as typeof fetch)!;
    const result = await writer.suggest(input);
    expect(calls).toHaveLength(2);
    expect(result.servedBy).toBe('openai:gpt-test');
  });

  it('RV-AI-04 fails rather than showing unusable text', async () => {
    const writer = replyWriterFromEnv(env(keys), (async (url: string) => url.includes('anthropic') ? claudeOk('Hi [name]!') : openAiOk('')) as unknown as typeof fetch)!;
    await expect(writer.suggest(input)).rejects.toThrow();
  });

  it('RV-AI-05 the prompt carries the review and the rules', () => {
    const prompt = replyPrompt({ ...input, rating: 2, locale: 'es-US' });
    expect(prompt).toContain('Spanish');
    expect(prompt).toContain('"Keisha"');
    expect(prompt).toContain('Never offer discounts');
    expect(prompt).toContain('3 stars or lower');
  });

  it('RV-AI-06 trims replies and drops quotes', () => {
    expect(cleanReply('  "Thank you so much!"  ')).toBe('Thank you so much!');
    expect(cleanReply('ok')).toBeNull();
    expect(cleanReply('Thanks {{name}}')).toBeNull();
  });

  it('RV-AI-07 the fake writer answers a low rating with care', async () => {
    const writer = replyWriterFromEnv(env({ MOVA_REVIEW_REPLY_AI: 'fake' }))!;
    expect((await writer.suggest({ ...input, rating: 2 })).text).toContain('make it right');
  });
});
