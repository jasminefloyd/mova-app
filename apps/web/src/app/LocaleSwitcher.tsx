import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import type { Locale } from '@mova/contracts';
import { LocaleSchema } from '@mova/contracts';
import { useLocale } from './LocaleProvider';

export function LocaleSwitcher({ onChange }: { onChange?: (locale: Locale) => void } = {}) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextLocale = LocaleSchema.parse(event.currentTarget.value);
    setLocale(nextLocale);
    onChange?.(nextLocale);
  }

  return (
    <label>
      <span>{t('language')}</span>
      <select aria-label={t('language')} value={locale} onChange={handleChange}>
        <option value="en-US">English (US)</option>
        <option value="es-US">Español (EE. UU.)</option>
      </select>
    </label>
  );
}
