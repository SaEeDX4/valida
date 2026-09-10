import styles from './Container.module.css';

const WIDTHS = {
  shell: styles.shell,
  wide: styles.wide,
  standard: styles.standard,
  narrow: styles.narrow,
  reading: styles.reading,
};

/**
 * Horizontal layout container.
 *
 * Implements the canonical max widths and responsive gutters from
 * 03_BRAND_VISUAL_SYSTEM.md sections 33-34, exposed as the variants required
 * by 08_FRONTEND_SPEC.md section 36.
 *
 * Every page section should sit inside a Container rather than inventing its
 * own max-width, so horizontal alignment stays consistent site-wide.
 */
export default function Container({
  as: Element = 'div',
  width = 'standard',
  className = '',
  children,
  ...rest
}) {
  const widthClass = WIDTHS[width] ?? WIDTHS.standard;
  return (
    <Element className={`${styles.container} ${widthClass} ${className}`.trim()} {...rest}>
      {children}
    </Element>
  );
}
