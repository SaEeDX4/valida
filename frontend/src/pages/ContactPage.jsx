import Container from '../components/layout/Container/Container.jsx';
import Section from '../components/layout/Section/Section.jsx';
import Prose, { ProseSection } from '../components/content/Prose/Prose.jsx';
import TextLink from '../components/ui/TextLink/TextLink.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import { STATIC_HEADS } from '../seo/routeHeads.js';
import { COMPANY_ADDRESS_LINES, CONTACT_EMAIL, CONTACT_HEADING } from './ContactPage.content.js';
import styles from './LegalDocument.module.css';

/** Contact — the company's email and address, and nothing more (no form, no map, no hours). */
export default function ContactPage() {
  return (
    <>
      <PageMeta {...STATIC_HEADS.CONTACT} />
      <Section spacing="lg">
        <Container width="standard">
          <Prose>
            <h1 className={`t-h1 ${styles.heading}`}>{CONTACT_HEADING}</h1>

            <ProseSection title="Email">
              <p className="t-body">
                <TextLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</TextLink>
              </p>
            </ProseSection>

            <ProseSection title="Company Address">
              <address className={`t-body ${styles.address}`}>
                {COMPANY_ADDRESS_LINES.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </address>
            </ProseSection>
          </Prose>
        </Container>
      </Section>
    </>
  );
}
