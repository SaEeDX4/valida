import styles from './Section.module.css';

const SPACING = { sm: styles.sm, md: styles.md, lg: styles.lg };
const SURFACES = {
  primary: styles.bgPrimary,
  secondary: styles.bgSecondary,
  tertiary: styles.bgTertiary,
  none: '',
};

/**
 * Page section wrapper.
 *
 * Owns vertical rhythm and zone background so pages compose sections rather
 * than repeating spacing values (03_BRAND_VISUAL_SYSTEM.md section 32).
 * Sections vary their rhythm deliberately; the same value is not forced on
 * every section.
 */
export default function Section({
  as: Element = 'section',
  spacing = 'md',
  surface = 'none',
  className = '',
  children,
  ...rest
}) {
  const classes = [
    styles.section,
    SPACING[spacing] ?? SPACING.md,
    SURFACES[surface] ?? '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Element className={classes} {...rest}>
      {children}
    </Element>
  );
}

/**
 * Small uppercase category cue that precedes a section heading.
 * Rendered as plain text, not a heading, so it never pollutes the document
 * outline.
 */
export function SectionEyebrow({ children, className = '', ...rest }) {
  return (
    <p className={`t-eyebrow ${styles.eyebrow} ${className}`.trim()} {...rest}>
      {children}
    </p>
  );
}

/** Groups an eyebrow, heading and supporting copy with consistent spacing. */
export function SectionHeader({ className = '', children, ...rest }) {
  return (
    <div className={`${styles.header} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
