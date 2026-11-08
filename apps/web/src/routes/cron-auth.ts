// Task 4.6: one check for every scheduled route. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// Constant-time comparison; a missing secret always fails closed.
export function cronAuthorized(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= header.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}
