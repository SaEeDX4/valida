# C4 — SEO production integration (implementation record)

| | |
| --- | --- |
| Milestone | Release C — C4 SEO / Privacy / Legal Production Integration (Doc 18 §§163–167) |
| Governing | Doc 16 §§77–152, 255, 262 (SEO-001…040), 266 (gate); Doc 17 §§214, 258–273; Doc 04 §§47–49; Doc 06 SEO copy; Doc 12 §§6–10, 33; Doc 14 §23; Doc 15 §§63–67 |
| Owner decisions | [OD-2026-11-07-01](../review/OWNER_DECISION_2026-11-07-01_C4_DATE_LABELS.md) (date labels); [OD-2026-11-09-01](../review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md) (canonical origin, titles, social-card preview, work countries); [OD-2026-11-09-02](../review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md) (social card integration, eligible remote-work countries); [OD-2026-11-09-03](../review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md) (technical approval of `86e1459` and the label, card revision 2, the social-sharing copy, SEQ-1 closed) |
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
| `VITE_PUBLIC_SITE_URL` | The one canonical origin: **`https://cybervalida.com`**, the apex ([OD-2026-11-09-01](../review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md); Doc 14 §23, Doc 16 §§89–91). The value must also pass the host check: `https://<host>` with no path, port, query or credentials. Any other value — including `https://www.cybervalida.com` — is never used (`SITE_URL_NOT_CANONICAL`). Without the approved value, no canonical URL, `og:url`, sitemap or JobPosting is emitted. | empty |
| `VITE_ALLOW_INDEXING` | `true` only for the production build. When unset or `false`, the build is a **review build**: every response is `noindex, nofollow` in both the meta tag and `X-Robots-Tag`; there is no sitemap and no canonical, Open Graph or JobPosting tags (Doc 16 §82, SEO-020). | `false` |

`vite build` refuses two configurations: any `VITE_ALLOW_INDEXING` value other than `true`/`false`, and `true` with a `VITE_PUBLIC_SITE_URL` other than `https://cybervalida.com`. The document server also refuses to start an indexable build whose `valida-seo.json` names another origin.

The build also writes `dist/valida-seo.json`. It holds the canonical origin, the indexing flag and the API origin, all of which are already public in the bundle. The document server takes its configuration only from this file, so it cannot be configured differently from the bundle it serves.

Every absolute URL — canonical links, `og:url`, sitemap `<loc>`, the robots.txt `Sitemap:` line and JobPosting URLs — goes through `absoluteUrl(siteOrigin, …)`, so all of them are on the approved origin or absent. Local runs use the approved origin and serve it only on 127.0.0.1. The www redirect, DNS and HTTPS are C6.

## 3. Routes, statuses and heads

| Route | Status | Robots | Canonical / Open Graph | JobPosting |
| --- | --- | --- | --- | --- |
| `/`, `/about`, `/careers`, `/privacy`, `/legal` | 200 | none | yes | no |
| `/careers/:slug` — OPEN | 200 | none | yes | **Fully remote with explicit eligible remote-work countries: emitted** (`TELECOMMUTE`). Otherwise withheld (§4) |
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
  - Only a path made of RFC 3986 path characters is redirected.
  - The Location must start with exactly one `/`, and resolving it must give the same origin and exactly that path.
  - Anything else gets its ordinary response, usually the 404 page, and **no Location**.
  - This closes a review finding: the raw target `/\outside.example/A` was redirected to `/\outside.example/a`, which browsers resolve to `https://outside.example/a`, because `\` counts as `/` in WHATWG URL parsing.
- **Canonical URLs.** A canonical never includes the query string, such as `?region=` or tracking parameters (Doc 16 §93, SEO-039).
- **Canonical and noindex.** A page that is not indexable carries no canonical URL. A noindex page with a canonical would send mixed signals.
- **Open Graph tags.** `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, and the social card ([OD-2026-11-09-02](../review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md), revision 2 by [OD-2026-11-09-03](../review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md)):
  - `og:image` `https://cybervalida.com/social/valida-social-card-v2-1200x630.png`;
  - `og:image:width` `1200`, `og:image:height` `630`;
  - `og:image:alt` with the approved text.

  The image is `frontend/public/social/valida-social-card-v2-1200x630.png`, the rendered revision 2 byte for byte (SHA-256 `c86554a2…c2a5`), served unchanged from that path. Revision 1 (`2667d619…a71a`) is no longer served; it is kept in `docs/brand/social-card-preview/`. The owner approved it with C4's acceptance (Doc 16 §§94–97; D-3).
- **`og:description`** is the route's sharing description. On Home it is the social-sharing description of OD-2026-11-09-03: "Valida is a technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems." Everywhere else it is the route's own search description. `<meta name="description">` is unchanged on every route; Home's is still Doc 06 §12.

**Sitemap** (Doc 16 §§103–109). The five static routes are listed, then every OPEN Job from `GET /api/v1/jobs`, page by page. The sitemap is built per request, so publishing, closing or archiving a Job changes it at once (SEO-012).
- Excluded: Apply, 404, Draft, Archived and Closed Jobs, the API and review URLs.
- No `<lastmod>`: the public API exposes no content-modification time (SEO-013).

**robots.txt** (Doc 16 §§110–113).
- Nothing public is disallowed: no page, CSS, JavaScript or image.
- `/admin/`, `/employee/` and `/api/` are discouraged, except `/api/v1/jobs`, which the browser needs in order to render Careers and Job Detail.
- The file ends with the Sitemap line.
- A review build has no Sitemap line and no blanket `Disallow: /`, because a crawler only sees a `noindex` on a page it is allowed to fetch.

## 4. JobPosting and the Job's dates

**Status (OD-2026-11-09-02).** Google needs one of two things. For a fully remote job, it needs the countries from which the employee may work (`applicantLocationRequirements`, at least one country, with `jobLocationType: TELECOMMUTE`). Otherwise, it needs a structured workplace address (`jobLocation`).

- **Fully remote, with explicit eligible remote-work countries** (`eligibleWorkCountries`, contract: [`ELIGIBLE_WORK_COUNTRIES_CONTRACT.md`](../recruitment/ELIGIBLE_WORK_COUNTRIES_CONTRACT.md)): **emitted**.
  - It carries `jobLocationType: TELECOMMUTE`.
  - `applicantLocationRequirements` names the same countries, in the same order, as the visible "Eligible Remote-Work Countries" row.
  - The description repeats the visible "Work Arrangement" and "Eligible Remote-Work Countries" rows, so it states that the job is fully remote (Google).
- **Fully remote without a list** (absent or `[]`): **withheld** (`NO_APPLICANT_ELIGIBILITY`), in the initial HTML and the rendered page. Eligibility is never derived from `location`, the regional selector, a hiring market, a publication country, nationality or the occupational reference.
- **Hybrid or on-site:** withheld (`NO_STRUCTURED_WORKPLACE`). The public DTO has no structured workplace address (D-8).

The genuine vacancy's countries are OPEN, so no real Job carries a JobPosting today.

**The rest of the mapping.** It is kept in `jobPostingProperties()` and tested, so an approved input only adds the location properties. The mapping uses the same public DTO and formatting helpers as the page. The rules were checked against Google's current JobPosting documentation: "all information in the markup must be visible on the job page"; one job per page; remove the markup when the job closes.

| Property | Source |
| --- | --- |
| `title` | `job.title`, which is the H1 |
| `description` | The page's sections in page order, with the page's headings, as `<p>`/`<ul>`/`<li>`, HTML-escaped |
| `datePosted` | `job.publishedAt`, exactly when the page shows **Date Posted** (Doc 16 §128) |
| `validThrough` | `job.closesAt`, exactly when the page shows **Applications Close**. No closing date means no row and no `validThrough` (§§129–130) |
| `employmentType` | FULL_TIME, PART_TIME, TEMPORARY, INTERNSHIP→INTERN, OTHER. **FIXED_TERM and CONTRACT are omitted**, because Google has no unambiguous equivalent (SEO-032; D-6) |
| `hiringOrganization` | `{ name: "Valida", url, logo }`. The logo is the approved master `brand/valida-logo-approved-dark-1254.png` (1:1, inside Google's ratio limits). No `sameAs` (SEO-037) |
| `baseSalary` | The visible compensation: currency, amount, and `unitText` HOUR, MONTH or YEAR (§§134–135) |
| `workHours` | The visible weekly hours |
| `directApply` | `true`. The flow is one "Apply for This Role" action to one form on the same site, with no account, no login and no redirect (§136; the C3 E2E) |
| `url` | The canonical Job URL |

**Withheld for other reasons:**
- a closed Job (Doc 16 §§123, 140);
- a Job with regional hiring markets, because its visible location and pay depend on the visitor's region (only QA data has them);
- a required property is missing.

**Visible dates.** Owner decision OD-2026-11-07-01 approved the labels "Date Posted" and "Applications Close". An OPEN Job's Employment Details show:
- **Date Posted** from `publishedAt`, for example "1 November 2026";
- **Applications Close** only for a valid `closesAt`, for example "31 March 2027, 23:59 UTC".

Both values are rendered as `<time datetime="<the API's instant>">`.

They are shown **in UTC**, the server time that decides whether a Job is open (Doc 12 §15). So they read the same on every device and agree with the structured data. Only an ISO 8601 instant with an explicit zone and in-range fields is accepted. Anything else shows no row and adds no property.

The retained closed page is **unchanged**: it has no date rows, so no closing date can contradict the closed state (Doc 12 §33).

The JSON-LD is serialised with `<`, `>`, `&`, U+2028 and U+2029 escaped, so a Job's text cannot end the script element. The element is `<script type="application/ld+json">`, a data block that is never executed. The C6 Content-Security-Policy must still allow it (Doc 16 §255).

## 5. Verification (local)

| Check | Where |
| --- | --- |
| Unit and component tests | `frontend/src/seo/seo.test.js`, `frontend/src/components/seo/PageMeta.c4.test.jsx` |
| Document server over HTTP, against a stand-in API | `frontend/server/documentServer.test.js` |
| Real stack: the document server, the real backend, a disposable MongoDB, synthetic Jobs, Chromium | `e2e/` → `npm run test:e2e:seo` (cases C4-01…C4-16; see `e2e/README.md`) |

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

## 7. Owner decisions

| ID | Decision | State / what it unlocks |
| --- | --- | --- |
| D-1 | Apex or www as the canonical host | **Decided**: OD-2026-11-09-01, the apex `https://cybervalida.com` (implemented: indexable builds are pinned to it). The www redirect is C6 |
| D-2 | The Doc 06 / Doc 16 §85 title-pattern conflict (C4 keeps Doc 06) | **Decided**: OD-2026-11-09-01 §2.3, Document 06 titles; the other Doc 16 requirements unchanged. No code change |
| D-3 | An approved 1200×630 social card and its alt text | **Integrated** (OD-2026-11-09-02), then **revised** (OD-2026-11-09-03): revision 2, with the spacing adjustment and the approved copy and alt text. **Approved:** the owner's final visual approval of revision 2 and its revised preview, with C4's acceptance at `2193433` ([record](../review/OWNER_RECORD_2026-11-10_C4_ACCEPTANCE.md)). Real platform previews are C6 |
| D-4 | Labels for the posting and closing dates | **Decided**: OD-2026-11-07-01, "Date Posted" and "Applications Close" (implemented) |
| D-5 | **The eligible work countries per vacancy** (approved as requirement BR-ELIG-01 in OD-2026-11-09-01; the countries for the first vacancy are OPEN). It needs a Job field (Doc 10), the public DTO (Doc 09) and a visible label and value on Job Detail (Doc 06): see [`E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md`](../recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md) | **Field approved and implemented** (OD-2026-11-09-02): `eligibleWorkCountries`, with `TELECOMMUTE` + `applicantLocationRequirements` from the explicit list. **Still open for the genuine vacancy**: the explicit list of countries from which Valida has confirmed it can employ someone for the role |
| D-6 | Mapping of FIXED_TERM and CONTRACT to Google employment types | Open, and needed only if a real Job uses one |
| D-7 | Real approved vacancy content | Open. Unlocks real data and SEO-034 validation |
| D-8 | A structured workplace address in the public DTO (Doc 09 amendment), needed only for hybrid or on-site Jobs | Open. Unlocks `jobLocation` and the JobPosting for those Jobs |
