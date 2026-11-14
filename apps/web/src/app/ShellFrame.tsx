import type { PropsWithChildren } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { Outlet } from 'react-router';
import { LocaleProvider } from './LocaleProvider';
import { LocaleSwitcher } from './LocaleSwitcher';
import { OfflineNotice } from './OfflineNotice';
import { RouteTrail } from './RouteTrail';
import { ServiceWorkerUpdateNotice } from './ServiceWorkerUpdateNotice';
import type { Locale } from '@mova/contracts';

type ShellFrameProps = PropsWithChildren<{
  queryClient: QueryClient;
  localeStorageKey: string;
  showBrandHeader?: boolean;
  showLocaleSwitcher?: boolean;
  fixedLocale?: Locale;
}>;

export function ShellFrame({ queryClient, localeStorageKey, showBrandHeader = true, showLocaleSwitcher = false, fixedLocale, children }: ShellFrameProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider storageKey={localeStorageKey} fixedLocale={fixedLocale}>
        {showBrandHeader && <header className="flex items-center justify-between p-4">
          <span className="font-display font-bold" aria-label="mova">mova</span>
          {showLocaleSwitcher && <LocaleSwitcher />}
        </header>}
        <main>
          {children ?? <Outlet />}
        </main>
        <OfflineNotice />
        <RouteTrail />
        <ServiceWorkerUpdateNotice />
      </LocaleProvider>
    </QueryClientProvider>
  );
}
