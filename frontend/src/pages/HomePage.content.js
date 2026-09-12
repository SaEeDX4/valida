/**
 * Canonical Home copy — 06_CONTENT_COPY_DECK.md sections 11-53.
 *
 * Held as constants so this file can be diffed directly against Document 06
 * during content QA. Every string is verbatim canonical copy. Nothing here may
 * be paraphrased, softened or "improved" (Master Prompt claim control,
 * 02_BRAND_TRUTH_AND_CLAIMS.md).
 */

export const HOME_META = {
  // Doc 06 section 11
  title: 'Valida | Cybersecurity & Secure Technology',
  // Doc 06 section 12
  description:
    'Valida is a Lithuanian technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems.',
};

export const HERO = {
  eyebrow: 'CYBERSECURITY · SECURE TECHNOLOGY', // s13
  // s14 — the canonical H1 is set as two lines.
  headingLines: ['Secure systems.', 'Deliberate engineering.'],
  body: 'Valida is a technology company focused on cybersecurity, secure software, and security-first engineering — building modern systems with precision, resilience, and long-term maintainability in mind.', // s15
  primaryCta: 'Explore Careers', // s16
  secondaryCta: 'About Valida', // s17
};

export const POSITIONING = {
  eyebrow: 'OUR DIRECTION', // s18
  heading: 'Security belongs in the architecture.', // s19
  body: 'Strong digital systems are not created by adding security at the end. Valida is built around a security-first approach that considers architecture, software, access, infrastructure, and operational resilience as connected parts of the same system.', // s20
};

export const CAPABILITIES = {
  eyebrow: 'FOCUS AREAS', // s21
  heading: 'Engineering with security in the system.', // s22
  intro:
    'Our technology direction spans the disciplines that shape secure and resilient digital products — from application architecture and identity to infrastructure, vulnerability management, and security research.', // s23
  // s24-s30. These describe technical direction, not delivered commercial work.
  items: [
    {
      title: 'Security Engineering',
      body: 'Security-aware architecture, technical controls, and engineering decisions designed to reduce avoidable risk across modern systems.',
    },
    {
      title: 'Secure Software',
      body: 'Software designed with maintainability, clear trust boundaries, defensive development practices, and security built into the development lifecycle.',
    },
    {
      title: 'Application Security',
      body: 'A focus on the risks that emerge where applications, users, data, APIs, and infrastructure meet.',
    },
    {
      title: 'Identity & Access Security',
      body: 'Authentication, authorization, least privilege, and access-control thinking that treats identity as a core security boundary.',
    },
    {
      title: 'Cloud & Infrastructure Security',
      body: 'Security-minded infrastructure decisions with attention to configuration, access, resilience, operational visibility, and system boundaries.',
    },
    {
      title: 'Vulnerability Management',
      body: 'A disciplined approach to identifying, understanding, prioritizing, and reducing technical weaknesses.',
    },
    {
      title: 'Security R&D',
      body: 'Exploring better ways to build, evaluate, and improve security-focused technology as Valida’s technical platform develops.',
    },
  ],
};

export const PHILOSOPHY = {
  eyebrow: 'ENGINEERING PHILOSOPHY', // s31
  heading: 'Build for the system you need to trust.', // s32
  body: 'Security, usability, performance, and maintainability should reinforce one another. Our engineering philosophy favors clear architecture, controlled complexity, meaningful safeguards, and systems that can evolve without losing their integrity.', // s33
  principles: [
    {
      title: 'Security by Design',
      body: 'Security decisions begin with architecture and data flow rather than being treated as a final checklist.',
    }, // s34
    {
      title: 'Controlled Complexity',
      body: 'Add the architecture a real requirement needs — not layers of complexity introduced only to look sophisticated.',
    }, // s35
    {
      title: 'Maintainable Systems',
      body: 'Technology should remain understandable, testable, extensible, and safe to change as the organization grows.',
    }, // s36
  ],
};

export const OPERATING = {
  eyebrow: 'HOW WE THINK', // s37
  heading: 'Precision over noise.', // s38
  // s39-s42
  principles: [
    { title: 'Intentional', body: 'Every meaningful technical decision should have a reason.' },
    {
      title: 'Evidence-Oriented',
      body: 'Systems should be tested and verified rather than assumed to work.',
    },
    { title: 'Security-Minded', body: 'Security is part of normal engineering responsibility.' },
    {
      title: 'Built to Evolve',
      body: 'Start with what is needed now while preserving a coherent path forward.',
    },
  ],
};

export const CAREERS_FEATURE = {
  eyebrow: 'CAREERS', // s43
  heading: 'Build secure technology with intention.', // s44
  body: 'Valida is building its technology and security capabilities step by step. Explore current opportunities to contribute to the systems, engineering, and security work behind that growth.', // s45
  /*
   * TRUTH CONTROL — A4/A5 BOUNDARY
   *
   * Doc 06 section 46 gives "View Open Roles" as the Careers CTA. That wording
   * asserts that open roles exist. No Job record exists until Milestone B3, and
   * A4 is explicitly forbidden from displaying, fetching or implying one.
   *
   * "Explore Careers" is also canonical (Doc 06 section 47 and Doc 05 section
   * 55, the no-open-roles CTA) and is truthful in the current state. It is
   * navigation to /careers, not a claim that a role is published.
   *
   * A5 restores "View Open Roles" once the Careers page can actually report
   * whether roles exist.
   */
  cta: 'Explore Careers',
};

export const FINAL_CTA = {
  eyebrow: 'VALIDA', // s49
  heading: 'Technology built with security in mind.', // s50
  /*
   * TRUTH-CONTROLLED OMISSION.
   *
   * Doc 06 section 51 reads in full:
   *   "Learn more about Valida, explore current opportunities, or use our
   *    published company contact channel when you need to reach us."
   *
   * Valida has no published contact channel in the approved repository state —
   * it is a Phase 2 dependency (Document 14, AWAITING INPUT). Displaying that
   * clause would direct visitors to a channel that does not exist.
   *
   * The trailing clause is therefore removed and the remaining sentence is
   * reproduced verbatim. No replacement wording has been invented, and the
   * clause returns unchanged once the contact mechanism is verified.
   */
  body: 'Learn more about Valida, explore current opportunities.',
  primaryCta: 'About Valida', // s52
  secondaryCta: 'Careers', // s53
};
