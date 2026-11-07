import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../lib/logger';

export function ServiceWorkerUpdateNotice() {
  const { t } = useTranslation();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [updateServiceWorker, setUpdateServiceWorker] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    let mounted = true;
    void import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (!mounted) return;
        const update = registerSW({ immediate: true, onNeedRefresh: () => setNeedsRefresh(true) });
        setUpdateServiceWorker(() => update);
      })
      .catch(() => logger.error('pwa.register'));

    return () => {
      mounted = false;
    };
  }, []);

  if (!needsRefresh) return null;

  return (
    <aside role="status" className="fixed inset-x-4 bottom-4 rounded-xl bg-brand-forest p-4 text-brand-ivory">
      <span>{t('update.ready')}</span>
      <button type="button" className="ml-3 min-h-11 underline" onClick={() => void updateServiceWorker?.(true)}>
        {t('update.apply')}
      </button>
    </aside>
  );
}
