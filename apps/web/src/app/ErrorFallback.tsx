import { useTranslation } from 'react-i18next';

export function ErrorFallback({ requestId }: { requestId?: string | null } = {}) {
  const { t } = useTranslation();
  return (
    <section role="alert" className="p-5">
      <h1>{t('error.title')}</h1>
      <p>{t('error.message')}</p>
      {requestId ? <p>Reference: <code>{requestId}</code></p> : null}
      <button type="button" onClick={() => window.location.reload()}>{t('error.reload')}</button>
    </section>
  );
}
