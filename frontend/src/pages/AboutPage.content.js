/**
 * Canonical About copy — 06_CONTENT_COPY_DECK.md sections 54-76.
 * Verbatim. No company history, office, headcount, customer, partner,
 * milestone, award, certification or testimonial appears here, because none is
 * supported by Document 02 or the canonical deck.
 */

export const ABOUT_META = {
  title: 'About Valida | Security-First Technology', // s54
  description:
    'Learn about Valida’s technology direction, security-first engineering philosophy, and focus on building precise, maintainable digital systems.', // s55
};

export const ABOUT_HERO = {
  eyebrow: 'ABOUT VALIDA', // s56
  heading: 'Building technology with security at its foundation.', // s57
  body: 'Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering. We are building the company around disciplined technical work, thoughtful architecture, and a long-term approach to secure digital systems.', // s58
};

export const ABOUT_SECTIONS = [
  {
    id: 'company',
    eyebrow: 'THE COMPANY', // s59
    heading: 'A focused technology company with a security-first direction.', // s60
    // s61 — two canonical paragraphs, kept as separate paragraphs.
    paragraphs: [
      'Valida MB is a Lithuanian technology company whose registered activity context includes computer programming, computer consultancy, and other IT services.',
      'Our direction places cybersecurity and security engineering at the center of how we think about software, infrastructure, and digital systems.',
    ],
  },
  {
    id: 'direction',
    eyebrow: 'TECHNOLOGY DIRECTION', // s62
    heading: 'Security is a system property.', // s63
    paragraphs: [
      'Modern security is shaped by architecture, implementation, identity, data, infrastructure, operational processes, and the way those elements interact.',
      'Valida’s technology direction is built around understanding those connections and developing systems in which security is part of the engineering process from the beginning.',
    ], // s64
  },
  {
    id: 'engineering',
    eyebrow: 'ENGINEERING', // s65
    heading: 'Clear architecture. Real functionality. Verifiable results.', // s66
    paragraphs: [
      'We favor systems that perform real work, store real data when required, enforce rules in the right place, handle failure clearly, and can be tested against defined expectations.',
      'Complexity should be justified by a real need. Quality should not depend on unnecessary complexity.',
    ], // s67
  },
];

/** s68-s71 */
export const ABOUT_PRINCIPLES = [
  {
    title: 'Precision',
    body: 'Clear decisions, consistent systems, and careful implementation matter more than technical theatre.',
  },
  {
    title: 'Resilience',
    body: 'Systems should anticipate failure, protect important data, and remain understandable when something goes wrong.',
  },
  {
    title: 'Continuity',
    body: 'Good foundations should support future development without forcing the product to be rebuilt every time its scope grows.',
  },
  {
    title: 'Verification',
    body: 'Implementation is not the same as proof. Important functionality should be tested before it is treated as complete.',
  },
];

export const ABOUT_RND = {
  eyebrow: 'R&D DIRECTION', // s72
  heading: 'Keep learning. Keep improving the system.', // s73
  body: 'Security R&D forms part of Valida’s long-term technical direction. As the company grows, research, experimentation, security tooling, and system improvement can become part of its continuing engineering work.', // s74
};

export const ABOUT_CAREERS = {
  heading: 'Interested in the work behind Valida?', // s75
  body: 'Explore current opportunities and see where your experience could contribute to our technology and security direction.', // s76
  cta: 'Explore Careers', // s76
};
