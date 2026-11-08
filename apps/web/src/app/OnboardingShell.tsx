import { useState } from 'react';
import { createArtistQueryClient } from '../lib/query-client';
import { ONBOARDING_LOCALE_KEY } from './locale';
import { ShellFrame } from './ShellFrame';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';

export function OnboardingShell() {
  const [queryClient] = useState(createArtistQueryClient);
  return <ShellFrame queryClient={queryClient} localeStorageKey={ONBOARDING_LOCALE_KEY} showLocaleSwitcher>
    <OnboardingFlow />
  </ShellFrame>;
}

export default OnboardingShell;
