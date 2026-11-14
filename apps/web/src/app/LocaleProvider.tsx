import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Locale } from '@mova/contracts';
import i18n from '../i18n';
import { readStoredLocale, storeLocale } from './locale';

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ storageKey, fixedLocale, children }: PropsWithChildren<{ storageKey: string; fixedLocale?: Locale }>) {
  // Keep the server and first browser render identical. The saved locale is
  // applied in the effect below after hydration completes.
  const [locale, setLocaleState] = useState<Locale>(() => fixedLocale ?? 'en-US');

  useEffect(() => {
    const stored = fixedLocale ?? readStoredLocale(storageKey);
    setLocaleState(stored);
    void i18n.changeLanguage(stored);
    document.documentElement.lang = stored;
  }, [storageKey, fixedLocale]);

  const setLocale = useCallback((next: Locale) => {
    storeLocale(storageKey, next);
    setLocaleState(next);
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
  }, [storageKey]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

export function useOptionalLocale(): LocaleContextValue | null {
  return useContext(LocaleContext);
}
