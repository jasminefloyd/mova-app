import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../app/LocaleProvider';
import { i18nReady } from '../../i18n';
import { OnboardingFlow } from './OnboardingFlow';
import { WelcomeStep } from './WelcomeStep';

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
  it('no longer renders the account form; sign-up lives at /signup', () => {
    const markup = renderOnboarding('/onboarding/account');
    expect(markup).not.toContain('type="email"');
    expect(markup).not.toContain('Check your email for a verification link.');
    expect(markup).toContain('Your artist profile');
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

  it('orders the setup steps as where you work, what you offer, then how you get paid', () => {
    expect(renderOnboarding('/onboarding/location')).toContain('Where you work');
    expect(renderOnboarding('/onboarding/location')).toContain('Step 4 of 6');
    expect(renderOnboarding('/onboarding/services')).toContain('What you offer');
    expect(renderOnboarding('/onboarding/services')).toContain('Step 5 of 6');
  });

  it('sends the retired publish step to payments', () => {
    const markup = renderOnboarding('/onboarding/publish');
    expect(markup).toContain('How you get paid');
    expect(markup).toContain('Step 6 of 6');
  });

  it('starts the welcome screen on the animated set-up checklist', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><LocaleProvider storageKey="mova-test-locale">
      <WelcomeStep name="Ari" handle="ari" locationName="Studio" onSettings={() => undefined} onHome={() => undefined} />
    </LocaleProvider></MemoryRouter>);
    expect(markup).toContain('Setting up your account');
    expect(markup).toContain('Creating your account');
    expect(markup).toContain('Publishing your page');
    expect(markup).toContain('Turning on booking');
    expect(markup).not.toContain('Step ');
  });
});
