import { Link } from 'react-router';
import Container from '../components/layout/Container/Container.jsx';
import Section, { SectionEyebrow } from '../components/layout/Section/Section.jsx';
import Button from '../components/ui/Button/Button.jsx';
import SecurityField from '../components/graphics/SecurityField/SecurityField.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import { ROUTES } from '../routes/paths.js';
import styles from './NotFoundPage.module.css';

/**
 * Application-level 404 — Doc 05 sections 157-162, Doc 04 section 43,
 * Doc 08 section 21.
 *
 * Unlike the other A3 routes this is not a placeholder: the 404 experience is
 * an A3 deliverable and is implemented in full.
 *
 * Every string is canonical Document 06 copy — eyebrow (section 180), H1
 * (181), body (182), primary CTA (183), secondary CTA (184) and SEO title
 * (179). Nothing is invented.
 *
 * Doc 05 section 159 forbids jokes, fake terminal errors and scary security
 * errors, so the page states the situation plainly. Doc 04 section 43 forbids
 * exposing technical stack or server information and forbids trapping the
 * visitor, so two real recovery routes are offered. Doc 05 section 161
 * requires an H1 that explains the missing page, descriptive links, and no
 * automatic redirect — there is none.
 *
 * The Security Field is decorative and aria-hidden, and is hidden entirely on
 * mobile so recovery actions stay reachable without scrolling.
 */
export default function NotFoundPage() {
  return (
    <>
      {/*
        A6 (Doc 16 SEO): a 404 is not indexable content. A single-page app
        serves this route with HTTP 200 from the static host, so without an
        explicit directive a crawler could index "This page doesn't exist." as
        a real page. noindex keeps it out of search results; follow still lets
        crawlers reach the recovery links to Home and Careers.

        This matches the Job Detail unavailable state, which already carried
        the same directive — the application-level 404 did not.
      */}
      <PageMeta title="Page Not Found | Valida" robots="noindex, follow" />
      <Section spacing="lg">
        <Container width="standard">
          <div className={styles.layout}>
            <div className={styles.content}>
              <SectionEyebrow>404</SectionEyebrow>
              <h1 className="t-h1">This page doesn’t exist.</h1>
              <p className={`t-body-lg t-measure ${styles.body}`}>
                The address may be incorrect, or the page may have moved.
              </p>
              <div className={styles.actions}>
                <Button as={Link} href={ROUTES.HOME} variant="primary" size="large">
                  Go to Home
                </Button>
                <Button as={Link} href={ROUTES.CAREERS} variant="secondary" size="large">
                  View Careers
                </Button>
              </div>
            </div>
            <div className={styles.graphic}>
              <SecurityField />
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
