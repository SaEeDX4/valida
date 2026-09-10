/**
 * Project-owned icon set.
 *
 * Doc 08 section 59 permits either one maintained icon package or controlled
 * project-owned SVG icons. Project-owned icons are used here: they add no
 * dependency, guarantee a single consistent family (Doc 03 section 49 forbids
 * mixing families) and keep a uniform 24x24 bounding box with a
 * thin-to-medium stroke.
 *
 * All icons inherit currentColor. Icons are decorative by default and are
 * hidden from assistive technology unless a `title` is supplied, which turns
 * the icon into a labelled image (Doc 08 section 61).
 */

const PATHS = {
  arrowRight: <path d="M4 12h15m0 0-6-6m6 6-6 6" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.75v.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
      <path d="M12 10v4.25M12 17.4v.35" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 3.2 4.8 6.1v5.4c0 4.2 2.9 8 7.2 9.3 4.3-1.3 7.2-5.1 7.2-9.3V6.1L12 3.2Z" />
      <path d="m8.9 12.1 2.2 2.2 4-4.4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4m0 0L8 8m4-4 4 4" />
      <path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
};

export const ICON_NAMES = Object.keys(PATHS);

export default function Icon({ name, size = 'md', title, className = '', ...rest }) {
  const glyph = PATHS[name];
  if (!glyph) return null;

  const decorative = !title;

  return (
    <svg
      className={className}
      width={`var(--icon-${size})`}
      height={`var(--icon-${size})`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={title}
      focusable="false"
      style={{ flex: 'none' }}
      {...rest}
    >
      {glyph}
    </svg>
  );
}
