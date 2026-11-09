// Attribution helpers (P6). Unsplash asks for UTM parameters on every link back to Unsplash.
export const UNSPLASH_UTM = 'utm_source=mova&utm_medium=referral';

/** Adds Mova's UTM parameters to an Unsplash link. Anything that is not an unsplash.com link is refused. */
export function withUnsplashUtm(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || (parsed.hostname !== 'unsplash.com' && parsed.hostname !== 'www.unsplash.com')) throw new Error('UNSPLASH_LINK_INVALID');
  parsed.searchParams.set('utm_source', 'mova');
  parsed.searchParams.set('utm_medium', 'referral');
  return parsed.toString();
}

/** The Unsplash home page link used for the "Unsplash" credit. */
export const UNSPLASH_HOME = `https://unsplash.com/?${UNSPLASH_UTM}`;

/** True when an image URL is one Unsplash serves (images.unsplash.com over https). */
export function isUnsplashImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'images.unsplash.com';
  } catch { return false; }
}
