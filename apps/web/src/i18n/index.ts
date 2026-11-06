import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enUS from './resources/en-US/common.json';
import esUS from './resources/es-US/common.json';

export const i18nReady = i18n.use(initReactI18next).init({
  lng: 'en-US',
  resources: {
    'en-US': { common: enUS },
    'es-US': { common: esUS },
  },
  defaultNS: 'common',
  ns: ['common'],
  fallbackLng: false,
  supportedLngs: ['en-US', 'es-US'],
  load: 'currentOnly',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  saveMissing: false,
});

export default i18n;

export function criticalTranslation(key: string, locale: 'en-US' | 'es-US'): string {
  if (!i18n.exists(key, { lng: locale, ns: 'common' })) {
    throw new Error(`Missing critical translation: ${locale}:${key}`);
  }
  return i18n.getFixedT(locale, 'common')(key);
}
