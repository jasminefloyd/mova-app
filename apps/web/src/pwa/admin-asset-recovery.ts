export const ADMIN_RELOAD_PARAM = '__mova_reload';

// Install before module preloads. React cannot handle errors when its entry module fails to load.
export const adminAssetRecoveryScript = `
(() => {
  let reloading = false;
  const retryKey = 'mova_admin_asset_retry';
  const retryParam = '${ADMIN_RELOAD_PARAM}';

  function retry() {
    if (reloading || navigator.onLine === false) return;
    const url = new URL(location.href);
    if (url.searchParams.has(retryParam)) return;
    const now = Date.now();
    try {
      if (now - Number(sessionStorage.getItem(retryKey)) < 60000) return;
      sessionStorage.setItem(retryKey, String(now));
    } catch {}
    reloading = true;
    url.searchParams.set(retryParam, String(now));
    location.replace(url.href);
  }

  addEventListener('error', event => {
    const target = event.target;
    const asset = target instanceof HTMLScriptElement ? target.src
      : target instanceof HTMLLinkElement && target.rel === 'modulepreload' ? target.href : '';
    if (!asset) return;
    const url = new URL(asset, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) retry();
  }, true);
  addEventListener('vite:preloadError', retry);
  addEventListener('unhandledrejection', event => {
    if (/dynamically imported module|importing a module script failed|loading chunk/i.test(event.reason?.message ?? '')) retry();
  });
})();
`;
