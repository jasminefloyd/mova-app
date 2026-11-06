import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, Checkbox, OptionGroup, PhotoCrop, RadioCard, StatusChip, TextField, Toggle, UnreadDot } from '../../apps/web/src/components';

describe('design-system primitives', () => {
  it('keeps action variants and loading state semantic', () => {
    const markup = renderToStaticMarkup(<><Button variant="primary">Continue</Button><Button variant="secondary">Cancel</Button><Button loading>Save</Button></>);
    expect(markup).toContain('mova-button--primary');
    expect(markup).toContain('mova-button--secondary');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
  });

  it('uses labelled native checkbox controls for toggles and checkboxes', () => {
    const markup = renderToStaticMarkup(<><Toggle label="Availability" checked /><Checkbox label="Consent" /></>);
    expect(markup).toContain('type="checkbox" role="switch"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Availability');
    expect(markup).toContain('Consent');
  });

  it('connects field labels and validation messages', () => {
    const markup = renderToStaticMarkup(<TextField label="Email" error="Enter an email" />);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('id="');
    expect(markup).toContain('Enter an email');
  });

  it('pairs each status with icon markup and visible text', () => {
    const markup = renderToStaticMarkup(<StatusChip status="pending">Pending</StatusChip>);
    expect(markup).toContain('mova-status--pending');
    expect(markup).toContain('Pending');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('groups native radio controls with an accessible name', () => {
    const markup = renderToStaticMarkup(<OptionGroup label="Choose one"><RadioCard name="choice" value="one" label="One" /></OptionGroup>);
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Choose one"');
    expect(markup).toContain('type="radio"');
  });

  it('renders the unread dot with a text alternative and photo crop guidance slots', () => {
    const markup = renderToStaticMarkup(<><UnreadDot label="Unread message" /><PhotoCrop tips={['Face centered']}><Button>Choose photo</Button></PhotoCrop><PhotoCrop preview /></>);
    expect(markup).toContain('aria-label="Unread message"');
    expect(markup).toContain('Face centered');
    expect(markup).toContain('Choose photo');
    expect(markup).toContain('Small-size photo preview');
  });
});
