import { useEffect, useState } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router';
import type { Locale } from '@mova/contracts';
import { createPublicQueryClient } from '../lib/query-client';
import { GUEST_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';
import { useLocale } from './LocaleProvider';

export function PublicShell() {
  const [queryClient] = useState(createPublicQueryClient);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const locale: Locale = params.get('locale') === 'es-US' ? 'es-US' : 'en-US';
  return <ShellFrame queryClient={queryClient} localeStorageKey={GUEST_LOCALE_KEY} showBrandHeader={pathname !== '/'}>
    <PublicLocaleSync locale={locale} />
    <Outlet />
  </ShellFrame>;
}

export default PublicShell;

function PublicLocaleSync({ locale }: { locale: Locale }) {
  const { setLocale } = useLocale();
  useEffect(() => { setLocale(locale); document.documentElement.lang = locale; }, [locale, setLocale]);
  return null;
}
