import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function ServiceWorkerUpdateNotice() {
  const { t } = useTranslation();
  const { needRefresh: [needsRefresh], updateServiceWorker } = useRegisterSW({ immediate: true });
  if (!needsRefresh) return null;

  return (
    <aside role="status" className="fixed inset-x-4 bottom-4 rounded-xl bg-brand-forest p-4 text-brand-ivory">
      <span>{t('update.ready')}</span>
      <button type="button" className="ml-3 min-h-11 underline" onClick={() => void updateServiceWorker(true)}>
        {t('update.apply')}
      </button>
    </aside>
  );
}
