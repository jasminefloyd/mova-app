import { useTranslation } from 'react-i18next';

export function ErrorFallback() {
  const { t } = useTranslation();
  return (
    <section role="alert" className="p-5">
      <h1>{t('error.title')}</h1>
      <p>{t('error.message')}</p>
      <button type="button" onClick={() => window.location.reload()}>{t('error.reload')}</button>
    </section>
  );
}
