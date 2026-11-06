import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Locale } from '@mova/contracts';
import i18n from '../i18n';
import { readStoredLocale, storeLocale } from './locale';

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ storageKey, children }: PropsWithChildren<{ storageKey: string }>) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale(storageKey));

  useEffect(() => {
    const stored = readStoredLocale(storageKey);
    setLocaleState(stored);
    void i18n.changeLanguage(stored);
    document.documentElement.lang = stored;
  }, [storageKey]);

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
