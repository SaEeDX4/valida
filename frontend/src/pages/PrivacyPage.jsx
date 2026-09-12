import Container from '../components/layout/Container/Container.jsx';
import Section from '../components/layout/Section/Section.jsx';
import Prose, {
  ProseLead,
  ProseSection,
  ProseParagraph,
} from '../components/content/Prose/Prose.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import {
  PRIVACY_META,
  PRIVACY_HEADING,
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
} from './PrivacyPage.content.js';
import styles from './LegalDocument.module.css';

/**
 * Privacy Notice — Doc 18 section 65, Doc 05 sections 144-151, Doc 06 155-168.
 *
 * Narrow editorial layout (Prose, roughly 736px measure), semantic H1/H2
 * structure, standard body contrast rather than muted "legal grey".
 *
 * PUBLICATION GATE — NOT CLOSED (Doc 06 section 169)
 * A4 implements the baselined presentation only. Before real candidate data is
 * accepted, this notice must be reconciled with implemented data flows, actual
 * storage, actual providers, actual analytics/cookie behaviour, the actual
 * retention policy, the actual contact mechanism and current applicable
 * privacy requirements. A4 asserts no legal compliance.
 */
export default function PrivacyPage() {
  return (
    <>
      <PageMeta title={PRIVACY_META.title} description={PRIVACY_META.description} />
      <Section spacing="lg">
        <Container width="standard">
          <Prose>
            <h1 className={`t-h1 ${styles.heading}`}>
              {PRIVACY_HEADING}
            </h1>
            <ProseLead>{PRIVACY_INTRO}</ProseLead>

            {PRIVACY_SECTIONS.map((section) => (
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
