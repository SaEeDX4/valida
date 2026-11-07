// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCompensation, formatWeeklyHours } from '../features/jobs/utils/formatJob.js';
import { buildRobotsTxt, buildSitemapXml, SITEMAP_STATIC_PATHS } from './discovery.js';
import { ROBOTS, describeHead, renderHeadTags, serializeJsonLd } from './head.js';
import { EMPLOYMENT_TYPE_MAP, JOB_POSTING_WITHHELD, buildJobPosting, jobPostingDescription } from './jobPosting.js';
import { APPLY_PENDING_HEAD, NOT_FOUND_HEAD, STATIC_HEADS, applyHead, jobDetailHead } from './routeHeads.js';
import { normalizeSiteUrl, resolveSeoConfig, seoBuildProblems } from './siteConfig.js';

/**
 * C4 — the shared SEO core (src/seo), tested without a browser.
 *
 * SYNTHETIC DATA ONLY. `qaJob` is a test vacancy; "cybervalida.com" is the
 * intended domain named in the C4 brief, used here as a test value — the
 * apex/www choice (Doc 14 section 23) is still the owner's.
 */

const SITE = 'https://cybervalida.com';
const INDEXED = resolveSeoConfig({ siteUrl: SITE, allowIndexing: 'true' });
const REVIEW = resolveSeoConfig({ siteUrl: SITE });

const qaJob = (overrides = {}) => ({
  title: 'QA Synthetic Security Analyst (C4)',
  slug: 'qa-c4-synthetic-analyst',
  location: 'QA Region, Canada',
  workArrangement: 'FULLY_REMOTE',
  employmentType: 'PART_TIME',
  schedule: 'QA schedule',
  weeklyHours: 30,
  compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
  description: 'QA TEST DATA description.',
  responsibilities: ['QA responsibility one.', 'QA responsibility two.'],
  requirements: ['QA requirement one.'],
  preferredQualifications: [],
  publishedAt: '2026-11-01T09:30:00.000Z',
  closesAt: '2026-12-01T00:00:00.000Z',
  applicationStatus: 'OPEN',
  applicationForm: { resume: {} },
  ...overrides,
});

describe('site configuration (Doc 16 sections 89-93, Doc 14 section 23)', () => {
  it('accepts only an https origin with nothing after it, lowercasing the host', () => {
    expect(normalizeSiteUrl('https://CyberValida.com/')).toEqual({ ok: true, origin: SITE });
    expect(normalizeSiteUrl(' https://www.cybervalida.com ')).toEqual({ ok: true, origin: 'https://www.cybervalida.com' });
  });

  it.each([
    ['', 'SITE_URL_MISSING'],
    [undefined, 'SITE_URL_MISSING'],
    ['cybervalida.com', 'SITE_URL_INVALID'],
    ['http://cybervalida.com', 'SITE_URL_NOT_HTTPS'],
    ['https://user:pw@cybervalida.com', 'SITE_URL_HAS_CREDENTIALS'],
    ['https://cybervalida.com:8443', 'SITE_URL_HAS_PORT'],
    ['https://cybervalida.com/careers', 'SITE_URL_HAS_PATH'],
    ['https://cybervalida.com/?utm=x', 'SITE_URL_HAS_PATH'],
    ['https://cybervalida.com/#top', 'SITE_URL_HAS_PATH'],
    ['https://localhost', 'SITE_URL_INVALID'],
  ])('refuses %j (%s)', (value, reason) => {
    expect(normalizeSiteUrl(value)).toEqual({ ok: false, reason });
  });

  it('is a review build unless VITE_ALLOW_INDEXING is exactly "true"', () => {
    for (const flag of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      expect(resolveSeoConfig({ siteUrl: SITE, allowIndexing: flag }).indexing, String(flag)).toBe(false);
    }
    expect(INDEXED.indexing).toBe(true);
  });

  it('the build refuses an unknown flag and an indexable build without a valid origin', () => {
    expect(seoBuildProblems({})).toEqual([]);
    expect(seoBuildProblems({ allowIndexing: 'false' })).toEqual([]);
    expect(seoBuildProblems({ siteUrl: SITE, allowIndexing: 'true' })).toEqual([]);
    expect(seoBuildProblems({ allowIndexing: 'yes' })).toHaveLength(1);
    expect(seoBuildProblems({ allowIndexing: 'true' })[0]).toMatch(/SITE_URL_MISSING/);
    expect(seoBuildProblems({ siteUrl: 'http://cybervalida.com', allowIndexing: 'true' })[0]).toMatch(/SITE_URL_NOT_HTTPS/);
  });
});

describe('describeHead — one head for browser and server', () => {
  it('an indexable static page: Document 06 copy, self-canonical, Open Graph, no robots, no JobPosting', () => {
    const head = describeHead(STATIC_HEADS.ABOUT, INDEXED);
    expect(head).toEqual({
      title: STATIC_HEADS.ABOUT.title,
      description: STATIC_HEADS.ABOUT.description,
      robots: null,
      canonical: `${SITE}/about`,
      openGraph: [
        ['og:type', 'website'],
        ['og:site_name', 'Valida'],
        ['og:title', STATIC_HEADS.ABOUT.title],
        ['og:description', STATIC_HEADS.ABOUT.description],
        ['og:url', `${SITE}/about`],
      ],
      jsonLd: null,
    });
    expect(describeHead(STATIC_HEADS.HOME, INDEXED).canonical).toBe(`${SITE}/`);
  });

  it('never emits og:image: no approved social card exists (Doc 16 section 95)', () => {
    const properties = describeHead(STATIC_HEADS.HOME, INDEXED).openGraph.map(([property]) => property);
    expect(properties).not.toContain('og:image');
    expect(properties).not.toContain('og:image:alt');
  });

  it('a review build: every page "noindex, nofollow", and no canonical, Open Graph or JobPosting (SEO-020)', () => {
    for (const input of [STATIC_HEADS.HOME, jobDetailHead(qaJob()), NOT_FOUND_HEAD, applyHead(qaJob())]) {
      const head = describeHead(input, REVIEW);
      expect(head.robots).toBe(ROBOTS.REVIEW);
      expect(head.canonical).toBeNull();
      expect(head.openGraph).toEqual([]);
      expect(head.jsonLd).toBeNull();
    }
  });

  it('a noindex page keeps its own directive and gets no canonical, Open Graph or JobPosting', () => {
    for (const input of [NOT_FOUND_HEAD, APPLY_PENDING_HEAD, applyHead(qaJob()), jobDetailHead(qaJob({ applicationStatus: 'CLOSED', applicationForm: null }))]) {
      const head = describeHead(input, INDEXED);
      expect(head.robots).toBe(ROBOTS.NOINDEX_FOLLOW);
      expect([head.canonical, head.jsonLd]).toEqual([null, null]);
      expect(head.openGraph).toEqual([]);
    }
  });

  it('without a canonical origin: no canonical, no Open Graph, no JobPosting — nothing invented', () => {
    const config = resolveSeoConfig({ allowIndexing: 'true' });
    const head = describeHead(jobDetailHead(qaJob()), config);
    expect(head.robots).toBeNull();
    expect([head.canonical, head.jsonLd]).toEqual([null, null]);
    expect(head.openGraph).toEqual([]);
  });

  it('an open Job Detail: canonical on the Job URL, JobPosting; Apply for the same Job: none', () => {
    const detail = describeHead(jobDetailHead(qaJob()), INDEXED);
    expect(detail.canonical).toBe(`${SITE}/careers/qa-c4-synthetic-analyst`);
    expect(detail.jsonLd['@type']).toBe('JobPosting');
    const apply = describeHead(applyHead(qaJob()), INDEXED);
    expect(apply.title).toBe('Apply for QA Synthetic Security Analyst (C4) | Valida');
    expect(apply.jsonLd).toBeNull();
  });
});

describe('JobPosting (Doc 16 sections 124-141, SEO-025…033)', () => {
  it('maps the visible Job exactly: title, dates, type, organisation, remote area, salary, hours, direct apply', () => {
    const job = qaJob();
    const { jsonLd, withheld } = buildJobPosting(job, { siteOrigin: SITE });
    expect(withheld).toBeNull();
    expect(jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: job.title,
      description: jobPostingDescription(job),
      datePosted: job.publishedAt,
      validThrough: job.closesAt,
      employmentType: 'PART_TIME',
      hiringOrganization: {
        '@type': 'Organization',
        name: 'Valida',
        url: `${SITE}/`,
        logo: `${SITE}/brand/valida-logo-approved-dark-1254.png`,
      },
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: { '@type': 'AdministrativeArea', name: 'QA Region, Canada' },
      baseSalary: { '@type': 'MonetaryAmount', currency: 'CAD', value: { '@type': 'QuantitativeValue', value: 35, unitText: 'HOUR' } },
      workHours: formatWeeklyHours(job.weeklyHours),
      directApply: true,
      url: `${SITE}/careers/qa-c4-synthetic-analyst`,
    });
    // The salary is the one the page shows (formatCompensation is the page's helper).
    expect(formatCompensation(job.compensation)).toBe('CAD 35.00 gross per hour');
  });

  it('the description holds the page sections in page order, with the page headings, HTML-escaped', () => {
    const html = jobPostingDescription(qaJob({ description: 'Uses <b>tags</b> & "quotes"', preferredQualifications: ['QA preferred.'] }));
    expect(html).toBe(
      '<p>About the Role</p><p>Uses &lt;b&gt;tags&lt;/b&gt; &amp; &quot;quotes&quot;</p>' +
        '<p>Responsibilities</p><ul><li>QA responsibility one.</li><li>QA responsibility two.</li></ul>' +
        '<p>Requirements</p><ul><li>QA requirement one.</li></ul>' +
        '<p>Preferred Qualifications</p><ul><li>QA preferred.</li></ul>',
    );
    // An empty section is absent here exactly as it is absent on the page.
    expect(jobPostingDescription(qaJob())).not.toContain('Preferred Qualifications');
  });

  it('no closesAt: no validThrough is invented (SEO-029)', () => {
    const { jsonLd } = buildJobPosting(qaJob({ closesAt: null }), { siteOrigin: SITE });
    expect(jsonLd).not.toHaveProperty('validThrough');
  });

  it.each([
    ['CLOSED', { applicationStatus: 'CLOSED', applicationForm: null }, JOB_POSTING_WITHHELD.NOT_OPEN],
    ['hybrid', { workArrangement: 'HYBRID' }, JOB_POSTING_WITHHELD.NOT_FULLY_REMOTE],
    ['on site', { workArrangement: 'ON_SITE' }, JOB_POSTING_WITHHELD.NOT_FULLY_REMOTE],
    ['regional markets', { hiringMarkets: [{ marketId: 'CA', countries: ['CA'] }] }, JOB_POSTING_WITHHELD.REGIONAL_PRESENTATION],
    ['no publishedAt', { publishedAt: null }, JOB_POSTING_WITHHELD.NO_PUBLISHED_AT],
    ['unparseable publishedAt', { publishedAt: 'soon' }, JOB_POSTING_WITHHELD.NO_PUBLISHED_AT],
    ['no location', { location: null }, JOB_POSTING_WITHHELD.NO_LOCATION],
    ['no content', { description: '', responsibilities: [], requirements: [] }, JOB_POSTING_WITHHELD.NO_DESCRIPTION],
  ])('withheld entirely: %s', (_label, overrides, reason) => {
    expect(buildJobPosting(qaJob(overrides), { siteOrigin: SITE })).toEqual({ jsonLd: null, withheld: reason });
  });

  it('withheld without a canonical origin', () => {
    expect(buildJobPosting(qaJob(), {})).toEqual({ jsonLd: null, withheld: JOB_POSTING_WITHHELD.NO_SITE });
  });

  it('employmentType only where Google has an unambiguous value; FIXED_TERM and CONTRACT are left out (SEO-032)', () => {
    expect(EMPLOYMENT_TYPE_MAP).toEqual({ FULL_TIME: 'FULL_TIME', PART_TIME: 'PART_TIME', TEMPORARY: 'TEMPORARY', INTERNSHIP: 'INTERN', OTHER: 'OTHER' });
    for (const type of ['FIXED_TERM', 'CONTRACT', null]) {
      expect(buildJobPosting(qaJob({ employmentType: type }), { siteOrigin: SITE }).jsonLd).not.toHaveProperty('employmentType');
    }
  });

  it('no baseSalary when the page shows no compensation; MONTH and YEAR map to Google units', () => {
    expect(buildJobPosting(qaJob({ compensation: null }), { siteOrigin: SITE }).jsonLd).not.toHaveProperty('baseSalary');
    expect(buildJobPosting(qaJob({ compensation: { currency: 'CAD', amount: 5000, unit: 'MONTH', gross: true } }), { siteOrigin: SITE }).jsonLd.baseSalary.value.unitText).toBe('MONTH');
  });
});

describe('JSON-LD in HTML (Doc 16 section 255)', () => {
  it('cannot close its script element or open a comment, and is still the same JSON', () => {
    const value = { title: '</script><script>alert(1)</script> <!-- & \u2028 \u2029' };
    const text = serializeJsonLd(value);
    expect(text).not.toMatch(/<|>|&|\u2028|\u2029/);
    expect(JSON.parse(text)).toEqual(value);
  });

  it('renderHeadTags writes escaped attributes and one JobPosting script', () => {
    const head = describeHead(jobDetailHead(qaJob({ title: 'QA "quoted" <role>' })), INDEXED);
    const html = renderHeadTags(head);
    expect(html).toContain('content="QA &quot;quoted&quot; &lt;role&gt; | Careers at Valida"');
    expect(html.match(/<script type="application\/ld\+json" data-valida-structured-data="JobPosting">/g)).toHaveLength(1);
    expect(html).not.toContain('<role>');
  });
});

describe('sitemap and robots (Doc 16 sections 103-113)', () => {
  it('lists the five static routes and each open Job once — no Apply, no lastmod', () => {
    const { xml, urls, skipped } = buildSitemapXml({ siteOrigin: SITE, openJobSlugs: ['qa-open-one', 'qa-open-two', 'qa-open-one', 'Not A Slug', '../x'] });
    expect(SITEMAP_STATIC_PATHS).toEqual(['/', '/about', '/careers', '/privacy', '/legal']);
    expect(urls).toEqual([
      `${SITE}/`, `${SITE}/about`, `${SITE}/careers`, `${SITE}/privacy`, `${SITE}/legal`,
      `${SITE}/careers/qa-open-one`, `${SITE}/careers/qa-open-two`,
    ]);
    expect(skipped).toBe(2);
    expect(xml).not.toMatch(/lastmod|\/apply/);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
  });

  it('production robots: Sitemap line, private paths discouraged, nothing public blocked', () => {
    const text = buildRobotsTxt(INDEXED);
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    for (const rule of ['Disallow: /api/', 'Disallow: /admin/', 'Disallow: /employee/', 'Allow: /api/v1/jobs']) expect(text).toContain(rule);
    const disallowed = text.split('\n').filter((line) => line.startsWith('Disallow:')).map((line) => line.slice('Disallow:'.length).trim());
    for (const publicPath of ['/', '/about', '/careers', '/careers/qa-open-one', '/careers/qa-open-one/apply', '/privacy', '/legal', '/assets/index.js', '/brand/favicon.ico']) {
      expect(disallowed.some((rule) => publicPath.startsWith(rule)), publicPath).toBe(false);
    }
  });

  it('review robots: no Sitemap line and no blanket Disallow (the noindex must stay visible)', () => {
    const text = buildRobotsTxt(REVIEW);
    expect(text).not.toMatch(/Sitemap:|Disallow:/);
    expect(text).toContain('Allow: /');
  });
});
