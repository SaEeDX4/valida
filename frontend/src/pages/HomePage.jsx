import { Link } from 'react-router';
import Container from '../components/layout/Container/Container.jsx';
import Section, { SectionEyebrow, SectionHeader } from '../components/layout/Section/Section.jsx';
import Button from '../components/ui/Button/Button.jsx';
import SecurityField from '../components/graphics/SecurityField/SecurityField.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import { ROUTES } from '../routes/paths.js';
import {
  HOME_META,
  HERO,
  POSITIONING,
  CAPABILITIES,
  PHILOSOPHY,
  OPERATING,
  CAREERS_FEATURE,
  FINAL_CTA,
} from './HomePage.content.js';
import styles from './HomePage.module.css';

/**
 * Home — 18_IMPLEMENTATION_ROADMAP.md section 63.
 *
 * Canonical section sequence, in order and not reordered:
 *   1 Hero · 2 Positioning · 3 Capability Architecture ·
 *   4 Security Engineering Philosophy · 5 Operating Principles ·
 *   6 Careers Feature · 7 Final CTA · (8 Global Footer, from PublicLayout)
 *
 * All copy is canonical Document 06, held in HomePage.content.js so it can be
 * diffed against the deck directly.
 *
 * CLAIM CONTROL (02_BRAND_TRUTH_AND_CLAIMS.md)
 * Capability entries describe technical direction. They are never phrased as
 * delivered work, and this page contains no customer, certification, metric,
 * award or track-record claim. There is no Job record, no Jobs request and no
 * role preview — those belong to A5/B3.
 *
 * Headings run h1 (hero) then h2 per section, with h3 inside principle and
 * capability lists, so the outline is linear.
 */
export default function HomePage() {
  return (
    <>
      <PageMeta title={HOME_META.title} description={HOME_META.description} />

      {/* 1 — HERO */}
      <section className={styles.hero} aria-labelledby="home-hero-heading">
        <Container width="wide">
          <div className={styles.heroGrid}>
            <div className={styles.heroText}>
              <p className="t-eyebrow">{HERO.eyebrow}</p>
              <h1 id="home-hero-heading" className={`t-display ${styles.heroHeading}`}>
                <span className={styles.heroLine}>{HERO.headingLines[0]}</span>{' '}
                <span className={`${styles.heroLine} ${styles.heroLineAccent}`}>
                  {HERO.headingLines[1]}
                </span>
              </h1>
              <p className={`t-body-lg t-measure ${styles.heroBody}`}>{HERO.body}</p>
              <div className={styles.ctaGroup}>
                <Button as={Link} href={ROUTES.CAREERS} variant="primary" size="large">
                  {HERO.primaryCta}
                </Button>
                <Button as={Link} href={ROUTES.ABOUT} variant="secondary" size="large">
                  {HERO.secondaryCta}
                </Button>
              </div>
            </div>

            {/* Decorative: the hero's meaning is carried entirely by the text,
                and SecurityField is aria-hidden (Doc 05 section 43). */}
            <div className={styles.heroVisual}>
              <SecurityField />
            </div>
          </div>
        </Container>
      </section>

      {/* 2 — POSITIONING */}
      <Section spacing="lg" surface="secondary" aria-labelledby="home-positioning-heading">
        <Container width="wide">
          <div className={styles.positioningGrid}>
            <div>
              <SectionEyebrow>{POSITIONING.eyebrow}</SectionEyebrow>
              <h2
                id="home-positioning-heading"
                className={`t-h2 ${styles.positioningHeading}`}
              >
                {POSITIONING.heading}
              </h2>
            </div>
            <p className={`t-body-lg ${styles.positioningBody}`}>{POSITIONING.body}</p>
          </div>
        </Container>
      </Section>

      {/* 3 — CAPABILITY ARCHITECTURE */}
      <Section spacing="lg" aria-labelledby="home-capabilities-heading">
        <Container width="wide">
          <div className={styles.capabilityGrid}>
            <div className={styles.capabilityLead}>
              <SectionEyebrow>{CAPABILITIES.eyebrow}</SectionEyebrow>
              <h2 id="home-capabilities-heading" className="t-h2">
                {CAPABILITIES.heading}
              </h2>
              <p className={`t-body ${styles.capabilityIntro}`}>{CAPABILITIES.intro}</p>
            </div>

            {/*
              An indexed technical list, not a card grid. Nothing here is
              interactive: no link, no button, no hover lift and no pointer
              cursor, because there is nowhere to go until /services and
              /cybersecurity exist in Phase 5 (Doc 05 sections 48-49).
            */}
            <ul className={styles.capabilityList}>
              {CAPABILITIES.items.map((item, index) => (
                <li key={item.title} className={styles.capabilityItem}>
                  <span className={`t-mono ${styles.capabilityIndex}`} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className={`t-h4 ${styles.capabilityTitle}`}>{item.title}</h3>
                    <p className={`t-body-sm ${styles.capabilityBody}`}>{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      {/* 4 — SECURITY ENGINEERING PHILOSOPHY */}
      <Section spacing="lg" surface="secondary" aria-labelledby="home-philosophy-heading">
        <Container width="wide">
          <div className={styles.philosophyGrid}>
            <div className={styles.philosophyNarrative}>
              <SectionEyebrow>{PHILOSOPHY.eyebrow}</SectionEyebrow>
              <h2 id="home-philosophy-heading" className="t-h2">
                {PHILOSOPHY.heading}
              </h2>
              <p className={`t-body ${styles.philosophyBody}`}>{PHILOSOPHY.body}</p>
            </div>

            <ul className={styles.philosophyList}>
              {PHILOSOPHY.principles.map((principle) => (
                <li key={principle.title} className={styles.philosophyItem}>
                  <h3 className={`t-h4 ${styles.philosophyTitle}`}>{principle.title}</h3>
                  <p className={`t-body ${styles.philosophyItemBody}`}>{principle.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      {/* 5 — OPERATING PRINCIPLES */}
      <Section spacing="md" aria-labelledby="home-operating-heading">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>{OPERATING.eyebrow}</SectionEyebrow>
            <h2 id="home-operating-heading" className="t-h2">
              {OPERATING.heading}
            </h2>
          </SectionHeader>
          <ul className={styles.operatingGrid}>
            {OPERATING.principles.map((principle) => (
              <li key={principle.title} className={styles.operatingItem}>
                <h3 className={`t-label ${styles.operatingTitle}`}>{principle.title}</h3>
                <p className={`t-body-sm ${styles.operatingBody}`}>{principle.body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* 6 — CAREERS FEATURE */}
      <Section spacing="lg" surface="secondary" aria-labelledby="home-careers-heading">
        <Container width="wide">
          <div className={styles.careersGrid}>
            <div>
              <SectionEyebrow>{CAREERS_FEATURE.eyebrow}</SectionEyebrow>
              <h2
                id="home-careers-heading"
                className={`t-h2 ${styles.careersHeading}`}
              >
                {CAREERS_FEATURE.heading}
              </h2>
              <p className={`t-body-lg t-measure ${styles.careersBody}`}>
                {CAREERS_FEATURE.body}
              </p>
            </div>
            {/*
              Navigation to /careers only. No role preview, no Jobs request and
              no statement about whether roles exist — A4 has no Job data and
              must not imply any (Doc 18 section 63, A5/B3 own that).
            */}
            <div className={styles.careersAction}>
              <Button as={Link} href={ROUTES.CAREERS} variant="primary" size="large">
                {CAREERS_FEATURE.cta}
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      {/* 7 — FINAL CTA */}
      <Section spacing="lg" className={styles.final} aria-labelledby="home-final-heading">
        <Container width="wide">
          <div className={styles.finalInner}>
            <SectionEyebrow>{FINAL_CTA.eyebrow}</SectionEyebrow>
            <h2 id="home-final-heading" className="t-h2">
              {FINAL_CTA.heading}
            </h2>
            <p className={`t-body-lg ${styles.finalBody}`}>{FINAL_CTA.body}</p>
            <div className={styles.ctaGroup}>
              <Button as={Link} href={ROUTES.ABOUT} variant="primary" size="large">
                {FINAL_CTA.primaryCta}
              </Button>
              <Button as={Link} href={ROUTES.CAREERS} variant="secondary" size="large">
                {FINAL_CTA.secondaryCta}
              </Button>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
