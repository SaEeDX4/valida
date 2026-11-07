// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildJobDateFacts, formatCompensation, formatJobDate, formatJobDeadline, formatWeeklyHours, parseJobInstant } from '../features/jobs/utils/formatJob.js';
import { JOB_DETAIL } from '../pages/JobDetailPage.content.js';
import { buildRobotsTxt, buildSitemapXml, SITEMAP_STATIC_PATHS } from './discovery.js';
import { ROBOTS, describeHead, renderHeadTags, serializeJsonLd } from './head.js';
import {
  EMPLOYMENT_TYPE_MAP,
  JOB_POSTING_MISSING_INPUT,
  JOB_POSTING_WITHHELD,
  buildJobPosting,
  jobPostingDescription,
  jobPostingProperties,
} from './jobPosting.js';
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

  it('an open Job Detail: canonical on the Job URL, and NO JobPosting (no approved location input); Apply: none either', () => {
    const detail = describeHead(jobDetailHead(qaJob()), INDEXED);
    expect(detail.canonical).toBe(`${SITE}/careers/qa-c4-synthetic-analyst`);
    expect(detail.robots).toBeNull();
    expect(detail.jsonLd).toBeNull();
    const apply = describeHead(applyHead(qaJob()), INDEXED);
    expect(apply.title).toBe('Apply for QA Synthetic Security Analyst (C4) | Valida');
    expect(apply.jsonLd).toBeNull();
  });
});

describe('JobPosting: location (C4 correction — Doc 16 sections 131-132, SEO-030)', () => {
  it('a fully remote open Job is WITHHELD: job.location is the workplace, not where applicants may be', () => {
    expect(buildJobPosting(qaJob(), { siteOrigin: SITE })).toEqual({ jsonLd: null, withheld: JOB_POSTING_WITHHELD.NO_APPLICANT_ELIGIBILITY });
    // Not even a country code would change that: no Job field states applicant eligibility.
    expect(buildJobPosting(qaJob({ countryCode: 'CA', regionCode: 'BC' }), { siteOrigin: SITE }).withheld).toBe(JOB_POSTING_WITHHELD.NO_APPLICANT_ELIGIBILITY);
    expect(JOB_POSTING_MISSING_INPUT.NO_APPLICANT_ELIGIBILITY).toMatch(/applicant-eligibility statement/);
  });

  it('hybrid and on-site open Jobs are WITHHELD: the public DTO has no structured workplace address', () => {
    for (const workArrangement of ['HYBRID', 'ON_SITE']) {
      expect(buildJobPosting(qaJob({ workArrangement }), { siteOrigin: SITE }).withheld, workArrangement).toBe(JOB_POSTING_WITHHELD.NO_STRUCTURED_WORKPLACE);
    }
  });

  it('no location property is ever produced from the workplace text', () => {
    const { properties } = jobPostingProperties(qaJob(), { siteOrigin: SITE });
    for (const key of ['jobLocationType', 'applicantLocationRequirements', 'jobLocation']) expect(properties).not.toHaveProperty(key);
    expect(JSON.stringify(properties)).not.toContain('QA Region, Canada');
  });

  it.each([
    ['CLOSED', { applicationStatus: 'CLOSED', applicationForm: null }, JOB_POSTING_WITHHELD.NOT_OPEN],
    ['regional markets', { hiringMarkets: [{ marketId: 'CA', countries: ['CA'] }] }, JOB_POSTING_WITHHELD.REGIONAL_PRESENTATION],
    ['no publishedAt', { publishedAt: null }, JOB_POSTING_WITHHELD.NO_PUBLISHED_AT],
    ['unparseable publishedAt', { publishedAt: 'soon' }, JOB_POSTING_WITHHELD.NO_PUBLISHED_AT],
    ['zoneless publishedAt', { publishedAt: '2026-11-01T09:30:00' }, JOB_POSTING_WITHHELD.NO_PUBLISHED_AT],
    ['no content', { description: '', responsibilities: [], requirements: [] }, JOB_POSTING_WITHHELD.NO_DESCRIPTION],
  ])('withheld for its own reason first: %s', (_label, overrides, reason) => {
    expect(buildJobPosting(qaJob(overrides), { siteOrigin: SITE })).toEqual({ jsonLd: null, withheld: reason });
  });

  it('withheld without a canonical origin', () => {
    expect(buildJobPosting(qaJob(), {})).toEqual({ jsonLd: null, withheld: JOB_POSTING_WITHHELD.NO_SITE });
  });
});

describe('JobPosting: the other properties (kept for when the location input is approved)', () => {
  it('map the visible Job exactly: title, dates, type, organisation, salary, hours, direct apply', () => {
    const job = qaJob();
    const { properties, withheld } = jobPostingProperties(job, { siteOrigin: SITE });
    expect(withheld).toBeNull();
    expect(properties).toEqual({
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
      baseSalary: { '@type': 'MonetaryAmount', currency: 'CAD', value: { '@type': 'QuantitativeValue', value: 35, unitText: 'HOUR' } },
      workHours: formatWeeklyHours(job.weeklyHours),
      directApply: true,
      url: `${SITE}/careers/qa-c4-synthetic-analyst`,
    });
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
    expect(jobPostingDescription(qaJob())).not.toContain('Preferred Qualifications');
  });

  it('employmentType only where Google has an unambiguous value; FIXED_TERM and CONTRACT are left out (SEO-032)', () => {
    expect(EMPLOYMENT_TYPE_MAP).toEqual({ FULL_TIME: 'FULL_TIME', PART_TIME: 'PART_TIME', TEMPORARY: 'TEMPORARY', INTERNSHIP: 'INTERN', OTHER: 'OTHER' });
    for (const type of ['FIXED_TERM', 'CONTRACT', null]) {
      expect(jobPostingProperties(qaJob({ employmentType: type }), { siteOrigin: SITE }).properties).not.toHaveProperty('employmentType');
    }
  });

  it('no baseSalary when the page shows no compensation; MONTH and YEAR map to Google units', () => {
    expect(jobPostingProperties(qaJob({ compensation: null }), { siteOrigin: SITE }).properties).not.toHaveProperty('baseSalary');
    expect(jobPostingProperties(qaJob({ compensation: { currency: 'CAD', amount: 5000, unit: 'MONTH', gross: true } }), { siteOrigin: SITE }).properties.baseSalary.value.unitText).toBe('MONTH');
  });
});

describe('Visible dates and structured data (owner decision OD-2026-11-07-01)', () => {
  const WITH_DEADLINE = qaJob({ publishedAt: '2026-11-01T09:30:00.000Z', closesAt: '2027-03-31T23:59:59.000Z' });
  const WITHOUT_DEADLINE = qaJob({ publishedAt: '2026-11-01T09:30:00.000Z', closesAt: null });

  it('the approved labels', () => {
    expect([JOB_DETAIL.labels.datePosted, JOB_DETAIL.labels.applicationsClose]).toEqual(['Date Posted', 'Applications Close']);
  });

  it('a Job WITH a deadline: both rows; datePosted and validThrough carry the same instants', () => {
    expect(buildJobDateFacts(WITH_DEADLINE, JOB_DETAIL.labels)).toEqual([
      { label: 'Date Posted', value: '1 November 2026', dateTime: '2026-11-01T09:30:00.000Z' },
      { label: 'Applications Close', value: '31 March 2027, 23:59 UTC', dateTime: '2027-03-31T23:59:59.000Z' },
    ]);
    const { properties } = jobPostingProperties(WITH_DEADLINE, { siteOrigin: SITE });
    expect([properties.datePosted, properties.validThrough]).toEqual(['2026-11-01T09:30:00.000Z', '2027-03-31T23:59:59.000Z']);
  });

  it('a Job WITHOUT a deadline: no Applications Close row and no validThrough — nothing invented (SEO-029)', () => {
    const facts = buildJobDateFacts(WITHOUT_DEADLINE, JOB_DETAIL.labels);
    expect(facts.map((fact) => fact.label)).toEqual(['Date Posted']);
    expect(jobPostingProperties(WITHOUT_DEADLINE, { siteOrigin: SITE }).properties).not.toHaveProperty('validThrough');
  });

  it.each([
    ['empty', ''],
    ['not a date', 'soon'],
    ['no zone (would be read in local time)', '2027-03-31T23:59:59'],
    ['date only', '2027-03-31'],
    ['impossible day', '2027-02-30T10:00:00.000Z'],
    ['impossible month', '2027-13-01T10:00:00.000Z'],
    ['impossible hour', '2027-03-31T24:00:00.000Z'],
    ['not a string', 1806537599000],
  ])('an invalid closesAt (%s): no row, no validThrough', (_label, closesAt) => {
    const job = qaJob({ closesAt });
    expect(buildJobDateFacts(job, JOB_DETAIL.labels).map((fact) => fact.label)).toEqual(['Date Posted']);
    expect(jobPostingProperties(job, { siteOrigin: SITE }).properties).not.toHaveProperty('validThrough');
  });

  it('dates are shown in UTC whatever the reader\'s timezone, so page and markup always agree', () => {
    const original = process.env.TZ;
    const results = [];
    try {
      for (const tz of ['UTC', 'America/Vancouver', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        process.env.TZ = tz;
        results.push([formatJobDate('2026-11-01T02:00:00.000Z'), formatJobDeadline('2027-03-31T23:59:59.000Z'), formatJobDeadline('2027-01-01T07:00:00+08:00')]);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    // 02:00 UTC is still 31 October in Vancouver: the page says 1 November, the UTC date of the instant.
    for (const row of results) expect(row).toEqual(['1 November 2026', '31 March 2027, 23:59 UTC', '31 December 2026, 23:00 UTC']);
    expect(parseJobInstant('2027-03-31T23:59:59.000Z').toISOString()).toBe('2027-03-31T23:59:59.000Z');
  });
});

describe('JSON-LD in HTML (Doc 16 section 255)', () => {
  it('cannot close its script element or open a comment, and is still the same JSON', () => {
    const value = { title: '</script><script>alert(1)</script> <!-- & \u2028 \u2029' };
    const text = serializeJsonLd(value);
    expect(text).not.toMatch(/<|>|&|\u2028|\u2029/);
    expect(JSON.parse(text)).toEqual(value);
  });

  it('renderHeadTags writes escaped attributes and, when a head has one, one JobPosting script', () => {
    const described = describeHead(jobDetailHead(qaJob({ title: 'QA "quoted" <role>' })), INDEXED);
    expect(renderHeadTags(described)).not.toContain('application/ld+json');
    // The serializer path itself, with a posting supplied directly (none is emitted from real data today).
    const head = { ...described, jsonLd: jobPostingProperties(qaJob({ title: 'QA "quoted" <role>' }), { siteOrigin: SITE }).properties };
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
