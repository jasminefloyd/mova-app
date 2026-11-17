import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from './useOnlineStatus';

/** Dark bar shown on saved screens while offline (P4–P7). Changes are paused until the connection is back. */
export function OfflineBanner({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { online, savedAt } = useOnlineStatus();
  // This bar replaces the app-wide offline notice on screens that show it.
  useEffect(() => {
    if (online) return;
    document.documentElement.dataset.movaOfflineBar = 'true';
    return () => { delete document.documentElement.dataset.movaOfflineBar; };
  }, [online]);
  if (online) return null;
  const time = savedAt ? new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(savedAt)) : null;
  return <div role="status" className={`mova-offline-banner ${className}`.trim()}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-2.6-1.8" /><path d="M2 9a15 15 0 0 1 4.3-2.6M22 9a15 15 0 0 0-10.4-4" /><circle cx="12" cy="20" r=".8" fill="currentColor" />
    </svg>
    <span><strong>{t('offline.title')}</strong> {time ? t('offline.savedAt', { time }) : t('offline.saved')}</span>
  </div>;
}

/** Pauses every button and field inside while offline (saved screens are read-only). Links keep working. */
export function OfflineFieldset({ children }: { children: ReactNode }) {
  const { online } = useOnlineStatus();
  return <fieldset className="mova-offline-fieldset" disabled={!online}>{children}</fieldset>;
}
