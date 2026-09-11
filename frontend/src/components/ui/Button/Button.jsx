import styles from './Button.module.css';

const VARIANTS = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  destructive: styles.destructive,
  text: styles.text,
  icon: styles.icon,
};

const SIZES = {
  compact: styles.compact,
  standard: styles.standard,
  large: styles.large,
};

/**
 * Button — the canonical action control.
 *
 * Doc 08 section 34: native button semantics, anchor behaviour when the
 * control navigates, disabled, loading, focus-visible, accessible name,
 * icon + text. A <div> is never rendered as a button.
 *
 * Doc 08 section 35: use Button for actions and TextLink for navigation. The
 * `href` escape hatch exists for the button-styled call to action that really
 * does navigate (a hero CTA), and it renders a real <a>.
 *
 * Loading uses aria-disabled rather than the disabled attribute so the control
 * keeps its accessible name and stays reachable by screen readers while it is
 * busy; clicks are suppressed in the handler.
 */
export default function Button({
  variant = 'primary',
  size = 'standard',
  type = 'button',
  loading = false,
  disabled = false,
  href,
  as: LinkComponent,
  iconOnly = false,
  'aria-label': ariaLabel,
  className = '',
  children,
  onClick,
  ...rest
}) {
  const classes = [
    styles.button,
    't-button',
    VARIANTS[variant] ?? VARIANTS.primary,
    SIZES[size] ?? SIZES.standard,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const spinner = loading ? <span className={styles.spinner} aria-hidden="true" /> : null;
  const busy = loading || undefined;

  if (href) {
    // A navigating control is an anchor. When it is unavailable it must not
    // remain a working link, so the href is dropped and the role is kept.
    const unavailable = disabled || loading;

    /*
     * A3 integration: `as` accepts a router Link component so an in-app
     * button-styled CTA performs client-side navigation instead of a full page
     * reload. This mirrors the `as` prop TextLink already exposes.
     *
     * A router Link takes `to`, not `href`, and must never render while
     * unavailable — a disabled Link would still navigate on click. So an
     * unavailable control always falls back to the plain anchor branch below,
     * which drops the href entirely.
     */
    if (LinkComponent && !unavailable) {
      return (
        <LinkComponent
          className={classes}
          to={href}
          aria-busy={busy}
          aria-label={ariaLabel}
          onClick={onClick}
          {...rest}
        >
          {spinner}
          {children}
        </LinkComponent>
      );
    }

    return (
      <a
        className={classes}
        href={unavailable ? undefined : href}
        role={unavailable ? 'link' : undefined}
        aria-disabled={unavailable || undefined}
        aria-busy={busy}
        aria-label={ariaLabel}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        {...rest}
      >
        {spinner}
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={busy}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {spinner}
      {children}
    </button>
  );
}
