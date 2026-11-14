import { useState } from 'react';
import { createArtistQueryClient } from '../lib/query-client';
import { ONBOARDING_LOCALE_KEY } from './locale';
import { useLocation } from 'react-router';
import type { Locale } from '@mova/contracts';
import { ShellFrame } from './ShellFrame';

/** Layout for the stylist sign-in (/login) and sign-up (/signup) pages. Each page draws its own header. */
export function StylistAuthShell() {
  const [queryClient] = useState(createArtistQueryClient);
  const { pathname } = useLocation();
  const fixedLocale: Locale | undefined = pathname === '/signup' ? 'en-US' : undefined;
  return <ShellFrame queryClient={queryClient} localeStorageKey={ONBOARDING_LOCALE_KEY} showBrandHeader={false} fixedLocale={fixedLocale} />;
}

export default StylistAuthShell;
