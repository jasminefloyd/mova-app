import { useEffect, useState } from 'react';
import { lastSynced, markSynced } from './offline-data';

/** Online/offline, plus when the app last had a connection. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [savedAt, setSavedAt] = useState<number | null>(() => (typeof window === 'undefined' ? null : lastSynced()));
  useEffect(() => {
    const update = () => {
      const now = navigator.onLine !== false;
      setOnline(now);
      if (now) { markSynced(); setSavedAt(Date.now()); } else setSavedAt(lastSynced());
    };
    update();
    const timer = window.setInterval(() => { if (navigator.onLine !== false) markSynced(); }, 60_000);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.clearInterval(timer); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return { online, savedAt };
}
