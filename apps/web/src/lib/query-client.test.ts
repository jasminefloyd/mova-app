import { describe, expect, it } from 'vitest';
import { createArtistQueryClient, createClientQueryClient } from './query-client';

describe('role query caches', () => {
  it('keeps artist and client cache instances separate', () => {
    const artist = createArtistQueryClient();
    const client = createClientQueryClient();

    artist.setQueryData(['private', 'artist'], 'artist-only');
    expect(client.getQueryData(['private', 'artist'])).toBeUndefined();
    expect(artist).not.toBe(client);
  });
});
