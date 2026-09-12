import Container from '../components/layout/Container/Container.jsx';
import Section from '../components/layout/Section/Section.jsx';
import Prose, {
  ProseSection,
  ProseParagraph,
  ProseFacts,
} from '../components/content/Prose/Prose.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import {
  LEGAL_META,
  LEGAL_HEADING,
  COMPANY_FACTS,
  LEGAL_SECTIONS,
} from './LegalPage.content.js';
import styles from './LegalDocument.module.css';

/**
 * Legal Information — Doc 18 section 65, Doc 05 sections 152-156,
 * Doc 06 sections 170-177.
 *
 * Shares the Prose reading layout with Privacy so the two documents cannot
 * drift apart typographically. Company facts render as a description list,
 * which is the correct semantics for label/value pairs.
 *
 * PUBLICATION GATE — NOT CLOSED (Doc 06 section 178)
 * A4 implements the baselined structure and copy. It does not establish legal
 * compliance. Before deployment, actual company disclosure requirements,
 * registered contact/address disclosure requirements, required website terms,
 * final intellectual-property wording and current authoritative legal
 * requirements must all be verified.
 */
export default function LegalPage() {
  return (
    <>
      <PageMeta title={LEGAL_META.title} description={LEGAL_META.description} />
      <Section spacing="lg">
        <Container width="standard">
          <Prose>
            <h1 className={`t-h1 ${styles.heading} ${styles.headingWide}`}>
              {LEGAL_HEADING}
            </h1>

            <ProseSection title="Company Information">
              <ProseFacts facts={COMPANY_FACTS} />
            </ProseSection>

            {LEGAL_SECTIONS.map((section) => (
              <ProseSection key={section.title} title={section.title}>
                {section.paragraphs.map((paragraph) => (
                  <ProseParagraph key={paragraph}>{paragraph}</ProseParagraph>
                ))}
              </ProseSection>
            ))}
          </Prose>
        </Container>
      </Section>
    </>
  );
}
