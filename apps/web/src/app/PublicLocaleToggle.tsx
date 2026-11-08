import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { Locale } from '@mova/contracts';
import i18n from '../i18n';
import { GUEST_LOCALE_KEY, storeLocale } from './locale';
import { useOptionalLocale } from './LocaleProvider';

const locales: Array<{ value: Locale; label: string }> = [
  { value: 'en-US', label: 'EN' },
  { value: 'es-US', label: 'ES' },
];

export function PublicLocaleToggle() {
  const { t } = useTranslation();
  const localeContext = useOptionalLocale();
  const locale = localeContext?.locale ?? (i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US');
  const [params, setParams] = useSearchParams();

  const choose = (next: Locale) => {
    if (localeContext) localeContext.setLocale(next);
    else { storeLocale(GUEST_LOCALE_KEY, next); void i18n.changeLanguage(next); }
    const updated = new URLSearchParams(params);
    updated.set('locale', next);
    setParams(updated, { replace: true });
  };

  return <div className="mova-public-locale-toggle" role="group" aria-label={t('language')}>
    {locales.map(({ value, label }) => <button key={value} type="button" aria-pressed={locale === value} onClick={() => choose(value)}>{label}</button>)}
  </div>;
}
