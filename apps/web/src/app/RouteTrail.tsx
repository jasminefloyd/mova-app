import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

export const PREVIOUS_PATH_KEY = 'mova_previous_path';

/** Remembers the previous screen's path (no query string) so feedback can say where the stylist came from. */
export function RouteTrail() {
  const { pathname } = useLocation();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current && last.current !== pathname) {
      try { window.sessionStorage.setItem(PREVIOUS_PATH_KEY, last.current); } catch { /* storage can be unavailable */ }
    }
    last.current = pathname;
  }, [pathname]);
  return null;
}

export function previousPath() {
  try { return window.sessionStorage.getItem(PREVIOUS_PATH_KEY); } catch { return null; }
}
