import { useState } from 'react';
import { createClientQueryClient } from '../lib/query-client';
import { CLIENT_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';

export function ClientShell() {
  const [queryClient] = useState(createClientQueryClient);
  return <ShellFrame queryClient={queryClient} localeStorageKey={CLIENT_LOCALE_KEY} />;
}

export default ClientShell;
