# C4 — SEO production integration (implementation record)

| | |
| --- | --- |
| Milestone | Release C — C4 SEO / Privacy / Legal Production Integration (Doc 18 §§163–167) |
| Governing | Doc 16 §§77–152, 255, 262 (SEO-001…040), 266 (gate); Doc 17 §§214, 258–273; Doc 04 §§47–49; Doc 06 SEO copy; Doc 12 §§6–10, 33; Doc 14 §23; Doc 15 §§63–67 |
| Status | Implemented and verified **locally**. Not accepted; not deployed. Production checks are C6 (§6) |

## 1. Mechanism

Doc 16 §§98–102 require the title, description, canonical URL, social metadata and structured data of indexable routes to reach crawlers that do not run JavaScript, without leaving React + Vite. C4 uses **controlled server HTML transformation**, one of the mechanisms §100 lists:

- **`frontend/src/seo/`** holds one pure-JavaScript description of every route's `<head>`. Every title and description is the existing Document 06 copy.
- **In the browser**, `PageMeta` reconciles the head from that description for the route that is mounted.
- **On the server**, `frontend/server/` writes the same description into the built `index.html` before sending it, with the route's real HTTP status.

Because both sides use the same function on the same inputs, a direct load, a refresh and a client navigation all settle on the same metadata.

`frontend/server/` is the **host-independent reference implementation**, not a hosting decision. Doc 16 §101 and Doc 15 §63 choose the production mechanism at C6: managed static/CDN hosting is preferred. At C6 this server is either deployed as it is, or the same `src/seo` modules run in the chosen host's edge or HTML-transformation step. The production checks in §6 are then run there.

## 2. Configuration

| Variable (frontend build) | Meaning | Default |
| --- | --- | --- |
| `VITE_PUBLIC_SITE_URL` | The one canonical origin. It must be `https://<host>` with no path, port, query or credentials (Doc 14 §23, Doc 16 §§89–91). Without a valid value, no canonical URL, `og:url`, sitemap or JobPosting is emitted. | empty |
| `VITE_ALLOW_INDEXING` | `true` only for the production build. When unset or `false`, the build is a **review build**: every response is `noindex, nofollow` in both the meta tag and `X-Robots-Tag`; there is no sitemap and no canonical, Open Graph or JobPosting tags (Doc 16 §82, SEO-020). | `false` |

`vite build` refuses two configurations: any `VITE_ALLOW_INDEXING` value other than `true`/`false`, and `true` without a valid `VITE_PUBLIC_SITE_URL`.

The build also writes `dist/valida-seo.json`. It holds the canonical origin, the indexing flag and the API origin, all of which are already public in the bundle. The document server takes its configuration only from this file, so it cannot be configured differently from the bundle it serves.

Local testing uses `https://cybervalida.com` as a **test value**. The production value depends on the apex/www decision (§7).

## 3. Routes, statuses and heads

| Route | Status | Robots | Canonical / Open Graph | JobPosting |
| --- | --- | --- | --- | --- |
| `/`, `/about`, `/careers`, `/privacy`, `/legal` | 200 | none | yes | no |
| `/careers/:slug` — OPEN | 200 | none | yes | yes, when it can be stated truthfully (§4) |
| `/careers/:slug` — retained CLOSED | 200 | `noindex, follow` | no | no |
| `/careers/:slug` — unknown, Draft, Archived or invalid slug | 404 (branded page) | `noindex, follow` | no | no |
| `/careers/:slug` — Jobs API failure or malformed data | 503 + `Retry-After` | `noindex, follow` | no | no |
| `/careers/:slug/apply` — OPEN or CLOSED | 200 | `noindex, follow` | no | no |
| `/careers/:slug/apply` — unknown | 404 | `noindex, follow` | no | no |
| any other path, including `/admin`, `/employee` | 404 (branded page) | `noindex, follow` | no | no |
| `/sitemap.xml` | 200 (503 if the Jobs API fails; 404 in a review build) | — | — | — |
| `/robots.txt` | 200 | — | — | — |

Other rules:

- **Redirects.** A non-canonical spelling (a trailing slash, uppercase, or a doubled slash) is answered with a same-origin 301 to the canonical path, keeping the query (Doc 04 §§47–49).
- **Canonical URLs.** A canonical never includes the query string, such as `?region=` or tracking parameters (Doc 16 §93, SEO-039).
- **Canonical and noindex.** A page that is not indexable carries no canonical URL. A noindex page with a canonical would send mixed signals.
- **Open Graph tags.** `og:type`, `og:site_name`, `og:title`, `og:description` and `og:url` are emitted. **`og:image` and `og:image:alt` are not emitted**, because no approved social card exists (Doc 16 §95; decision D-3).

**Sitemap** (Doc 16 §§103–109). The five static routes are listed, then every OPEN Job from `GET /api/v1/jobs`, page by page. The sitemap is built per request, so publishing, closing or archiving a Job changes it at once (SEO-012).
- Excluded: Apply, 404, Draft, Archived and Closed Jobs, the API and review URLs.
- No `<lastmod>`: the public API exposes no content-modification time (SEO-013).

**robots.txt** (Doc 16 §§110–113).
- Nothing public is disallowed: no page, CSS, JavaScript or image.
- `/admin/`, `/employee/` and `/api/` are discouraged, except `/api/v1/jobs`, which the browser needs in order to render Careers and Job Detail.
- The file ends with the Sitemap line.
- A review build has no Sitemap line and no blanket `Disallow: /`, because a crawler only sees a `noindex` on a page it is allowed to fetch.

## 4. JobPosting

The JobPosting is built from the **same public Job DTO and the same formatting helpers** the Job Detail page renders (`src/seo/jobPosting.js`). The rules were checked against Google's current JobPosting documentation during C4, in particular: "all information in the markup must be visible on the job page"; one job per page; remove the markup when the job closes.

| Property | Source |
| --- | --- |
| `title` | `job.title`, which is the H1 |
| `description` | The page's sections in page order, with the page's headings, as `<p>`/`<ul>`/`<li>`, HTML-escaped |
| `datePosted` | `job.publishedAt` (Doc 16 §128) |
| `validThrough` | `job.closesAt`, **only if set**; nothing is invented (§§129–130) |
| `employmentType` | FULL_TIME, PART_TIME, TEMPORARY, INTERNSHIP→INTERN, OTHER. **FIXED_TERM and CONTRACT are omitted**: Google has no unambiguous equivalent (SEO-032; D-6) |
| `hiringOrganization` | `{ name: "Valida", url, logo }`. The logo is the approved master `brand/valida-logo-approved-dark-1254.png` (1:1, inside Google's ratio limits). No `sameAs` (SEO-037) |
| `jobLocationType`, `applicantLocationRequirements` | `TELECOMMUTE` and `{ "@type": "AdministrativeArea", "name": <the visible location> }` (§§131–132; D-5) |
| `baseSalary` | The visible compensation: currency, amount and `unitText` HOUR, MONTH or YEAR (§§134–135) |
| `workHours` | The visible weekly hours |
| `directApply` | `true`. The flow is one "Apply for This Role" action to one form on the same site, with no account, login or redirect (§136; the C3 E2E) |
| `url` | The canonical Job URL |

**Withheld entirely** in these cases:
- **Closed Job.** Doc 16 §§123 and 140.
- **Hybrid or on-site Job.** Google needs a structured postal address, and the public DTO carries the location as display text only.
- **Job with regional hiring markets.** The visible location and pay then depend on the visitor's region. The public API sends none; only QA data does.
- **Required property missing.**

The JSON-LD is serialised with `<`, `>`, `&`, U+2028 and U+2029 escaped, so a Job's text cannot end the script element. The element is `<script type="application/ld+json">`, a data block that is never executed. The C6 Content-Security-Policy must still allow it (Doc 16 §255).

## 5. Verification (local)

| Check | Where |
| --- | --- |
| Unit and component tests | `frontend/src/seo/seo.test.js`, `frontend/src/components/seo/PageMeta.c4.test.jsx` |
| Document server over HTTP, against a stand-in API | `frontend/server/documentServer.test.js` |
| Real stack: the document server, the real backend, a disposable MongoDB, synthetic Jobs, Chromium | `e2e/` → `npm run test:e2e:seo` (cases C4-01…C4-11; see `e2e/README.md`) |

## 6. Deferred to the production host (C6) — not claimed

- The real HTTPS host and certificate.
- The apex/www redirect (Doc 14 §23, Doc 15 §115).
- Compression (PERF-031).
- CDN and caching behaviour on the chosen host.
- The frontend Content-Security-Policy, with the JSON-LD data block allowed.
- The selected rendering mechanism on that host, with statuses and initial-HTML heads re-checked there.
- Social preview cards rendered by real platforms (Doc 16 §266).
- External validation of the JobPosting with current tooling such as the Rich Results Test, before recruitment launch (SEO-034, Doc 16 §§137–138).
- Search Console (§§148–149).
- Rate-limit headroom for the server's own Jobs API reads. The document server reads the public API once per Job page view; behind a shared egress address those reads count against the API's general rate limit.

## 7. Open owner decisions

See the C4 handoff for the full list. In short:

| ID | Decision | What it unlocks |
| --- | --- | --- |
| D-1 | Apex or www as the canonical host | The production `VITE_PUBLIC_SITE_URL`; SEO-005 |
| D-2 | The Doc 06 / Doc 16 §85 title-pattern conflict (C4 keeps Doc 06) | Closes the conflict under Doc 00 |
| D-3 | An approved 1200×630 social card and its alt text | `og:image` and `og:image:alt`; social preview verification |
| D-4 | Approved Job Detail labels for the posting and closing dates | Visible dates, so that `datePosted` and `validThrough` match visible content (Google; Doc 17 §270) |
| D-5 | Whether the public Job DTO may expose `countryCode` (a Doc 09 amendment) | A structured `Country` in `applicantLocationRequirements` |
| D-6 | Mapping of FIXED_TERM and CONTRACT to Google employment types | `employmentType` for those Jobs |
| D-7 | Real approved vacancy content | Real JobPosting data; SEO-034 validation |
