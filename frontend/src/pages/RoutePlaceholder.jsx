import Container from '../components/layout/Container/Container.jsx';
import Section, { SectionEyebrow, SectionHeader } from '../components/layout/Section/Section.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';

/**
 * Shared A3 route placeholder.
 *
 * SCOPE (18_IMPLEMENTATION_ROADMAP.md sections 53-57)
 * A3 is the application shell. It proves the router, layout, header, footer
 * and 404 work. The real content for these routes is implemented later:
 *   Home, About, Privacy, Legal -> A4
 *   Careers, Job Detail         -> A5 presentation, B3 data
 *   Apply                       -> A5 presentation, B5 submission
 *
 * These placeholders exist only to prove routing. They state plainly which
 * milestone owns the page and make no company claim, no capability claim and
 * no operational assertion (02_BRAND_TRUTH_AND_CLAIMS.md). They must not be
 * grown into page implementations.
 *
 * Each supplies the canonical Document 06 SEO title for its route so that
 * route changes update the document title as Doc 05 section 20 requires.
 */
export default function RoutePlaceholder({ title, heading, milestone, children }) {
  return (
    <>
      <PageMeta title={title} />
      <Section spacing="lg">
        <Container width="standard">
          <SectionHeader>
            <SectionEyebrow>Milestone A3 — application shell</SectionEyebrow>
            <h1 className="t-h1">{heading}</h1>
            <p className="t-body-lg t-measure">
              This route is registered and rendering inside the Valida application shell.
              Its content is implemented in Milestone {milestone}.
            </p>
          </SectionHeader>
          {children}
        </Container>
      </Section>
    </>
  );
}
