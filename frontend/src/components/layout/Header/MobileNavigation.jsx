import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import Button from '../../ui/Button/Button.jsx';
import Icon from '../../ui/Icon/Icon.jsx';
import { PRIMARY_NAV, HEADER_CTA } from './navItems.js';
import styles from './MobileNavigation.module.css';

/**
 * Mobile navigation — Doc 05 sections 16-19, Doc 08 sections 25-27.
 *
 * Explicit open/closed state. When open:
 *   - background scrolling is locked and restored exactly on close;
 *   - focus moves into the panel;
 *   - Escape closes;
 *   - selecting a route closes the menu;
 *   - focus returns to the trigger.
 *
 * The panel is unmounted when closed rather than merely hidden, so its links
 * are never reachable by Tab while invisible — a hidden-but-focusable menu is
 * a common keyboard trap.
 *
 * Copy is canonical: Document 06 section 9 supplies "Menu", "Open navigation"
 * and "Close navigation".
 */
export default function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef(null);
  const firstLinkRef = useRef(null);
  const location = useLocation();

  /**
   * Closes the menu and returns focus to the trigger.
   *
   * Focus restoration lives here rather than only in the toggle handler, so
   * every close path restores focus — Escape included. Without this, pressing
   * Escape unmounts the focused element and focus falls back to <body>, which
   * strands a keyboard user (Doc 08 section 27).
   *
   * Route controls call this too. On a genuine navigation the focus set here
   * is immediately superseded by RouteChangeHandler, which moves focus to the
   * main landmark; on a same-route activation no navigation occurs, so focus
   * correctly stays on the trigger instead of being lost with the unmounted
   * link.
   */
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  /*
   * Route change closes the menu (Doc 05 section 18).
   *
   * This covers closures the panel does not originate — browser Back/Forward,
   * or navigation triggered elsewhere. It cannot be the only mechanism,
   * because activating a link to the route you are already on leaves pathname
   * unchanged and this effect never runs. Every control inside the panel
   * therefore closes the menu explicitly as well.
   */
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Escape closes (Doc 05 section 18).
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  /*
   * Body scroll lock — Doc 08 section 26. The previous inline value is captured
   * and restored, rather than blindly setting "", so an unrelated style set by
   * another component is not destroyed. The cleanup also runs on unmount, so
   * the body can never be left permanently locked.
   */
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  /*
   * Focus enters the menu when it opens (Doc 05 section 18).
   *
   * Focus lands on the first navigation link, not on the panel wrapper. A
   * wrapper with tabIndex={-1} takes focus but shows no focus indicator, so a
   * keyboard user would be left with no visible focus at all — which Doc 05
   * section 15 and the A3 quality bar forbid. A real link picks up the shared
   * :focus-visible ring from the design system.
   */
  useEffect(() => {
    if (open) firstLinkRef.current?.focus();
  }, [open]);

  const toggle = () => {
    setOpen((wasOpen) => {
      // Focus returns to the trigger on close (Doc 08 section 27).
      if (wasOpen) triggerRef.current?.focus();
      return !wasOpen;
    });
  };

  return (
    <div className={styles.mobileNav}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="compact"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
      >
        <Icon name={open ? 'close' : 'menu'} size="sm" />
        <span>Menu</span>
      </Button>

      {open ? (
        <div id={panelId} className={styles.panel}>
          <nav aria-label="Primary" className={styles.panelNav}>
            <ul className={styles.panelList}>
              {PRIMARY_NAV.map((item, index) => (
                <li key={item.to}>
                  <NavLink
                    ref={index === 0 ? firstLinkRef : undefined}
                    to={item.to}
                    end={item.end}
                    onClick={close}
                    className={({ isActive }) =>
                      [styles.panelLink, 't-h4', isActive ? styles.panelLinkActive : '']
                        .filter(Boolean)
                        .join(' ')
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Button as={Link} href={HEADER_CTA.to} variant="primary" size="standard" onClick={close}>
            {HEADER_CTA.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
