// O1 (2026-11-08): hCaptcha on public forms (booking, review). Off unless
// MOVA_CAPTCHA_PROVIDER=hcaptcha. When on, a missing secret fails closed. Only the token and the site key
// go to hCaptcha; Mova does not forward the visitor's IP address.
export type CaptchaCheck = { ok: true } | { ok: false; status: 403 | 503; code: 'CAPTCHA_REQUIRED' | 'CAPTCHA_FAILED' | 'CAPTCHA_UNAVAILABLE' };
type Env = (name: string) => string | undefined;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

export function captchaEnabled(env: Env) {
  return env('MOVA_CAPTCHA_PROVIDER') === 'hcaptcha';
}

export async function checkCaptcha(token: unknown, env: Env, fetcher: Fetcher = fetch): Promise<CaptchaCheck> {
  if (!captchaEnabled(env)) return { ok: true };
  const secret = env('HCAPTCHA_SECRET');
  const sitekey = env('HCAPTCHA_SITE_KEY');
  if (!secret || !sitekey) return { ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' };
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return { ok: false, status: 403, code: 'CAPTCHA_REQUIRED' };
  try {
    const response = await fetcher(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, sitekey }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' };
    const result = await response.json() as { success?: unknown; sitekey?: unknown };
    if (result.success !== true) return { ok: false, status: 403, code: 'CAPTCHA_FAILED' };
    if (typeof result.sitekey === 'string' && result.sitekey !== sitekey) return { ok: false, status: 403, code: 'CAPTCHA_FAILED' };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, code: 'CAPTCHA_UNAVAILABLE' };
  }
}
