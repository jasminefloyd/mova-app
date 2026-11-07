import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../app/LocaleProvider';
import { i18nReady } from '../../i18n';
import { OnboardingFlow } from './OnboardingFlow';

function renderOnboarding(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <LocaleProvider storageKey="mova-test-locale">
        <OnboardingFlow />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('onboarding', () => {
  beforeAll(async () => { await i18nReady; });
  it('renders the account step with email verification language and a password rule', () => {
    const markup = renderOnboarding('/onboarding/account');
    expect(markup).toContain('Create your account');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('Use at least 9 characters.');
    expect(markup).toContain('Check your email for a verification link.');
  });

  it('renders artist-controlled profile fields without hardcoded canvas example data', () => {
    const markup = renderOnboarding('/onboarding/profile');
    expect(markup).toContain('Your artist profile');
    expect(markup).toContain('Your link');
    expect(markup).toContain('pick up to 5');
    expect(markup).not.toContain('Ari Monroe');
  });

  it('renders photo capture and skip actions', () => {
    const markup = renderOnboarding('/onboarding/photo');
    expect(markup).toContain('Take photo');
    expect(markup).toContain('Choose photo');
    expect(markup).toContain('Later');
  });
});
