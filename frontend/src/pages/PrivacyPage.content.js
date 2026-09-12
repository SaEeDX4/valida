/**
 * Canonical Privacy copy — 06_CONTENT_COPY_DECK.md sections 155-168. Verbatim.
 *
 * Nothing here names a provider, a retention duration, a lawful basis, a DPO,
 * a privacy mailbox, a cookie or analytics behaviour, a data-residency
 * statement, a subprocessor, a certification, or a GDPR/PIPEDA compliance
 * claim — the canonical deck asserts none of those, and Doc 06 section 169
 * forbids adding a compliance claim to make the notice look stronger.
 */

export const PRIVACY_META = {
  title: 'Privacy Notice | Valida', // s155
  description:
    'Read the Valida Privacy Notice, including information about personal data provided through recruitment and website interactions.', // s156
};

export const PRIVACY_HEADING = 'Privacy Notice'; // s157

export const PRIVACY_INTRO =
  'Valida respects the importance of handling personal information carefully. This notice explains the types of personal information that may be processed through this website, why that information is used, and how it is protected within the Valida platform.'; // s158

/** s159-s168, in canonical order. */
export const PRIVACY_SECTIONS = [
  {
    title: 'Who We Are',
    paragraphs: ['Valida MB is a Lithuanian technology company.'],
  },
  {
    title: 'Information We Collect',
    paragraphs: [
      'The information we process depends on how you interact with Valida.',
      'When you apply for a position, this may include information you provide such as your name, contact details, resume, application responses, message or cover letter, and information associated with the position you selected.',
      'The website and supporting systems may also process technical information necessary to operate, secure, diagnose, and protect the service.',
    ],
  },
  {
    title: 'Why We Use Applicant Information',
    paragraphs: [
      'Recruitment information is used to receive and evaluate applications, communicate with candidates, administer the recruitment process, maintain appropriate records, protect the application service, and support legitimate company operations related to recruitment.',
    ],
  },
  {
    title: 'Resume and File Handling',
    paragraphs: [
      'Resumes and other private application files are intended to be stored through private system storage rather than exposed as unrestricted public website files.',
      'Access to applicant files is intended to be limited to authorized use connected with recruitment and system administration.',
    ],
  },
  {
    title: 'Service Providers',
    paragraphs: [
      'Valida may use technology service providers to operate parts of its website, hosting, storage, database, security, email, or other supporting infrastructure.',
      'Information may be processed by those providers where necessary to provide the relevant service, subject to the configurations and arrangements established for the Valida platform.',
    ],
  },
  {
    title: 'Security',
    paragraphs: [
      'Valida designs its systems with security controls appropriate to the type of information being handled. No internet-based system can guarantee absolute security, but the platform is intended to use safeguards such as access control, secure transmission, controlled private-file handling, validation, and other technical or operational protections where appropriate.',
    ],
  },
  {
    title: 'Retention',
    paragraphs: [
      'Personal information should be retained only for as long as reasonably required for the purpose for which it was collected and for applicable operational, record-keeping, legal, security, or dispute-related needs.',
      'Specific retention rules must remain aligned with Valida’s implemented processes and applicable requirements.',
    ],
  },
  {
    title: 'Data Minimization',
    paragraphs: [
      'Valida aims to request and retain information that is relevant to the purpose of the interaction rather than collecting personal information without a defined need.',
    ],
  },
  /*
   * 'Questions or Requests' (Doc 06 section 167) IS DELIBERATELY NOT RENDERED.
   *
   * The canonical section directs readers to "the current official contact
   * method published on the Valida website". No such method is published — it
   * is a Phase 2 dependency (Document 14), tracked as AWAITING INPUT.
   *
   * Its second canonical sentence ("A specific privacy mailbox may replace
   * this wording after Phase 2...") is internal roadmap language: it names an
   * implementation phase and refers to wording the visitor never sees. Public
   * privacy copy must not expose milestone vocabulary, and truth control
   * forbids inventing a replacement contact method.
   *
   * So the whole section is omitted rather than partially shown. It returns
   * verbatim once an approved, functional contact mechanism exists. The
   * dependency lives here in code, never in rendered production copy.
   */
  {
    title: 'Changes to This Notice',
    paragraphs: [
      'This notice may be updated as Valida’s website, recruitment processes, technology systems, or applicable obligations change. The version published on this website is the current website notice.',
    ],
  },
];
