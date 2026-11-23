import { describe, expect, it } from 'vitest';
import { renderWelcomeEmail } from './welcome.ts';

// WP7: EM11 talks about the 30-day trial only while the trial switch is on.
describe('welcome email plan line', () => {
  it('keeps the Free-plan line when the trial is off', () => {
    const email = renderWelcomeEmail('en-US', { firstName: 'Ari' });
    expect(email.text).toContain('You’re on the Free plan');
    expect(email.text).not.toContain('30-day AI + Growth trial');
  });
  it('talks about the trial when it is on, in both languages', () => {
    expect(renderWelcomeEmail('en-US', { firstName: 'Ari', trial: true }).html).toContain('Your 30-day AI + Growth trial starts when you open Mova.');
    expect(renderWelcomeEmail('es-US', { firstName: 'Ari', trial: true }).text).toContain('Tu prueba de 30 días de AI + Growth');
  });
});
