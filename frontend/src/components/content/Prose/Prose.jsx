import { Fragment } from 'react';
import styles from './Prose.module.css';

/**
 * Editorial reading container for the Privacy and Legal documents.
 *
 * Doc 05 sections 146-149 require a narrow measure (roughly 680-800px), a
 * clear H1 / H2 / paragraph / list hierarchy and no tiny low-contrast legal
 * typography. Both documents share one implementation so their treatment
 * cannot drift apart.
 */
export default function Prose({ children, className = '' }) {
  return <div className={`${styles.prose} ${className}`.trim()}>{children}</div>;
}

/** Introductory paragraph, separated from the body by a hairline rule. */
export function ProseLead({ children }) {
  return <p className={`t-body-lg ${styles.lead}`}>{children}</p>;
}

/**
 * A titled document section.
 *
 * Renders a real <section> with an <h2>, so the document outline matches the
 * visual hierarchy (Doc 05 section 149).
 */
export function ProseSection({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={`t-h4 ${styles.heading}`}>{title}</h2>
      {children}
    </section>
  );
}

export function ProseParagraph({ children }) {
  return <p className={`t-body ${styles.paragraph}`}>{children}</p>;
}

/** Unordered list with a restrained rule marker instead of a bullet glyph. */
export function ProseList({ items }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item} className={`t-body ${styles.listItem}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Label/value pairs as a description list — the correct semantics for the
 * Legal company information block, and better than a table for two columns.
 *
 * Each pair is grouped with a Fragment rather than a wrapper element, so the
 * <dt> and <dd> stay direct children of the <dl>. That keeps the description
 * list valid and lets the grid place them directly, with no display: contents
 * workaround and no element that exists purely for styling.
 */
export function ProseFacts({ facts }) {
  return (
    <dl className={styles.facts}>
      {facts.map(({ term, value }) => (
        <Fragment key={term}>
          <dt className={`t-label ${styles.factTerm}`}>{term}</dt>
          <dd className={`t-body ${styles.factValue}`}>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
