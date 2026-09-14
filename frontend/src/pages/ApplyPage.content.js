/** Canonical Apply copy — Doc 06 sections 109-153. Verbatim. */
export const APPLY = {
  backLink: 'Back to Role', // s110
  eyebrow: 'APPLICATION', // s111
  intro:
    'Submit the information requested below to apply for this position. Review your details before sending your application.', // s113
  jobContextLabel: "You're applying for", // s114
  yourInformation: {
    heading: 'Your Information',
    body: 'Tell us how we can identify and contact you about this application.',
  }, // s115
  fullName: { label: 'Full Name', required: 'Required', autoComplete: 'name' }, // s116
  email: {
    label: 'Email Address',
    helper: 'Use an address you can access for recruitment communication.',
  }, // s117
  phone: {
    label: 'Phone Number',
    helper: 'Include your country or area code where applicable.',
  }, // s118
  resume: {
    heading: 'Resume',
    intro: 'Upload the resume you want us to review with this application.',
    label: 'Upload Resume',
    choose: 'Choose File',
    replace: 'Replace File',
    remove: 'Remove',
    validating: 'Checking file…',
    valid: 'Resume ready to submit.',
  }, // s119-s125
  message: {
    heading: 'Additional Information',
    label: 'Message',
    helper: 'Add any information you would like us to consider with your application.',
  }, // s129
  screening: {
    heading: 'Role Questions',
    intro: 'Please answer the following questions about this opportunity.',
  }, // s130
  privacy: {
    body:
      'By submitting this application, you are providing personal information to Valida for recruitment-related purposes. Please review our Privacy Notice for information about how applicant data is handled.',
    linkLabel: 'Privacy Notice',
  }, // s131
  submit: 'Submit Application', // s132
  submitting: 'Submitting…', // s133
  submittingStatus: 'Your application is being submitted.', // s133
  validationSummary: {
    heading: 'Review the highlighted fields.',
    body:
      'Some information is missing or needs to be corrected before you can submit your application.',
  }, // s141
  unavailable: {
    heading: "This application isn't available.",
    body: 'We couldn’t find a published role for this application.',
    cta: 'View Open Roles',
  }, // s142-s143
  closedDuringApplication: {
    heading: 'Applications for this role have closed.',
    body:
      'This position stopped accepting applications before your submission could be completed. Your application was not submitted.',
    cta: 'View Open Roles',
  }, // s144
  failure: {
    heading: "Your application wasn't submitted.",
    body:
      'We couldn’t complete your submission. Your application has not been confirmed. Please check your connection and try again.',
    cta: 'Try Again',
  }, // s145
  rateLimited: 'Too many attempts were received in a short period. Please wait and try again.', // s147
  success: {
    eyebrow: 'APPLICATION RECEIVED', // s148
    heading: 'Thank you for applying.', // s149
    bodySuffix:
      'If we need additional information or decide to continue the process with you, we will use the contact details included in your application.', // s150
    primary: 'Back to Careers', // s151
    secondary: 'Go to Home', // s152
  },
  loadingStatus: 'Loading role details…',
};

/** s109 / s112 / s110 — populated from real runtime Job data only. */
export const applyTitle = (jobTitle) => `Apply for ${jobTitle} | Valida`;
export const applyHeading = (jobTitle) => `Apply for ${jobTitle}`;
export const backToRoleLabel = (jobTitle) => `Back to ${jobTitle}`;
export const successBody = (jobTitle) => `Your application for ${jobTitle} has been received.`;
