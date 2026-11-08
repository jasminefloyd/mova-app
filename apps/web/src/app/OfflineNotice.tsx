import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** App-wide offline state (task 2.6): every screen gets the same notice when the browser loses its connection. */
export function OfflineNotice() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <aside role="status" aria-live="polite" className="mova-offline-notice">
      {t('components.offline')}
    </aside>
  );
}
