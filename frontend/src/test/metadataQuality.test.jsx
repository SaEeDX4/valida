import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  httpError,
  installJobsService,
  networkError,
  pending,
  renderRoute,
  resetServices,
  testJob,
} from "./renderRoute.jsx";

/**
 * A6 metadata and SEO baseline (Doc 16 SEO scope, Doc 08 sections 126-132).
 *
 * Deliberately NOT production SEO infrastructure: no sitemap, no robots.txt, no
 * canonical host, no JobPosting structured data. Those need the production
 * domain and a real backend (Release C). This suite only proves the frontend
 * sets truthful, non-duplicated metadata per route and keeps non-content
 * routes out of the index.
 */

const robots = () =>
  document.querySelector('meta[name="robots"]')?.getAttribute("content") ??
  null;

const descriptions = () => [
  ...document.querySelectorAll('meta[name="description"]'),
];

function resetDocumentMetadata() {
  document
    .querySelectorAll('meta[name="robots"], meta[name="description"]')
    .forEach((element) => element.remove());

  document.title = "";
}

async function waitForTitle(expectedTitle) {
  await waitFor(() => {
    expect(document.title).toBe(expectedTitle);
  });
}

async function waitForRobots(expectedValue) {
  await waitFor(() => {
    expect(robots()).toBe(expectedValue);
  });
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  resetDocumentMetadata();
});

afterEach(() => {
  cleanup();
  resetServices();
  resetDocumentMetadata();
});

/** Indexable content routes, each with its canonical Document 06 title. */
const INDEXABLE = [
  ["/", "Valida | Cybersecurity & Secure Technology"],
  ["/about", "About Valida | Security-First Technology"],
  ["/careers", "Careers at Valida | Open Technology & Cybersecurity Roles"],
  ["/privacy", "Privacy Notice | Valida"],
  ["/legal", "Legal Information | Valida"],
];

describe("A6 — titles and descriptions", () => {
  it.each(INDEXABLE)(
    "%s sets its canonical title",
    async (path, expectedTitle) => {
      installJobsService({
        getPublishedJobs: pending,
        getPublishedJobBySlug: pending,
      });

      renderRoute(path);

      await waitForTitle(expectedTitle);
    },
  );

  it("gives every indexable route a distinct title", async () => {
    const seen = new Set();

    for (const [path, expectedTitle] of INDEXABLE) {
      installJobsService({
        getPublishedJobs: pending,
        getPublishedJobBySlug: pending,
      });

      const view = renderRoute(path);

      await waitForTitle(expectedTitle);

      expect(
        seen.has(document.title),
        `duplicate title "${document.title}"`,
      ).toBe(false);

      seen.add(document.title);

      view.unmount();
      resetServices();
      resetDocumentMetadata();
    }
  });

  it.each(INDEXABLE)(
    "%s publishes exactly one description, and it is not empty",
    async (path, expectedTitle) => {
      installJobsService({
        getPublishedJobs: pending,
        getPublishedJobBySlug: pending,
      });

      renderRoute(path);

      await waitForTitle(expectedTitle);

      expect(descriptions()).toHaveLength(1);

      expect(
        descriptions()[0].getAttribute("content").trim().length,
      ).toBeGreaterThan(40);
    },
  );

  it.each(INDEXABLE)(
    "%s is indexable — no robots directive",
    async (path, expectedTitle) => {
      installJobsService({
        getPublishedJobs: pending,
        getPublishedJobBySlug: pending,
      });

      renderRoute(path);

      await waitForTitle(expectedTitle);

      expect(robots()).toBeNull();
    },
  );
});

describe("A6 — non-content routes stay out of the index", () => {
  it("marks the application-level 404 noindex, follow", async () => {
    renderRoute("/this-route-does-not-exist");

    await waitForTitle("Page Not Found | Valida");
    await waitForRobots("noindex, follow");
  });

  it("marks a deep unknown route noindex, follow", async () => {
    renderRoute("/careers/x/apply/extra/segments");

    await waitForTitle("Page Not Found | Valida");
    await waitForRobots("noindex, follow");
  });

  it("marks the Job Detail unavailable state noindex, follow", async () => {
    installJobsService({
      getPublishedJobBySlug: async () => {
        throw httpError(404, "JOB_NOT_FOUND");
      },
    });

    renderRoute("/careers/nope");

    await screen.findByTestId("job-unavailable");
    await waitForRobots("noindex, follow");
  });

  it("marks a retained closed role noindex, follow", async () => {
    installJobsService({
      getPublishedJobBySlug: async () => ({
        job: testJob({
          applicationStatus: "CLOSED",
          applicationForm: null,
        }),
      }),
    });

    renderRoute("/careers/cybersecurity-specialist");

    await screen.findByTestId("job-closed-banner");
    await waitForRobots("noindex, follow");
  });

  it.each([
    ["loading", pending],
    ["loaded", async () => ({ job: testJob() })],
    [
      "load failure",
      async () => {
        throw networkError();
      },
    ],
  ])("marks Apply noindex, follow while %s", async (_label, loader) => {
    installJobsService({
      getPublishedJobBySlug: loader,
    });

    renderRoute("/careers/cybersecurity-specialist/apply");

    await waitForRobots("noindex, follow");
  });

  it("leaves no stale noindex when returning to an indexable route", async () => {
    const notFound = renderRoute("/nope");

    await waitForTitle("Page Not Found | Valida");
    await waitForRobots("noindex, follow");

    notFound.unmount();

    renderRoute("/about");

    await waitForTitle("About Valida | Security-First Technology");

    await waitFor(() => {
      expect(robots()).toBeNull();
    });
  });
});

describe("A6 — no fabricated SEO signals", () => {
  it.each([...INDEXABLE, ["/nope", "Page Not Found | Valida"]])(
    "%s emits no structured data",
    async (path, expectedTitle) => {
      installJobsService({
        getPublishedJobs: pending,
        getPublishedJobBySlug: pending,
      });

      const { container } = renderRoute(path);

      await waitForTitle(expectedTitle);

      expect(
        document.querySelectorAll('script[type="application/ld+json"]'),
      ).toHaveLength(0);

      expect(container.innerHTML).not.toMatch(/JobPosting|schema\.org/);
    },
  );

  it("publishes no canonical URL while no production hostname exists", async () => {
    renderRoute("/");

    await waitForTitle("Valida | Cybersecurity & Secure Technology");

    // A canonical tag needs the real domain (AWAITING INPUT); a fabricated one
    // would point crawlers at a host that does not resolve.
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();

    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
  });
});
