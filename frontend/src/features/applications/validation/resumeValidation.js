/**
 * Resume selection checks.
 *
 * BOUNDARY (A5 security rule, Doc 13). The browser may check that a file was
 * chosen, that its extension matches the Job's configured list, and that its
 * size is within the configured limit. It may NOT claim the file is malware
 * clean, structurally valid PDF/DOCX, content-verified, or safely stored.
 * Those are backend responsibilities and no wording here implies otherwise.
 *
 * Every constraint comes from the Job's applicationForm.resume configuration.
 * Nothing is hard-coded, so the UI text and the checks cannot drift from the
 * backend contract (Doc 06 section 121).
 */

/** Human-readable size for display only. */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/** Lowercased extension including the dot, or null. */
export function getFileExtension(fileName) {
  if (typeof fileName !== 'string') return null;
  const index = fileName.lastIndexOf('.');
  if (index <= 0 || index === fileName.length - 1) return null;
  return fileName.slice(index).toLowerCase();
}

/**
 * Builds the `accept` attribute from configuration.
 *
 * UX ONLY. `accept` filters the OS picker; it is trivially bypassed and is
 * never treated as validation (A5 rule, Doc 13).
 */
export function buildAcceptAttribute(resumeConfig) {
  const extensions = Array.isArray(resumeConfig?.allowedExtensions)
    ? resumeConfig.allowedExtensions.filter((ext) => typeof ext === 'string' && ext.startsWith('.'))
    : [];
  return extensions.length ? extensions.join(',') : undefined;
}

/** Canonical instruction line, built from real configured values (Doc 06 s121). */
export function buildResumeInstruction(resumeConfig) {
  const extensions = Array.isArray(resumeConfig?.allowedExtensions)
    ? resumeConfig.allowedExtensions.filter((ext) => typeof ext === 'string')
    : [];
  const size = formatBytes(resumeConfig?.maxBytes);
  if (!extensions.length && !size) return null;
  const parts = [];
  if (extensions.length) parts.push(`Accepted file types: ${extensions.join(', ')}.`);
  if (size) parts.push(`Maximum size: ${size}.`);
  return parts.join(' ');
}

/**
 * Validates a selected file against the Job's configuration.
 * Returns a canonical message (Doc 06 sections 126-127) or null.
 */
export function validateResumeFile(file, resumeConfig) {
  if (!file) return null;

  const allowed = Array.isArray(resumeConfig?.allowedExtensions)
    ? resumeConfig.allowedExtensions.map((ext) => String(ext).toLowerCase())
    : [];
  const extension = getFileExtension(file.name);

  if (allowed.length && (!extension || !allowed.includes(extension))) {
    return "This file type isn't accepted. Choose a supported resume file.";
  }

  const maxBytes = resumeConfig?.maxBytes;
  if (typeof maxBytes === 'number' && Number.isFinite(maxBytes) && file.size > maxBytes) {
    return 'This file is larger than the allowed limit. Choose a smaller file.';
  }

  // An empty file is a selection mistake, reported with the same neutral
  // processing message rather than anything implying a security verdict.
  if (file.size === 0) {
    return "We couldn't process this file. Remove it and try another file.";
  }

  return null;
}
