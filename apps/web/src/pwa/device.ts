/** Device checks for the install banner and push. Phones only: tablets and desktops never see the install banner. */
type NavigatorWithStandalone = Navigator & { standalone?: boolean; userAgentData?: { mobile?: boolean } };

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as NavigatorWithStandalone).standalone === true;
  } catch { return false; }
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod|iPad/i.test(navigator.userAgent);
}

/** A phone (iPhone, iPod, Android phone), checked by the browser's own mobile hint and the user agent. */
export function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorWithStandalone;
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return false;
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) || nav.userAgentData?.mobile === true;
  return nav.userAgentData?.mobile === true;
}

/** iPhone in Safari (not the installed app): push needs Mova on the Home Screen first. */
export function isIOSBrowser(): boolean {
  return isIOS() && !isStandalone();
}
