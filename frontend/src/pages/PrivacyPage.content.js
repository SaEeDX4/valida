/**
 * Canonical Privacy copy — 06_CONTENT_COPY_DECK.md sections 155-168. Verbatim.
 *
 * Recruitment wording (2026-11-24): the contact and retention texts are owner-
 * approved; the legal-basis and provider texts need the owner's approval before
 * merge. Providers and transfers come from their published terms. No retention
 * duration, DPO, certification or compliance claim is made, and Doc 06 section
 * 169 forbids adding one to make the notice look stronger.
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
    paragraphs: [
      'Valida MB (company code 308123132) is a Lithuanian technology company and is responsible for the personal information described in this notice. Address: Arkos g. 1, Avižienių sen., LT-14180 Klevinės k., Lithuania. Email: careers@cybervalida.com.',
    ],
  },
  {
    title: 'Information We Collect',
    paragraphs: [
      'The information we process depends on how you interact with Valida.',
      'When you apply for a position, this may include information you provide such as your name, contact details, resume, application responses, message or cover letter, and information associated with the position you selected.',
      'When you apply, your name, email address and resume are required. Your phone number and message are optional.',
      'The website and supporting systems may also process technical information necessary to operate, secure, diagnose, and protect the service.',
    ],
  },
  {
    title: 'Why We Use Applicant Information',
    paragraphs: [
      'Recruitment information is used to receive and evaluate applications, communicate with candidates, administer the recruitment process, maintain appropriate records, protect the application service, and support legitimate company operations related to recruitment.',
      'We use your application details and resume to consider you for the position you selected and to contact you about it; we do this to take steps at your request before a possible employment contract (GDPR Article 6(1)(b)). We keep security logs, protect the application service, record who accessed applications and keep records for possible disputes on the basis of our legitimate interests (Article 6(1)(f)). Where a law requires us to keep a record, we do so to meet that obligation (Article 6(1)(c)).',
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
      'We use Render (website and application hosting), MongoDB Atlas (application records and resumes, stored in Frankfurt, Germany) and Titan email supplied through Bluehost (Newfold Digital). These providers, or companies they use, may process information in the United States. Their published terms rely on the EU-U.S. Data Privacy Framework (Render and MongoDB) and on EU standard contractual clauses.',
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
      'Applications and resumes are deleted manually. We keep them while the position is open and afterwards only as long as needed for the recruitment decision, possible disputes and record-keeping required by law. Email correspondence is kept in Valida’s company email archive.',
    ],
  },
  {
    title: 'Data Minimization',
    paragraphs: [
      'Valida aims to request and retain information that is relevant to the purpose of the interaction rather than collecting personal information without a defined need.',
    ],
  },
  {
    title: 'Your Rights',
    paragraphs: [
      'You may ask for access to, correction, deletion or restriction of your information, ask for a copy in a portable form, or object to its use. Write to careers@cybervalida.com. You may also complain to the Lithuanian State Data Protection Inspectorate (VDAI) or your local data protection authority.',
    ],
  },
  {
    title: 'Automated Decisions',
    paragraphs: ['Valida makes no automated hiring decisions.'],
  },
  /*
   * Doc 06 section 167. The contact method is the Contact page (owner approval
   * A-4, 2026-11-24). The section's second canonical sentence is internal
   * roadmap language and is never rendered.
   */
  {
    title: 'Questions or Requests',
    paragraphs: [
      'If you have a question about personal information provided to Valida, use the current official contact method published on the Valida website.',
    ],
  },
  {
    title: 'Changes to This Notice',
    paragraphs: [
      'This notice may be updated as Valida’s website, recruitment processes, technology systems, or applicable obligations change. The version published on this website is the current website notice.',
    ],
  },
];
