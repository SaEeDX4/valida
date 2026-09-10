import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Alert from './Alert.jsx';
import EmptyState from '../EmptyState/EmptyState.jsx';
import ErrorState from '../ErrorState/ErrorState.jsx';
import LoadingSkeleton from '../LoadingSkeleton/LoadingSkeleton.jsx';
import StatusMessage from '../StatusMessage/StatusMessage.jsx';
import { findAccessibilityViolations } from '../../../test/axe.js';

describe('Alert', () => {
  it('announces errors assertively and information politely', () => {
    const { rerender } = render(<Alert tone="error">Failed</Alert>);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    rerender(<Alert tone="info">Note</Alert>);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('does not rely on colour alone: each tone has a text label and an icon', () => {
    const { container } = render(<Alert tone="success" title="Done">Saved</Alert>);
    expect(screen.getByText('Success:')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it.each(['info', 'success', 'warning', 'error'])('has no axe violations (%s)', async (tone) => {
    const { container } = render(<Alert tone={tone} title="Title">Body text</Alert>);
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('LoadingSkeleton', () => {
  it('announces loading once, not once per bar', () => {
    render(<LoadingSkeleton lines={4} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
  });

  it('hides the decorative bars from assistive technology', () => {
    const { container } = render(<LoadingSkeleton lines={3} />);
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(3);
  });

  it('has no axe violations', async () => {
    const { container } = render(<LoadingSkeleton />);
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('EmptyState', () => {
  it('renders an intentional message and optional action', () => {
    render(<EmptyState title="No open roles" action={<button type="button">Notify me</button>}>Check back soon.</EmptyState>);
    expect(screen.getByText('No open roles')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(<EmptyState title="No open roles">Check back soon.</EmptyState>);
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('ErrorState', () => {
  it('shows safe approved copy and a retry action', () => {
    render(<ErrorState onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('omits the retry control when no handler is supplied', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(<ErrorState onRetry={() => {}} />);
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('StatusMessage', () => {
  it('renders a polite live region by default', () => {
    render(<StatusMessage>Saved</StatusMessage>);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });

  it('can be visually hidden while remaining announced', () => {
    render(<StatusMessage visible={false}>Submitting</StatusMessage>);
    expect(screen.getByRole('status').className).toContain('visually-hidden');
  });
});

describe('ErrorState canonical copy (Document 06)', () => {
  it('defaults to the GENERIC SYSTEM ERROR headline from Doc 06 section 188', () => {
    render(<ErrorState />);
    expect(screen.getByText('Something went wrong.')).toBeTruthy();
  });

  it('defaults to the GENERIC SYSTEM ERROR body from Doc 06 section 188', () => {
    render(<ErrorState />);
    expect(screen.getByText('We couldn\u2019t complete this request. Please try again.')).toBeTruthy();
  });

  it('defaults to the GENERIC RETRY LABEL from Doc 06 section 186', () => {
    render(<ErrorState onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('accepts contextual Document 06 copy from the calling surface', () => {
    // Doc 06 section 188: the generic message is used only when a more
    // specific one is not available. Doc 06 section 89 is the Careers case.
    render(
      <ErrorState
        title="Open roles are temporarily unavailable."
        message="We couldn\u2019t load the current list of positions. Please try again."
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('Open roles are temporarily unavailable.')).toBeTruthy();
  });
});
