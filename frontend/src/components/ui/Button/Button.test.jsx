import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button.jsx';
import { findAccessibilityViolations } from '../../../test/axe.js';

describe('Button', () => {
  it('renders a native button element, never a div (Doc 08 s34)', () => {
    render(<Button>Submit</Button>);
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button.tagName).toBe('BUTTON');
  });

  it('defaults to type="button" so it cannot accidentally submit a form', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('type', 'button');
  });

  it('renders an anchor when it navigates (Doc 08 s35)', () => {
    render(<Button href="/careers">Careers</Button>);
    const link = screen.getByRole('link', { name: 'Careers' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/careers');
  });

  it('calls onClick when activated', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('suppresses onClick while loading and marks itself busy', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Saving</Button>);
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps its accessible name while loading', () => {
    render(<Button loading>Submit application</Button>);
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeTruthy();
  });

  it('removes href from a disabled navigating control so it is not followable', () => {
    render(<Button href="/careers" disabled>Careers</Button>);
    const link = screen.getByRole('link', { name: 'Careers' });
    expect(link.getAttribute('href')).toBeNull();
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });

  it('gives an icon-only button an accessible name', () => {
    render(
      <Button variant="icon" aria-label="Close menu">
        <span aria-hidden="true">x</span>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
  });

  it('is reachable and activatable by keyboard (Doc 18 s48)', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Keyboard</Button>);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keyboard' }));
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled button in the tab order', async () => {
    render(
      <>
        <Button disabled>First</Button>
        <Button>Second</Button>
      </>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  });

  it.each(['primary', 'secondary', 'ghost', 'destructive', 'text'])(
    'has no axe violations for the %s variant',
    async (variant) => {
      const { container } = render(<Button variant={variant}>Action</Button>);
      expect(await findAccessibilityViolations(container)).toEqual([]);
    },
  );
});
