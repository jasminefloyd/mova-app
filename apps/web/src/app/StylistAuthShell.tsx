import { useState } from 'react';
import { createArtistQueryClient } from '../lib/query-client';
import { ONBOARDING_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';

/** Layout for the stylist sign-in (/login) and sign-up (/signup) pages. Each page draws its own header. */
export function StylistAuthShell() {
  const [queryClient] = useState(createArtistQueryClient);
  return <ShellFrame queryClient={queryClient} localeStorageKey={ONBOARDING_LOCALE_KEY} showBrandHeader={false} />;
}

export default StylistAuthShell;
