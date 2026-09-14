import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../routes/AppRouter.jsx';
import { setServiceOverride, clearServiceOverrides, SERVICE } from '../services/serviceRegistry.js';
import { ApiError, API_ERROR_TYPE } from '../services/api/apiClient.js';

/**
 * Test helpers for A5 route rendering.
 *
 * Services are injected through the same registry seam the dev fixtures use,
 * so tests exercise the real page components and the real state machine — not
 * a parallel test-only rendering path.
 */
export function renderRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

export function installJobsService(implementation) {
  setServiceOverride(SERVICE.JOBS, implementation);
}

export function installApplicationsService(implementation) {
  setServiceOverride(SERVICE.APPLICATIONS, implementation);
}

export function resetServices() {
  clearServiceOverrides();
}

export const httpError = (status, code, extra = {}) =>
  new ApiError({ type: API_ERROR_TYPE.HTTP, status, code, message: 'Test error.', ...extra });

export const networkError = () =>
  new ApiError({ type: API_ERROR_TYPE.NETWORK, message: 'The request could not be completed.' });

/** Never resolves — used to hold a page in its loading state. */
export const pending = () => new Promise(() => {});

/**
 * Synthetic Job used by tests only.
 *
 * Clearly fixture content. It is never imported by production code and never
 * presented as approved Valida Job data.
 */
export const testJob = (overrides = {}) => ({
  title: 'Cybersecurity Specialist',
  slug: 'cybersecurity-specialist',
  location: 'British Columbia, Canada',
  workArrangement: 'FULLY_REMOTE',
  employmentType: 'PART_TIME',
  weeklyHours: 30,
  compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
  description: 'Test fixture description.',
  responsibilities: ['Test fixture responsibility.'],
  requirements: ['Test fixture requirement.'],
  preferredQualifications: [],
  publishedAt: '2026-09-10T18:00:00.000Z',
  closesAt: null,
  applicationStatus: 'OPEN',
  applicationForm: {
    phone: { enabled: false, required: false },
    message: { enabled: false, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions: [],
  },
  ...overrides,
});
