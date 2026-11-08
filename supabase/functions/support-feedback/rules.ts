// Task 3.5: validation for stylist feedback. Pure so it runs under Vitest and Deno alike.
export const FEEDBACK_TYPES = ['idea', 'broken', 'question'] as const;
export type FeedbackType = typeof FEEDBACK_TYPES[number];
export const MESSAGE_LIMIT = 4000;
export const SCREENSHOT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const HOURLY_LIMIT = 10;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export type FeedbackInput = { type: FeedbackType; message: string; screen: string | null; app_version: string | null; locale: 'en-US' | 'es-US'; screenshot_path: string | null };

/** Returns a clean row, or an error code. The screen keeps only the path, never query strings or IDs in the query. */
export function parseFeedback(body: unknown, businessId: string, userId: string): FeedbackInput | { code: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { code: 'INVALID_REQUEST' };
  const input = body as Record<string, unknown>;
  if (!FEEDBACK_TYPES.includes(input.type as FeedbackType)) return { code: 'FEEDBACK_TYPE_INVALID' };
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message || message.length > MESSAGE_LIMIT) return { code: 'FEEDBACK_MESSAGE_INVALID' };
  let screenshot: string | null = null;
  if (input.screenshot_path != null) {
    const path = String(input.screenshot_path);
    const [business, user, file] = path.split('/');
    const [name, ext] = (file ?? '').split('.');
    if (business !== businessId || user !== userId || !uuid.test(name ?? '') || !Object.values(SCREENSHOT_TYPES).includes(ext ?? '') || path.split('/').length !== 3) return { code: 'FEEDBACK_SCREENSHOT_INVALID' };
    screenshot = path;
  }
  const rawScreen = text(input.screen, 400);
  const screen = rawScreen ? rawScreen.split(/[?#]/)[0]!.slice(0, 200) : null;
  return {
    type: input.type as FeedbackType,
    message,
    screen,
    app_version: text(input.app_version, 60),
    locale: input.locale === 'es-US' ? 'es-US' : 'en-US',
    screenshot_path: screenshot,
  };
}

/** A short device description from the User-Agent; no fingerprinting beyond what the header already says. */
export function deviceFromUserAgent(userAgent: string | null) {
  return userAgent ? userAgent.replace(/[^\x20-\x7e]/g, '').slice(0, 300) : null;
}
