import { NavLink } from 'react-router';
import { PRIMARY_NAV } from './navItems.js';
import styles from './Header.module.css';

/**
 * Desktop primary navigation.
 *
 * Doc 05 section 13: the active state uses typography and a subtle accent
 * indicator, never colour alone. aria-current="page" carries the same meaning
 * to assistive technology, so the state is never purely visual.
 *
 * Careers stays active across /careers/* so a visitor on a Job Detail or Apply
 * route still sees where they are (Doc 05 section 13).
 */
export default function DesktopNavigation() {
  return (
    <ul className={styles.navList}>
      {PRIMARY_NAV.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [styles.navLink, 't-nav', isActive ? styles.navLinkActive : ''].filter(Boolean).join(' ')
            }
          >
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
