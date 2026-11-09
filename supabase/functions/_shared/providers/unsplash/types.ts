// Unsplash provider adapter (P6). Used for the profile cover only. Unsplash's API guidelines apply:
// hotlink the image URLs Unsplash returns, credit the photographer with a link to their profile, link to
// Unsplash, and trigger the download endpoint when a photo is used.

export type UnsplashPhoto = {
  id: string;
  alt: string;
  /** Small preview for the picker grid (hotlinked from images.unsplash.com). */
  thumbUrl: string;
  /** Regular size shown as the cover (hotlinked). */
  imageUrl: string;
  photographerName: string;
  /** Photographer's Unsplash profile, with attribution parameters added. */
  photographerUrl: string;
  /** The photo page on Unsplash, with attribution parameters added. */
  photoUrl: string;
  /** Server-only: the endpoint to call when the photo is used. Never sent to the browser. */
  downloadLocation: string | null;
};

export interface UnsplashProvider {
  readonly name: string;
  readonly live: boolean;
  search(query: string, perPage: number): Promise<UnsplashPhoto[]>;
  getPhoto(id: string): Promise<UnsplashPhoto | null>;
  trackDownload(downloadLocation: string): Promise<void>;
}

export class UnsplashProviderError extends Error {
  constructor(code: string) { super(code); this.name = 'UnsplashProviderError'; }
}
