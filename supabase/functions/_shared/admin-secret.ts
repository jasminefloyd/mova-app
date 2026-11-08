/** Constant-time check for the super admin API secret. A missing or short secret (under 32 characters) never matches. */
export function sameSecret(given: string | null, expected: string | undefined) {
  if (!given || !expected || expected.length < 32 || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
