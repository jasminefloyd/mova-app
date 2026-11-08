import { useEffect, useRef } from 'react';

// O1: hCaptcha widget for public forms. Renders nothing until a site key is configured, and loads
// hCaptcha's script only when it is about to be shown. The token goes to our Edge Function, which
// checks it with hCaptcha.
type HCaptchaApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global { interface Window { hcaptcha?: HCaptchaApi } }

let loading: Promise<HCaptchaApi> | null = null;
function loadScript(locale: string): Promise<HCaptchaApi> {
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://js.hcaptcha.com/1/api.js?render=explicit&hl=${locale.startsWith('es') ? 'es' : 'en'}`;
    script.async = true;
    script.onload = () => (window.hcaptcha ? resolve(window.hcaptcha) : reject(new Error('HCAPTCHA_MISSING')));
    script.onerror = () => { loading = null; reject(new Error('HCAPTCHA_LOAD_FAILED')); };
    document.head.appendChild(script);
  });
  return loading;
}

export function HCaptcha({ siteKey, locale, onToken, resetKey = 0, onLoadError }: {
  siteKey: string | null; locale: string; onToken: (token: string | null) => void; resetKey?: number; onLoadError?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCallback = useRef(onToken);
  tokenCallback.current = onToken;

  useEffect(() => {
    if (!siteKey || !host.current) return;
    let cancelled = false;
    loadScript(locale).then((api) => {
      if (cancelled || !host.current) return;
      widget.current = api.render(host.current, {
        sitekey: siteKey,
        callback: (token: string) => tokenCallback.current(token),
        'expired-callback': () => tokenCallback.current(null),
        'error-callback': () => tokenCallback.current(null),
      });
    }).catch(() => onLoadError?.());
    return () => { cancelled = true; if (widget.current && window.hcaptcha) window.hcaptcha.remove(widget.current); widget.current = null; };
  }, [siteKey, locale, onLoadError]);

  useEffect(() => {
    if (resetKey && widget.current && window.hcaptcha) { window.hcaptcha.reset(widget.current); tokenCallback.current(null); }
  }, [resetKey]);

  if (!siteKey) return null;
  return <div className="mova-hcaptcha" ref={host} data-testid="hcaptcha" />;
}
