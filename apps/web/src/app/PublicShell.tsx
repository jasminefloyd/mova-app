import { useEffect, useState } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router';
import { createPublicQueryClient } from '../lib/query-client';
import { GUEST_LOCALE_KEY, isEnglishOnlyPublicShell, readStoredLocale } from './locale';
import { ShellFrame } from './ShellFrame';
import { useLocale } from './LocaleProvider';

export function PublicShell() {
  const [queryClient] = useState(createPublicQueryClient);
  const englishOnly = useMatches().some(match => isEnglishOnlyPublicShell(match.id));
  // Every public page (showcase, booking, scan, client card, manage booking, review) draws its own wordmark,
  // so the shell header would show a second one (task 2.3).
  return <ShellFrame queryClient={queryClient} localeStorageKey={GUEST_LOCALE_KEY} showBrandHeader={false} {...(englishOnly ? { fixedLocale: 'en-US' as const } : {})}>
    {!englishOnly && <PublicLocaleSync />}
    <Outlet />
  </ShellFrame>;
}

export default PublicShell;

function PublicLocaleSync() {
  const { pathname, search } = useLocation();
  const { setLocale } = useLocale();
  useEffect(() => {
    const requested = new URLSearchParams(search).get('locale');
    const locale = requested === 'es-US' || requested === 'en-US' ? requested : readStoredLocale(GUEST_LOCALE_KEY);
    setLocale(locale);
    document.documentElement.lang = locale;
  }, [pathname, search, setLocale]);
  return null;
}
