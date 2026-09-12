import { Link } from 'react-router';
import Container from '../components/layout/Container/Container.jsx';
import Section, { SectionEyebrow, SectionHeader } from '../components/layout/Section/Section.jsx';
import Button from '../components/ui/Button/Button.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import { ROUTES } from '../routes/paths.js';
import {
  ABOUT_META,
  ABOUT_HERO,
  ABOUT_SECTIONS,
  ABOUT_PRINCIPLES,
  ABOUT_RND,
  ABOUT_CAREERS,
} from './AboutPage.content.js';
import styles from './AboutPage.module.css';

/**
 * About — 18_IMPLEMENTATION_ROADMAP.md section 64, Doc 05 sections 60-73.
 *
 * Canonical section order: Page Hero, Company Identity, Technology/Security
 * Direction, Engineering Philosophy, Operating Principles, R&D Direction,
 * Careers CTA, then the Global Footer from PublicLayout.
 *
 * CLAIM CONTROL (02_BRAND_TRUTH_AND_CLAIMS.md)
 * No founding story, office location, headcount, customer, partner, milestone,
 * award, certification, testimonial, global presence or delivered-project
 * result appears here — none is supported by the canonical deck. The single
 * legal reference is the one Document 06 section 61 itself makes; the detailed
 * registration facts live on Legal, per Doc 05 section 65.
 *
 * The page carries no photography of people, offices, labs or server rooms,
 * and no decorative graphic is needed to understand any section
 * (Doc 05 section 73).
 */
export default function AboutPage() {
  return (
    <>
      <PageMeta title={ABOUT_META.title} description={ABOUT_META.description} />

      {/* 1 — PAGE HERO */}
      <section className={styles.hero} aria-labelledby="about-hero-heading">
        <Container width="wide">
          <div className={styles.heroInner}>
            <p className="t-eyebrow">{ABOUT_HERO.eyebrow}</p>
            <h1 id="about-hero-heading" className={`t-h1 ${styles.heroHeading}`}>
              {ABOUT_HERO.heading}
            </h1>
            <span className={styles.heroRule} aria-hidden="true" />
            <p className={`t-body-lg ${styles.heroBody}`}>{ABOUT_HERO.body}</p>
          </div>
        </Container>
      </section>

      {/* 2, 3, 4 — COMPANY IDENTITY / TECHNOLOGY DIRECTION / ENGINEERING */}
      <Container width="wide">
        {ABOUT_SECTIONS.map((section, index) => (
          <section
            key={section.id}
            aria-labelledby={`about-${section.id}-heading`}
            // Alternating asymmetry (Doc 05 section 66). The flip is visual
            // only; DOM order — and therefore reading order — never changes.
            className={`${styles.editorial} ${index % 2 === 1 ? styles.editorialAlt : ''}`.trim()}
          >
            <div className={styles.editorialLead}>
              <SectionEyebrow>{section.eyebrow}</SectionEyebrow>
              <h2 id={`about-${section.id}-heading`} className={`t-h3 ${styles.editorialHeading}`}>
                {section.heading}
              </h2>
            </div>
            <div className={styles.editorialBody}>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className={`t-body-lg ${styles.editorialParagraph}`}>
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </Container>

      {/* 5 — OPERATING PRINCIPLES */}
      <Section spacing="lg" surface="secondary" aria-labelledby="about-principles-heading">
        <Container width="wide">
          {/*
            Document 06 supplies the four principle titles and bodies
            (sections 68-71) but no heading or eyebrow for this section. Rather
            than invent a marketing headline, the section is labelled with its
            canonical NAME from Doc 05 section 63, "Operating Principles". The
            h2 is visually hidden so the document outline stays correct and the
            section has an accessible name, while the visible hierarchy is
            carried by the eyebrow and the principles themselves.
          */}
          <SectionHeader>
            <SectionEyebrow>OPERATING PRINCIPLES</SectionEyebrow>
            <h2 id="about-principles-heading" className="visually-hidden">
              Operating Principles
            </h2>
          </SectionHeader>
          <ul className={styles.principles}>
            {ABOUT_PRINCIPLES.map((principle, index) => (
              <li key={principle.title} className={styles.principle}>
                <span className={`t-mono ${styles.principleIndex}`} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className={`t-h4 ${styles.principleTitle}`}>{principle.title}</h3>
                  <p className={`t-body ${styles.principleBody}`}>{principle.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* 6 — R&D DIRECTION */}
      <Section spacing="lg" aria-labelledby="about-rnd-heading">
        <Container width="wide">
          <div className={styles.rnd}>
            <SectionEyebrow>{ABOUT_RND.eyebrow}</SectionEyebrow>
            <h2 id="about-rnd-heading" className="t-h2">
              {ABOUT_RND.heading}
            </h2>
            <p className={`t-body-lg ${styles.rndBody}`}>{ABOUT_RND.body}</p>
          </div>
        </Container>
      </Section>

      {/* 7 — CAREERS CTA */}
      <Section spacing="lg" surface="secondary" aria-labelledby="about-careers-heading">
        <Container width="wide">
          <div className={styles.careers}>
            <h2 id="about-careers-heading" className="t-h2">
              {ABOUT_CAREERS.heading}
            </h2>
            <p className={`t-body-lg ${styles.careersBody}`}>{ABOUT_CAREERS.body}</p>
            <Button as={Link} href={ROUTES.CAREERS} variant="primary" size="large">
              {ABOUT_CAREERS.cta}
            </Button>
          </div>
        </Container>
      </Section>
    </>
  );
}
