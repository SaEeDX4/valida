import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Field from './Field.jsx';
import TextInput from '../TextInput/TextInput.jsx';
import TextArea from '../TextArea/TextArea.jsx';
import { findAccessibilityViolations } from '../../../test/axe.js';

describe('Field', () => {
  it('binds the label to the control by id (Doc 08 s92-93)', () => {
    render(<Field label="Email address">{(p) => <TextInput {...p} type="email" />}</Field>);
    const input = screen.getByLabelText(/Email address/);
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toBeTruthy();
  });

  it('generates unique ids for repeated fields', () => {
    render(
      <>
        <Field label="First">{(p) => <TextInput {...p} />}</Field>
        <Field label="Second">{(p) => <TextInput {...p} />}</Field>
      </>,
    );
    expect(screen.getByLabelText('First').id).not.toBe(screen.getByLabelText('Second').id);
  });

  it('associates the description via aria-describedby', () => {
    render(
      <Field label="Email" description="We use this to reply.">
        {(p) => <TextInput {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy).textContent).toBe('We use this to reply.');
  });

  it('marks an invalid control and announces the error', () => {
    render(
      <Field label="Email" error="Enter a valid email address.">
        {(p) => <TextInput {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Enter a valid email address.');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('communicates the error with an icon as well as colour (Doc 03 s62)', () => {
    const { container } = render(
      <Field label="Email" error="Required.">{(p) => <TextInput {...p} />}</Field>,
    );
    expect(container.querySelector('[role="alert"] svg')).toBeTruthy();
  });

  it('exposes required state to assistive technology, not only with an asterisk', () => {
    render(<Field label="Full name" required>{(p) => <TextInput {...p} />}</Field>);
    const input = screen.getByLabelText(/Full name/);
    expect(input.required).toBe(true);
    expect(screen.getByText('(required)')).toBeTruthy();
  });

  it('accepts typed input', async () => {
    render(<Field label="Full name">{(p) => <TextInput {...p} />}</Field>);
    const input = screen.getByLabelText('Full name');
    await userEvent.type(input, 'Jane Doe');
    expect(input.value).toBe('Jane Doe');
  });

  it('works with TextArea using the same wiring', () => {
    render(<Field label="Message">{(p) => <TextArea {...p} />}</Field>);
    expect(screen.getByLabelText('Message').tagName).toBe('TEXTAREA');
  });

  it('has no axe violations in default and error states', async () => {
    const { container, rerender } = render(
      <Field label="Email" description="Work address preferred." required>
        {(p) => <TextInput {...p} type="email" />}
      </Field>,
    );
    expect(await findAccessibilityViolations(container)).toEqual([]);

    rerender(
      <Field label="Email" description="Work address preferred." required error="Invalid.">
        {(p) => <TextInput {...p} type="email" />}
      </Field>,
    );
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
