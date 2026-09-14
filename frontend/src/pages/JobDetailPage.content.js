/** Canonical Job Detail copy — Doc 06 sections 94-106. Verbatim. */
export const JOB_DETAIL = {
  breadcrumbRoot: 'Careers', // s96
  labels: {
    about: 'About the Role',
    responsibilities: 'Responsibilities',
    requirements: 'Requirements',
    preferredQualifications: 'Preferred Qualifications',
    employmentDetails: 'Employment Details',
  }, // s99
  primaryCta: 'Apply for This Role', // s100
  finalCta: {
    heading: 'Interested in this opportunity?', // s101
    body: 'Review the role details above and submit your application when you’re ready.', // s102
    button: 'Apply for This Role',
  },
  loadingStatus: 'Loading role details…', // s103
  notFound: {
    heading: "This role isn't available.",
    body: 'We couldn’t find a published position at this address.',
    primary: 'View Open Roles',
    secondary: 'Go to Home',
  }, // s104
  closed: {
    status: 'Applications Closed',
    heading: 'This position is no longer accepting applications.',
    body: 'You can return to Careers to view any other currently published opportunities.',
    cta: 'View Open Roles',
  }, // s105
  error: {
    heading: "We couldn't load this role.",
    body: 'Please try again. If the problem continues, return to Careers.',
    primary: 'Try Again',
    secondary: 'Back to Careers',
  }, // s106
};

/** s94-s95 — patterns populated from real runtime Job data only. */
export const jobDetailTitle = (jobTitle) => `${jobTitle} | Careers at Valida`;
export const jobDetailDescription = (jobTitle) =>
  `View the ${jobTitle} opportunity at Valida, including role details, location, work arrangement, requirements, and application information.`;
