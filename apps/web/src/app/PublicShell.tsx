import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { createPublicQueryClient } from '../lib/query-client';
import { GUEST_LOCALE_KEY } from './locale';
import { readStoredLocale } from './locale';
import { ShellFrame } from './ShellFrame';
import { useLocale } from './LocaleProvider';

export function PublicShell() {
  const [queryClient] = useState(createPublicQueryClient);
  // Every public page (showcase, booking, scan, client card, manage booking, review) draws its own wordmark,
  // so the shell header would show a second one (task 2.3).
  return <ShellFrame queryClient={queryClient} localeStorageKey={GUEST_LOCALE_KEY} showBrandHeader={false}>
    <PublicLocaleSync />
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
