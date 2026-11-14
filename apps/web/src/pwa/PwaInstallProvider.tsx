import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type PwaInstallContextValue = {
  ready: boolean;
  installed: boolean;
  canPrompt: boolean;
  promptInstall: () => Promise<boolean>;
};

const PwaInstallContext = createContext<PwaInstallContextValue>({ ready: false, installed: false, canPrompt: false, promptInstall: async () => false });

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaInstallProvider({ children }: PropsWithChildren) {
  const deferredPrompt = useRef<InstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    const updateInstalled = () => setInstalled(isInstalled());
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as InstallPromptEvent;
      setCanPrompt(true);
    };
    const handleInstalled = () => {
      deferredPrompt.current = null;
      setCanPrompt(false);
      setInstalled(true);
    };
    updateInstalled();
    setReady(true);
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return false;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    deferredPrompt.current = null;
    setCanPrompt(false);
    if (choice.outcome === 'accepted') setInstalled(true);
    return choice.outcome === 'accepted';
  }, []);

  return <PwaInstallContext.Provider value={{ ready, installed, canPrompt, promptInstall }}>{children}</PwaInstallContext.Provider>;
}

export function usePwaInstall() {
  return useContext(PwaInstallContext);
}
