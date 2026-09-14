/**
 * Builds the multipart payload for one application (Doc 09 section 82).
 *
 * Only the supported logical fields are sent. No client-supplied Job ID,
 * application status, timestamp, notification status or storage key is
 * included — Job association comes from the :jobSlug route segment alone.
 *
 * Conditional fields are appended only when the Job's own configuration
 * enables them, so a disabled field is never transmitted.
 *
 * Content-Type is intentionally not set anywhere in this path: the browser
 * must generate the multipart boundary itself.
 */
export default function buildApplicationFormData({ values, applicationForm, resumeFile }) {
  const form = applicationForm ?? {};
  const formData = new FormData();

  formData.append('fullName', (values.fullName ?? '').trim());
  formData.append('email', (values.email ?? '').trim());

  if (form.phone?.enabled) {
    const phone = (values.phone ?? '').trim();
    if (phone) formData.append('phone', phone);
  }

  if (form.message?.enabled) {
    // Line breaks the candidate typed are preserved exactly; only surrounding
    // whitespace is trimmed.
    const message = (values.message ?? '').trim();
    if (message) formData.append('message', message);
  }

  const questions = Array.isArray(form.screeningQuestions) ? form.screeningQuestions : [];
  if (questions.length) {
    const answers = questions
      .map((question) => {
        const raw = values.screeningAnswers?.[question.id];

        // YES_NO travels as a JSON boolean, not as the on-screen label.
        if (question.type === 'YES_NO') {
          return typeof raw === 'boolean' ? { questionId: question.id, answer: raw } : null;
        }

        const answer = typeof raw === 'string' ? raw.trim() : '';
        return answer === '' ? null : { questionId: question.id, answer };
      })
      .filter(Boolean);
    if (answers.length) formData.append('screeningAnswers', JSON.stringify(answers));
  }

  if (resumeFile) formData.append('resume', resumeFile, resumeFile.name);

  return formData;
}
