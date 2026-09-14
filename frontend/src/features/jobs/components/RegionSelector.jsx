import { useId } from 'react';
import {
  SELECTABLE_REGIONS, COUNTRY_LABELS, INTERNATIONAL_REGION, regionLabel,
} from '../markets.js';
import styles from './RegionSelector.module.css';

/**
 * Regional view badge and selector.
 *
 * WORDING IS DELIBERATE. It says "Regional view", never "Based on your
 * location". A5 has no trusted location signal — the region comes from a URL
 * parameter or a browser locale preference — so claiming to know where the
 * visitor is would be untrue.
 *
 * It also never states or implies eligibility. Whether a Job can be filled in
 * the selected country is decided by the Job's own configuration and is shown
 * in the Employment Details, not here.
 *
 * ACCESSIBILITY: a native <select> with a real <label>, so it is keyboard
 * operable and carries the shared focus ring with no custom dropdown. The flag
 * emoji is decorative and aria-hidden; the country NAME is always present as
 * text, so nothing depends on the flag.
 */

/** Regional-indicator flag from a country code. Decorative only. */
function flagFor(region) {
  if (region === INTERNATIONAL_REGION || !/^[A-Z]{2}$/.test(region)) return null;
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export default function RegionSelector({ region, onChange, standalone = false, caption }) {
  const id = `region-${useId()}`;
  const flag = flagFor(region);
  const label = regionLabel(region) ?? region;

  return (
    <div className={`${styles.region} ${standalone ? styles.standalone : ''}`.trim()}>
      <div className={styles.context}>
        <p className={`t-label ${styles.country}`}>
          {flag ? (
            <span className={styles.flag} aria-hidden="true">
              {flag}
            </span>
          ) : null}
          {label}
        </p>
        <p className={`t-caption ${styles.caption}`}>{caption ?? 'Regional view'}</p>
      </div>

      <div className={styles.control}>
        <label className="visually-hidden" htmlFor={id}>
          Change regional view
        </label>
        <select
          id={id}
          className={`t-body-sm ${styles.select}`}
          value={region}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value={INTERNATIONAL_REGION}>International</option>
          {SELECTABLE_REGIONS.map((code) => (
            <option key={code} value={code}>
              {COUNTRY_LABELS[code]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
