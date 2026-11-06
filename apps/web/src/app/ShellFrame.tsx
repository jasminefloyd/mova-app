import type { PropsWithChildren } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { LocaleProvider } from './LocaleProvider';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ServiceWorkerUpdateNotice } from './ServiceWorkerUpdateNotice';

type ShellFrameProps = PropsWithChildren<{
  queryClient: QueryClient;
  localeStorageKey: string;
  showBrandHeader?: boolean;
  showLocaleSwitcher?: boolean;
}>;

export function ShellFrame({ queryClient, localeStorageKey, showBrandHeader = true, showLocaleSwitcher = false, children }: ShellFrameProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider storageKey={localeStorageKey}>
        {showBrandHeader && <header className="flex items-center justify-between p-4">
          <span className="font-display font-bold" aria-label="mova">mova.</span>
          {showLocaleSwitcher && <LocaleSwitcher />}
        </header>}
        <main>
          {children ?? <Outlet />}
        </main>
        <ServiceWorkerUpdateNotice />
      </LocaleProvider>
    </QueryClientProvider>
  );
}
