// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildJobDateFacts, formatCompensation, formatEnumLabel, formatJobDate, formatJobDeadline, formatWeeklyHours, parseJobInstant } from '../features/jobs/utils/formatJob.js';
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
import { buildEligibleWorkCountriesFacts } from '../features/jobs/utils/eligibleWorkCountries.js';
import { SELECTABLE_REGIONS } from '../features/jobs/markets.js';
import { CANONICAL_ORIGIN, normalizeSiteUrl, resolveSeoConfig, seoBuildProblems } from './siteConfig.js';
import { SOCIAL_CARD } from './socialCard.js';
import { HOME_META } from '../pages/HomePage.content.js';
import { ABOUT_SECTIONS } from '../pages/AboutPage.content.js';
import { COMPANY_FACTS } from '../pages/LegalPage.content.js';
import { PRIVACY_SECTIONS } from '../pages/PrivacyPage.content.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** OD-2026-11-09-03: the approved alternative text of the revised card, exactly as the owner wrote it. */
const APPROVED_CARD_ALT =
  'Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a technology company focused on cybersecurity, secure technology, and security engineering."';
/** OD-2026-11-09-03: the revised card (revision 2) and the reviewed revision 1, which stays recoverable. */
const CARD_V2_SHA256 = 'c86554a2a7ea2cc020eccdb8d3e5a8171de0518e9eeaefba804197171a8cc2a5';
const CARD_V1_SHA256 = '2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a';
/** Doc 06 section 12, the Home search description: unchanged. */
const DOC06_HOME_DESCRIPTION =
  'Valida is a Lithuanian technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems.';
/** OD-2026-11-09-03: the Home social-sharing description (og:description). */
const APPROVED_HOME_SHARING_DESCRIPTION =
  'Valida is a technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems.';
const repoFile = (relative) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * C4 — the shared SEO core (src/seo), tested without a browser.
 *
 * SYNTHETIC DATA ONLY. `qaJob` is a test vacancy. "https://cybervalida.com" is
 * the approved canonical origin (OD-2026-11-09-01); nothing here is served on it.
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

describe('approved canonical origin (OD-2026-11-09-01)', () => {
  const OTHER_ORIGINS = ['https://www.cybervalida.com', 'https://review.cybervalida.com', 'https://valida.example'];

  it('is the apex https://cybervalida.com', () => {
    expect(CANONICAL_ORIGIN).toBe('https://cybervalida.com');
    expect(SITE).toBe(CANONICAL_ORIGIN);
  });

  it('only the approved origin becomes the site origin; the host check still runs first', () => {
    expect(resolveSeoConfig({ siteUrl: 'https://CyberValida.com/', allowIndexing: 'true' }).siteOrigin).toBe(CANONICAL_ORIGIN);
    for (const origin of OTHER_ORIGINS) {
      expect(resolveSeoConfig({ siteUrl: origin, allowIndexing: 'true' }), origin).toEqual({
        indexing: true,
        siteOrigin: null,
        siteProblem: 'SITE_URL_NOT_CANONICAL',
      });
    }
    // Existing host validation is unchanged and reported as before.
    expect(resolveSeoConfig({ siteUrl: 'http://cybervalida.com' }).siteProblem).toBe('SITE_URL_NOT_HTTPS');
    expect(resolveSeoConfig({ siteUrl: 'https://cybervalida.com:8443' }).siteProblem).toBe('SITE_URL_HAS_PORT');
  });

  it('the indexable build refuses any other origin; a review build is not pinned', () => {
    for (const origin of OTHER_ORIGINS) {
      const problems = seoBuildProblems({ siteUrl: origin, allowIndexing: 'true' });
      expect(problems, origin).toHaveLength(1);
      expect(problems[0]).toMatch(/SITE_URL_NOT_CANONICAL/);
      expect(problems[0]).toContain(CANONICAL_ORIGIN);
      expect(seoBuildProblems({ siteUrl: origin }), origin).toEqual([]);
      expect(seoBuildProblems({ siteUrl: origin, allowIndexing: 'false' }), origin).toEqual([]);
    }
  });

  it('every absolute URL an indexable build generates is on the approved origin', () => {
    const urls = [];
    for (const input of [...Object.values(STATIC_HEADS), jobDetailHead(qaJob())]) {
      const head = describeHead(input, INDEXED);
      urls.push(head.canonical, ...head.openGraph.filter(([property]) => property === 'og:url' || property === 'og:image').map(([, value]) => value));
    }
    const sitemap = buildSitemapXml({ siteOrigin: INDEXED.siteOrigin, openJobSlugs: ['qa-c4-synthetic-analyst'] }).xml;
    urls.push(...[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    urls.push(buildRobotsTxt({ indexing: true, siteOrigin: INDEXED.siteOrigin }).match(/^Sitemap: (.+)$/m)[1]);
    const { properties } = jobPostingProperties(qaJob(), { siteOrigin: INDEXED.siteOrigin });
    urls.push(properties.url, properties.hiringOrganization.url, properties.hiringOrganization.logo);

    expect(urls.length).toBeGreaterThanOrEqual(6 * 3 + 6 + 1 + 3);
    for (const url of urls) {
      expect(typeof url, String(url)).toBe('string');
      expect(new URL(url).origin, url).toBe(CANONICAL_ORIGIN);
    }
  });

  it('a non-approved origin yields no absolute URL at all, never one on that host', () => {
    const wrong = resolveSeoConfig({ siteUrl: 'https://www.cybervalida.com', allowIndexing: 'true' });
    for (const input of [...Object.values(STATIC_HEADS), jobDetailHead(qaJob())]) {
      const head = describeHead(input, wrong);
      expect(head.canonical).toBeNull();
      expect(head.openGraph.some(([property]) => property === 'og:url' || property === 'og:image')).toBe(false);
      expect(JSON.stringify(head)).not.toContain('www.cybervalida.com');
    }
    expect(buildRobotsTxt({ indexing: true, siteOrigin: wrong.siteOrigin })).not.toMatch(/Sitemap:/);
  });
});

describe('page titles are Document 06 (OD-2026-11-09-01 resolves the Doc 16 §§85-86 conflict)', () => {
  // Document 06, verbatim: §11, §54, §77, §155, §170, §94, §109, §179.
  const DOC_06 = [
    [STATIC_HEADS.HOME.title, 'Valida | Cybersecurity & Secure Technology'],
    [STATIC_HEADS.ABOUT.title, 'About Valida | Security-First Technology'],
    [STATIC_HEADS.CAREERS.title, 'Careers at Valida | Open Technology & Cybersecurity Roles'],
    [STATIC_HEADS.PRIVACY.title, 'Privacy Notice | Valida'],
    [STATIC_HEADS.LEGAL.title, 'Legal Information | Valida'],
    [jobDetailHead(qaJob()).title, 'QA Synthetic Security Analyst (C4) | Careers at Valida'],
    [applyHead(qaJob()).title, 'Apply for QA Synthetic Security Analyst (C4) | Valida'],
    [NOT_FOUND_HEAD.title, 'Page Not Found | Valida'],
  ];
  // The superseded Document 16 §85 and §86 strings, for the same pages.
  const DOC_16_SUPERSEDED = [
    'Valida — Secure Systems. Deliberate Engineering.',
    'About Valida | Valida',
    'Careers | Valida',
    'Privacy | Valida',
    'Legal | Valida',
    'QA Synthetic Security Analyst (C4) | Valida Careers',
    'Apply — QA Synthetic Security Analyst (C4) | Valida',
  ];

  it.each(DOC_06)('%s', (actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('no page uses a superseded Doc 16 title string, and og:title repeats the Document 06 title', () => {
    const titles = DOC_06.map(([actual]) => actual);
    for (const superseded of DOC_16_SUPERSEDED) expect(titles).not.toContain(superseded);
    for (const input of Object.values(STATIC_HEADS)) {
      const head = describeHead(input, INDEXED);
      expect(head.openGraph.find(([property]) => property === 'og:title')[1]).toBe(input.title);
    }
  });

  it('every indexable page title is unique (Doc 16 §84, preserved)', () => {
    const indexable = [...Object.values(STATIC_HEADS).map((head) => head.title), jobDetailHead(qaJob()).title];
    expect(new Set(indexable).size).toBe(indexable.length);
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
        ['og:image', `${SITE}/social/valida-social-card-v2-1200x630.png`],
        ['og:image:width', '1200'],
        ['og:image:height', '630'],
        ['og:image:alt', APPROVED_CARD_ALT],
      ],
      jsonLd: null,
    });
    expect(describeHead(STATIC_HEADS.HOME, INDEXED).canonical).toBe(`${SITE}/`);
  });

  it('every page with Open Graph carries the revised social card, absolute on the approved origin (OD-2026-11-09-02/-03)', () => {
    for (const input of [...Object.values(STATIC_HEADS), jobDetailHead(qaJob())]) {
      const og = Object.fromEntries(describeHead(input, INDEXED).openGraph);
      expect(og['og:image'], input.title).toBe(`${CANONICAL_ORIGIN}${SOCIAL_CARD.path}`);
      expect([og['og:image:width'], og['og:image:height']], input.title).toEqual(['1200', '630']);
      expect(og['og:image:alt'], input.title).toBe(APPROVED_CARD_ALT);
    }
    expect(SOCIAL_CARD.alt).toBe(APPROVED_CARD_ALT);
  });

  it('the card at its public path is the revised file: 1200 x 630 PNG, its own SHA-256; revision 1 stays recoverable and is no longer served', () => {
    const bytes = readFileSync(fileURLToPath(new URL(`../../public${SOCIAL_CARD.path}`, import.meta.url)));
    expect(sha256Of(bytes)).toBe(CARD_V2_SHA256);
    expect(SOCIAL_CARD.sha256).toBe(CARD_V2_SHA256);
    // The reviewed source copy in docs/ is the same file; revision 1 is kept there unchanged.
    expect(sha256Of(readFileSync(repoFile('docs/brand/social-card-preview/valida-social-card-v2-1200x630.png')))).toBe(CARD_V2_SHA256);
    expect(sha256Of(readFileSync(repoFile('docs/brand/social-card-preview/valida-social-card-preview-1200x630.png')))).toBe(CARD_V1_SHA256);
    expect(existsSync(fileURLToPath(new URL('../../public/social/valida-social-card-1200x630.png', import.meta.url)))).toBe(false);
    // PNG signature, then the IHDR chunk: width and height as big-endian 32-bit integers.
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([SOCIAL_CARD.width, SOCIAL_CARD.height]);
  });

  it('Home shares the approved social-sharing description; its search description stays Doc 06 section 12 (OD-2026-11-09-03)', () => {
    expect(HOME_META.socialDescription).toBe(APPROVED_HOME_SHARING_DESCRIPTION);
    expect(HOME_META.description).toBe(DOC06_HOME_DESCRIPTION);
    const head = describeHead(STATIC_HEADS.HOME, INDEXED);
    expect(head.description).toBe(DOC06_HOME_DESCRIPTION);
    expect(Object.fromEntries(head.openGraph)['og:description']).toBe(APPROVED_HOME_SHARING_DESCRIPTION);
    const html = renderHeadTags(head);
    expect(html).toContain(`<meta name="description" content="${DOC06_HOME_DESCRIPTION}">`);
    expect(html).toContain(`<meta property="og:description" content="${APPROVED_HOME_SHARING_DESCRIPTION}">`);
  });

  it('the amendment is limited to social sharing: one phrase on Home, every other route shares its own search description', () => {
    expect(APPROVED_HOME_SHARING_DESCRIPTION).toBe(DOC06_HOME_DESCRIPTION.replace('a Lithuanian technology company', 'a technology company'));
    const others = [STATIC_HEADS.ABOUT, STATIC_HEADS.CAREERS, STATIC_HEADS.PRIVACY, STATIC_HEADS.LEGAL, jobDetailHead(qaJob())];
    for (const input of others) {
      expect(input.socialDescription, input.title).toBeUndefined();
      expect(Object.fromEntries(describeHead(input, INDEXED).openGraph)['og:description'], input.title).toBe(input.description);
    }
    for (const input of [...Object.values(STATIC_HEADS), jobDetailHead(qaJob())]) {
      const og = Object.fromEntries(describeHead(input, INDEXED).openGraph);
      expect(og['og:description'], input.title).not.toMatch(/Lithuanian/);
      expect(og['og:image:alt'], input.title).not.toMatch(/Lithuanian/);
    }
  });

  it('the factual Lithuanian references are untouched: About, Privacy and Legal (Valida MB, its registration)', () => {
    expect(ABOUT_SECTIONS[0].paragraphs[0]).toBe('Valida MB is a Lithuanian technology company whose registered activity context includes computer programming, computer consultancy, and other IT services.');
    expect(PRIVACY_SECTIONS[0].paragraphs).toEqual(['Valida MB is a Lithuanian technology company.']);
    expect(COMPANY_FACTS).toContainEqual({ term: 'Company type', value: 'Lithuanian Mažoji bendrija (MB)' });
  });

  it('a socialDescription never reaches a page without Open Graph, and never replaces the search description', () => {
    const noindex = describeHead({ ...STATIC_HEADS.HOME, robots: ROBOTS.NOINDEX_FOLLOW }, INDEXED);
    expect(noindex.openGraph).toEqual([]);
    expect(noindex.description).toBe(DOC06_HOME_DESCRIPTION);
    expect(renderHeadTags(noindex)).not.toContain(APPROVED_HOME_SHARING_DESCRIPTION);
    const review = describeHead(STATIC_HEADS.HOME, REVIEW);
    expect(review.openGraph).toEqual([]);
    expect(renderHeadTags(review)).not.toContain(APPROVED_HOME_SHARING_DESCRIPTION);
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

describe('JobPosting: location (Doc 16 sections 131-132, SEO-030; OD-2026-11-09-02)', () => {
  it('a fully remote open Job without an explicit list is WITHHELD: location, a region or a country code establish nothing', () => {
    expect(buildJobPosting(qaJob(), { siteOrigin: SITE })).toEqual({ jsonLd: null, withheld: JOB_POSTING_WITHHELD.NO_APPLICANT_ELIGIBILITY });
    for (const extra of [{ countryCode: 'CA', regionCode: 'BC' }, { eligibleWorkCountries: [] }, { eligibleWorkCountries: undefined }]) {
      expect(buildJobPosting(qaJob(extra), { siteOrigin: SITE }).withheld, JSON.stringify(extra)).toBe(JOB_POSTING_WITHHELD.NO_APPLICANT_ELIGIBILITY);
    }
    expect(JOB_POSTING_MISSING_INPUT.NO_APPLICANT_ELIGIBILITY).toMatch(/explicit eligible remote-work countries/);
  });

  it('an open, fully remote Job with an explicit list: TELECOMMUTE and exactly those countries, in order, as the visible row names them', () => {
    const job = qaJob({ eligibleWorkCountries: ['NZ', 'DE'] });
    const { jsonLd, withheld } = buildJobPosting(job, { siteOrigin: SITE });
    expect(withheld).toBeNull();
    expect(jsonLd.jobLocationType).toBe('TELECOMMUTE');
    expect(jsonLd.applicantLocationRequirements).toEqual([
      { '@type': 'Country', name: 'New Zealand' },
      { '@type': 'Country', name: 'Germany' },
    ]);
    expect(jsonLd).not.toHaveProperty('jobLocation');
    const row = buildEligibleWorkCountriesFacts(job, JOB_DETAIL.labels);
    expect(row).toEqual([{ label: 'Eligible Remote-Work Countries', value: 'New Zealand, Germany' }]);
    expect(jsonLd.applicantLocationRequirements.map((country) => country.name).join(', ')).toBe(row[0].value);
    // Google: the description states the job is 100% remote — it repeats the two visible rows.
    expect(jsonLd.description.endsWith(
      '<p>Employment Details</p><ul><li>Work Arrangement: Fully remote</li><li>Eligible Remote-Work Countries: New Zealand, Germany</li></ul>',
    )).toBe(true);
    // The rest of the mapping is exactly jobPostingProperties().
    const { properties } = jobPostingProperties(job, { siteOrigin: SITE });
    expect({ ...jsonLd, description: properties.description, jobLocationType: undefined, applicantLocationRequirements: undefined }).toEqual({
      ...properties, jobLocationType: undefined, applicantLocationRequirements: undefined,
    });
    expect(Object.keys(jsonLd).at(-1)).toBe('url');
  });

  it('eligibility is the Job\'s list only: not location, not a hiring market, not the selector', () => {
    // A country code in location and a different selector-region country change nothing.
    const job = qaJob({ eligibleWorkCountries: ['NZ'], location: 'QA Region, Canada', countryCode: 'CA' });
    expect(buildJobPosting(job, { siteOrigin: SITE }).jsonLd.applicantLocationRequirements).toEqual([{ '@type': 'Country', name: 'New Zealand' }]);
    expect(SELECTABLE_REGIONS).toHaveLength(21);
    expect(SELECTABLE_REGIONS).not.toContain('NZ');
    // A Job with regional hiring markets stays withheld even with a list (its location and pay depend on the view).
    expect(buildJobPosting(qaJob({ eligibleWorkCountries: ['NZ'], hiringMarkets: [{ marketId: 'CANADA', countries: ['CA'] }] }), { siteOrigin: SITE }).withheld)
      .toBe(JOB_POSTING_WITHHELD.REGIONAL_PRESENTATION);
  });

  it('a list on a hybrid or on-site Job is never shown or marked up', () => {
    for (const workArrangement of ['HYBRID', 'ON_SITE']) {
      const job = qaJob({ workArrangement, eligibleWorkCountries: ['NZ'] });
      expect(buildJobPosting(job, { siteOrigin: SITE }).withheld, workArrangement).toBe(JOB_POSTING_WITHHELD.NO_STRUCTURED_WORKPLACE);
      expect(buildEligibleWorkCountriesFacts(job, JOB_DETAIL.labels), workArrangement).toEqual([]);
    }
  });

  it('a closed Job with a list: no JobPosting (Doc 16 sections 123, 140)', () => {
    expect(buildJobPosting(qaJob({ eligibleWorkCountries: ['NZ'], applicationStatus: 'CLOSED', applicationForm: null }), { siteOrigin: SITE }).withheld)
      .toBe(JOB_POSTING_WITHHELD.NOT_OPEN);
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
    expect(EMPLOYMENT_TYPE_MAP).toEqual({ FULL_TIME: 'FULL_TIME', PART_TIME: 'PART_TIME', FULL_TIME_OR_PART_TIME: ['FULL_TIME', 'PART_TIME'], TEMPORARY: 'TEMPORARY', INTERNSHIP: 'INTERN', OTHER: 'OTHER' });
    for (const type of ['FIXED_TERM', 'CONTRACT', null]) {
      expect(jobPostingProperties(qaJob({ employmentType: type }), { siteOrigin: SITE }).properties).not.toHaveProperty('employmentType');
    }
  });

  it('a posting offering both arrangements: both Google types, no workHours, the EUR rate as stated', () => {
    const job = qaJob({
      employmentType: 'FULL_TIME_OR_PART_TIME',
      weeklyHours: null,
      compensation: { currency: 'EUR', amount: 30, unit: 'HOUR', gross: true },
    });
    const { properties } = jobPostingProperties(job, { siteOrigin: SITE });
    expect(properties.employmentType).toEqual(['FULL_TIME', 'PART_TIME']);
    expect(properties).not.toHaveProperty('workHours');
    expect(properties.baseSalary).toEqual({ '@type': 'MonetaryAmount', currency: 'EUR', value: { '@type': 'QuantitativeValue', value: 30, unitText: 'HOUR' } });
    expect(formatCompensation(job.compensation)).toBe('EUR 30.00 gross per hour');
    expect(formatEnumLabel(job.employmentType)).toBe('Full time or part time');
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
