import { useState } from 'react';
import { useLocation } from 'react-router';
import { createClientQueryClient } from '../lib/query-client';
import { CLIENT_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';

export function ClientShell() {
  const [queryClient] = useState(createClientQueryClient);
  const { pathname } = useLocation();
  // The client profile draws its own wordmark; sign-in relies on the shell's (task 2.3).
  return <ShellFrame queryClient={queryClient} localeStorageKey={CLIENT_LOCALE_KEY} showBrandHeader={pathname !== '/me'} />;
}

export default ClientShell;
