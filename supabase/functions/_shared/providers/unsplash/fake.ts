// Fake Unsplash provider (P6). Sandbox and tests only. Photo ids and photographer names are invented and
// labelled "(sample)", and links go to Unsplash's home page, so nothing points at a real photographer.
import { UNSPLASH_HOME, withUnsplashUtm } from './attribution.ts';
import type { UnsplashPhoto, UnsplashProvider } from './types.ts';

const TOPICS = ['botanical', 'salon', 'texture', 'warm neutrals'] as const;

export function sampleSearch(query: string): UnsplashPhoto[] {
  const words = query.toLowerCase().replace(/-/g, ' ');
  const topic = TOPICS.find((item) => words.includes(item)) ?? 'botanical';
  return Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const id = `mova-sample-${topic.replace(/\s+/g, '-')}-${number}`;
    return {
      id,
      alt: `Sample ${topic} photo ${number}`,
      thumbUrl: `https://images.unsplash.com/photo-${id}?w=400&q=80`,
      imageUrl: `https://images.unsplash.com/photo-${id}?w=1200&q=80`,
      photographerName: `Sample photographer ${number} (sample)`,
      photographerUrl: withUnsplashUtm(UNSPLASH_HOME),
      photoUrl: withUnsplashUtm(UNSPLASH_HOME),
      downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
    };
  });
}

export class FakeUnsplashProvider implements UnsplashProvider {
  readonly name = 'fake';
  readonly live = false;
  readonly downloads: string[] = [];

  search(query: string, perPage: number): Promise<UnsplashPhoto[]> {
    return Promise.resolve(sampleSearch(query).slice(0, Math.max(1, Math.min(perPage, 30))));
  }

  getPhoto(id: string): Promise<UnsplashPhoto | null> {
    return Promise.resolve(sampleSearch(id).find((photo) => photo.id === id) ?? null);
  }

  trackDownload(downloadLocation: string): Promise<void> {
    this.downloads.push(downloadLocation);
    return Promise.resolve();
  }
}
