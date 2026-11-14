import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../app/LocaleProvider';
import { i18nReady } from '../../i18n';
import StylistSignInPage from './StylistSignInPage';
import StylistSignUpPage from './StylistSignUpPage';
import AuthRedirect from './AuthRedirect';

function render(path: string, node: ReactElement) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <LocaleProvider storageKey="mova-test-auth-locale">{node}</LocaleProvider>
    </MemoryRouter>,
  );
}

describe('stylist sign-in (/login, W9)', () => {
  beforeAll(async () => { await i18nReady; });

  it('renders the existing-stylist form with email and password and no sign-up fields', () => {
    const markup = render('/login', <StylistSignInPage />);
    expect(markup).toContain('Welcome back');
    expect(markup).toContain('aria-label="Sign in"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toContain('Use at least 9 characters.');
    expect(markup).not.toContain('name="stylist-signup-language"');
  });

  it('links to sign-up and to the client sign-in, and keeps the legal links as plain text', () => {
    const markup = render('/login', <StylistSignInPage />);
    expect(markup).toContain('href="/signup"');
    expect(markup).toContain('href="/signin"');
    expect(markup).not.toContain('href="#terms"');
    expect(markup).toContain('Terms');
    expect(markup).toContain('Privacy');
    expect(markup).toContain('Help');
  });
});

describe('stylist sign-up (/signup, W8)', () => {
  beforeAll(async () => { await i18nReady; });

  it('renders the account form in English without an app language selector', () => {
    const markup = render('/signup', <StylistSignUpPage />);
    expect(markup).toContain('Create your account');
    expect(markup).toContain('Use at least 9 characters.');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).not.toContain('name="stylist-signup-language"');
    expect(markup).not.toContain('Español (US)');
  });

  it('sends "See plans" to /pricing and sign-in back to /login', () => {
    const markup = render('/signup', <StylistSignUpPage />);
    expect(markup).toContain('href="/pricing"');
    expect(markup).toContain('href="/login"');
    expect(markup).not.toContain('Join the waitlist');
    expect(markup).not.toContain('invite');
  });
});

describe('/auth redirect', () => {
  it('is a redirect component: it only renders when the router sends it on', () => {
    // Navigate renders nothing on the server; the redirect itself is covered by the E2E redirect spec.
    const markup = render('/auth?returnTo=%2FBID-1', <AuthRedirect />);
    expect(markup).toBe('');
  });
});
