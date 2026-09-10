import styles from './TextLink.module.css';

/**
 * TextLink — the canonical navigation control (Doc 08 section 35).
 *
 * Renders a real anchor. `as` accepts a router Link component so that A3 can
 * pass React Router's Link without restyling anything.
 *
 * External links get rel="noopener noreferrer" automatically and an
 * accessible suffix, so the new-tab behaviour is announced rather than
 * silently applied.
 */
export default function TextLink({
  as: Element = 'a',
  variant = 'default',
  external = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    styles.link,
    variant === 'quiet' ? styles.quiet : '',
    external ? styles.external : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  return (
    <Element className={classes} {...externalProps} {...rest}>
      {children}
      {external ? <span className="visually-hidden"> (opens in a new tab)</span> : null}
    </Element>
  );
}
