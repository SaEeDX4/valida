import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices, httpError, testJob,
} from '../test/renderRoute.jsx';
import { OPEN_ROLES } from '../pages/CareersPage.content.js';
import { JOB_DETAIL } from '../pages/JobDetailPage.content.js';
import { APPLY, applyHeading } from '../pages/ApplyPage.content.js';

/**
 * C5 keyboard continuity: when the activated control is replaced by its outcome, focus lands on the outcome's
 * heading (never <body>), and the next Tab continues from there in reading order.
 */
const SLUG = 'cybersecurity-specialist';

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

const failingThen = (key, value) => {
  let calls = 0;
  installJobsService({
    [key]: async () => {
      calls += 1;
      if (calls === 1) throw httpError(503, 'SERVICE_UNAVAILABLE');
      return value(calls);
    },
  });
};

describe('Careers — Try Again', () => {
  it('lands on the Open Roles heading when the retry succeeds; the next Tab continues into the section', async () => {
    const user = userEvent.setup();
    failingThen('getPublishedJobs', () => ({ items: [testJob()] }));
    renderRoute('/careers');
    const errorBlock = await screen.findByTestId('careers-error');
    within(errorBlock).getByRole('button', { name: OPEN_ROLES.error.retry }).focus();
    await user.keyboard('{Enter}');
    await screen.findByTestId('careers-job-list');
    const heading = screen.getByRole('heading', { level: 2, name: OPEN_ROLES.heading });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute('tabindex')).toBe('-1');
    await user.tab();
    // The next stop after the heading is inside the same section (the regional view selector), not the page top.
    expect(heading.closest('section').contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('lands on the same heading when the retry fails again', async () => {
    const user = userEvent.setup();
    installJobsService({ getPublishedJobs: async () => { throw httpError(503, 'SERVICE_UNAVAILABLE'); } });
    renderRoute('/careers');
    const errorBlock = await screen.findByTestId('careers-error');
    await user.click(within(errorBlock).getByRole('button', { name: OPEN_ROLES.error.retry }));
    await screen.findByTestId('careers-error');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: OPEN_ROLES.heading })));
  });

  it('does not move focus on an initial load', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [testJob()] }) });
    renderRoute('/careers');
    await screen.findByTestId('careers-job-list');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Job Detail — Try Again', () => {
  it('lands on the job title when the retry succeeds', async () => {
    const user = userEvent.setup();
    failingThen('getPublishedJobBySlug', () => ({ job: testJob() }));
    renderRoute(`/careers/${SLUG}`);
    const block = await screen.findByTestId('job-error');
    await user.click(within(block).getByRole('button', { name: JOB_DETAIL.error.primary }));
    const title = await screen.findByRole('heading', { level: 1, name: 'Cybersecurity Specialist' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('lands on the error heading when the retry fails again', async () => {
    const user = userEvent.setup();
    installJobsService({ getPublishedJobBySlug: async () => { throw httpError(503, 'SERVICE_UNAVAILABLE'); } });
    renderRoute(`/careers/${SLUG}`);
    const block = await screen.findByTestId('job-error');
    await user.click(within(block).getByRole('button', { name: JOB_DETAIL.error.primary }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe(JOB_DETAIL.error.heading));
  });

  it('does not move focus on an initial load', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob() }) });
    renderRoute(`/careers/${SLUG}`);
    await screen.findByRole('heading', { level: 1, name: 'Cybersecurity Specialist' });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Apply — outcomes that replace the form', () => {
  const pdf = () => new File(['x'], 'resume.pdf', { type: 'application/pdf' });
  async function submitValidForm(user) {
    await screen.findByRole('heading', { level: 1, name: applyHeading('Cybersecurity Specialist') });
    await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
    await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf());
    screen.getByRole('button', { name: new RegExp(APPLY.submit, 'i') }).focus();
    await user.keyboard('{Enter}');
  }

  it('success: lands on the success heading; the next Tab is Back to Careers', async () => {
    const user = userEvent.setup();
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob() }) });
    installApplicationsService({ submitApplication: async () => ({ data: { status: 'RECEIVED' } }) });
    renderRoute(`/careers/${SLUG}/apply`);
    await submitValidForm(user);
    const success = await screen.findByTestId('apply-success');
    const heading = within(success).getByRole('heading', { level: 1, name: APPLY.success.heading });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await user.tab();
    expect(document.activeElement.textContent.trim()).toBe(APPLY.success.primary);
  });

  it('success: the status message and the focused heading carry different text (no duplicate announcement)', async () => {
    const user = userEvent.setup();
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob() }) });
    installApplicationsService({ submitApplication: async () => ({ data: { status: 'RECEIVED' } }) });
    renderRoute(`/careers/${SLUG}/apply`);
    await submitValidForm(user);
    const success = await screen.findByTestId('apply-success');
    const statuses = within(success).queryAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].contains(document.activeElement)).toBe(false);
    expect(statuses[0].textContent).not.toContain(APPLY.success.heading);
  });

  it('closed during application: lands on its heading', async () => {
    const user = userEvent.setup();
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob() }) });
    installApplicationsService({ submitApplication: async () => { throw httpError(409, 'JOB_NOT_ACCEPTING_APPLICATIONS'); } });
    renderRoute(`/careers/${SLUG}/apply`);
    await submitValidForm(user);
    const block = await screen.findByTestId('apply-closed-during');
    await waitFor(() => expect(document.activeElement).toBe(within(block).getByRole('heading', { level: 1 })));
  });

  it('a failed submission keeps focus on its own button (the form stays)', async () => {
    const user = userEvent.setup();
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob() }) });
    installApplicationsService({ submitApplication: async () => { throw httpError(503, 'SERVICE_UNAVAILABLE'); } });
    renderRoute(`/careers/${SLUG}/apply`);
    await submitValidForm(user);
    const retry = await screen.findByRole('button', { name: new RegExp(APPLY.failure.cta, 'i') });
    expect(document.activeElement).toBe(retry);
  });

  it('job load Try Again: lands on the form heading when the retry succeeds', async () => {
    const user = userEvent.setup();
    failingThen('getPublishedJobBySlug', () => ({ job: testJob() }));
    renderRoute(`/careers/${SLUG}/apply`);
    await user.click(await screen.findByRole('button', { name: JOB_DETAIL.error.primary }));
    const heading = await screen.findByRole('heading', { level: 1, name: applyHeading('Cybersecurity Specialist') });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
