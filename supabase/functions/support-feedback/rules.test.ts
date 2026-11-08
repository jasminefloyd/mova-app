import { deviceFromUserAgent, parseFeedback } from './rules.ts';

// Deno test (run by scripts/fn-check.mjs).
const same = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const business = 'e2500000-0000-4000-8000-000000000001';
const user = 'e2500000-0000-4000-8000-000000000777';
const shot = `${business}/${user}/0b7a5d0e-1c1f-4a37-9b2a-2f9f7a6f1c11.png`;

Deno.test('TC-SUPPORT-04 accepts each type and strips query strings from the screen', () => {
  for (const type of ['idea', 'broken', 'question']) {
    same(parseFeedback({ type, message: '  Calendar froze  ', screen: '/BID-1/calendar?client=CID-2#x', app_version: '1.0.0', locale: 'es-US' }, business, user),
      { type, message: 'Calendar froze', screen: '/BID-1/calendar', app_version: '1.0.0', locale: 'es-US', screenshot_path: null }, type);
  }
});

Deno.test('TC-SUPPORT-04 rejects bad types and empty or long messages', () => {
  same(parseFeedback({ type: 'praise', message: 'x' }, business, user), { code: 'FEEDBACK_TYPE_INVALID' }, 'type');
  same(parseFeedback({ type: 'idea', message: '   ' }, business, user), { code: 'FEEDBACK_MESSAGE_INVALID' }, 'empty');
  same(parseFeedback({ type: 'idea', message: 'x'.repeat(4001) }, business, user), { code: 'FEEDBACK_MESSAGE_INVALID' }, 'long');
  same(parseFeedback(null, business, user), { code: 'INVALID_REQUEST' }, 'null');
});

Deno.test('TC-SUPPORT-04 only accepts screenshots under the caller folder', () => {
  same((parseFeedback({ type: 'broken', message: 'x', screenshot_path: shot }, business, user) as { screenshot_path: string }).screenshot_path, shot, 'own');
  same(parseFeedback({ type: 'broken', message: 'x', screenshot_path: shot.replace(user, business) }, business, user), { code: 'FEEDBACK_SCREENSHOT_INVALID' }, 'other user');
  same(parseFeedback({ type: 'broken', message: 'x', screenshot_path: `${shot}/../x.png` }, business, user), { code: 'FEEDBACK_SCREENSHOT_INVALID' }, 'traversal');
  same(parseFeedback({ type: 'broken', message: 'x', screenshot_path: shot.replace('.png', '.gif') }, business, user), { code: 'FEEDBACK_SCREENSHOT_INVALID' }, 'type');
});

Deno.test('TC-SUPPORT-04 keeps the device header printable', () => {
  same(deviceFromUserAgent('Mozilla/5.0 (iPhone)\u0000'), 'Mozilla/5.0 (iPhone)', 'printable');
  same(deviceFromUserAgent(null), null, 'null');
});
