import type { QueryClient } from '@tanstack/react-query';
import { clearSessionQueryCache } from './query-client';

export async function clearMovaSessionState(queryClient: QueryClient): Promise<void> {
  clearSessionQueryCache(queryClient);
  if (!('caches' in globalThis)) return;
  const cacheNames = await globalThis.caches.keys();
  await Promise.all(cacheNames.filter((name) => name.startsWith('mova-app-')).map((name) => globalThis.caches.delete(name)));
}
