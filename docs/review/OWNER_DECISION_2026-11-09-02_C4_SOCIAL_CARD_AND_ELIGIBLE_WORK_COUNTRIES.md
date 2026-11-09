# Owner decision OD-2026-11-09-02 — Social card integration and the eligible remote-work countries field (C4)

| | |
| --- | --- |
| Identifier | **OD-2026-11-09-02**, the next free identifier after [OD-2026-11-09-01](OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md). No identifier is reused |
| Date | 2026-11-09 |
| Decided by | Saeed (owner), under Doc 00 §§4–5 (a Level 1 explicit approved product change, recorded as a controlled amendment) and Doc 18 §364 |
| Source | The owner's instruction "Valida — Complete C4 locally from d69b5d3. Return one handoff for Astra's independent review." (2026-11-09) |
| Baseline | `c4-work` at `d69b5d3c3468e98cc2bc7fe8b7a64352a20ff772`. The published C1–C3 tip is `f07ea35f6f2995d760bf06e8b5080187270e110e` |
| Scope rule | **Only the changes this instruction covers are approved** (§1). The implementation choices in §2 are recorded for review. Everything in §3 keeps its earlier status |
| Recorded by | Claude, on local `c4-work`. Nothing is pushed |

## 1. What is approved

### A1 — the social card: local integration authorised

- **The image.** The original PNG of OD-2026-11-09-01 R5, reused byte for byte:
  - 1200 × 630;
  - SHA-256 `2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a`.
- **The alternative text**, exactly as written:

  > Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering."

- **The integration.**
  - The card goes into the existing Open Graph implementation, at a stable asset path.
  - The absolute `og:image` is on the approved origin `https://cybervalida.com`, with the alt text and the dimensions.
  - The tags must be verified in the initial HTML and after client navigation.
  - The asset must be fetched from the local build: HTTP 200, `image/png`, the same SHA-256.
- **Status: local integration authorised. Final visual sign-off is pending the owner's inspection** of the exact PNG and of a rendered sharing preview.
- **Review builds** keep their default `noindex, nofollow` behaviour.

### A2 — one optional field: eligible remote-work countries

- **The field.** One optional, job-specific field: the countries from which Valida has approved an employee to perform that remote role.
  - One documented country-code representation across storage, provisioning and the public contract.
  - Existing country utilities are reused where appropriate.
  - The 21-country selector keeps its entries and behaviour.
- **Four independent concepts:**
  - the physical job location;
  - the international recruitment audience;
  - the regional presentation;
  - the eligible remote-work countries.

  Only an explicit value supplied for that vacancy may establish work-country eligibility. It is never derived from `job.location`, NOC 21220, a publication country, a visitor's region or the selector.
- **Model and provisioning.**
  - Existing Jobs without the field remain readable.
  - A routine edit that omits the field keeps an approved list.
  - A deliberate clear goes through the controlled process.
  - Codes are validated, and duplicates are handled consistently.
  - Invalid input leaves the previous record intact.
  - The lifecycle, authorisation and publication checks are unchanged.
- **Public API and visible content.**
  - The list is exposed through the Job Detail contract.
  - A fully remote vacancy with an explicit list shows the country names under a clear Doc 06 label such as "Eligible remote-work countries".
  - An absent or empty list makes no inferred country claim.
  - Careers and Apply behave as before, for legacy records too.
- **Structured data.**
  - An otherwise qualifying open, fully remote Job uses the same explicit countries for the visible row and `applicantLocationRequirements`, with `jobLocationType: "TELECOMMUTE"`.
  - A remote Job with unknown eligibility withholds the whole JobPosting, in the initial HTML and on the rendered page.
  - Navigating away clears the markup.
  - The closed-Job rules, the real `publishedAt`, the conditional `validThrough` and the redirect protection are kept.
- **The initial vacancy.**
  - It stays Draft: Cybersecurity Specialist, Canadian NOC 21220, fully remote, international recruitment.
  - Its eligible work countries remain **OPEN**.
  - "British Columbia, Canada" is kept where it is a historically accurate planning value, with its provenance.
  - Wording or validation that treats it as proof of eligibility is corrected.
  - The Draft's publication guard stays effective. Its publication remains subject to the Release E gates, including E6.

### A3 — records

The controlling repository records and the affected contract documentation are updated. For each canonical document kept outside the repository, the exact clause and the proposed replacement wording are returned, marked **pending synchronisation**: see [`ELIGIBLE_WORK_COUNTRIES_CONTRACT.md`](../recruitment/ELIGIBLE_WORK_COUNTRIES_CONTRACT.md) §5.

**The Admin interface stays in Release E.**

## 2. Implementation choices, recorded for review

| Point | Choice | Reason |
| --- | --- | --- |
| Card asset path | `frontend/public/social/valida-social-card-1200x630.png`, served as `/social/valida-social-card-1200x630.png`. Same git blob (`78116a83…`) as the reviewed preview | `public/` is copied into the build unchanged, so the path is stable (no content hash). The brand pack and its `SHA256SUMS.txt` are untouched |
| Card tags | `og:image`, `og:image:width` `1200`, `og:image:height` `630` and `og:image:alt`, on every page that has Open Graph: the indexable pages, open Job Detail included | Doc 16 §§94–97. Noindex pages and review builds have no Open Graph, so they carry no card |
| Field name | `eligibleWorkCountries`, the same name in the model, the definition file and the DTO | One name everywhere |
| Representation | **Uppercase ISO 3166-1 alpha-2 codes, in the order given, each once.** The code set comes from Debian iso-codes 4.16.0 (`iso_3166-1.json`, 249 codes), generated into `backend/src/modules/jobs/countryCodes.js` | One documented representation (A2). The ISO standard, checked against a list, not only a pattern |
| Display names | `frontend/src/features/jobs/countryNames.js`, generated from the same input. The name is iso-codes `common_name`, or `name` otherwise; a test checks that both tables have the same codes. For the 21 selector countries the names equal the selector labels (tested) | The page and the JSON-LD use one table, so server and browser cannot differ, as they could with engine-dependent `Intl` names |
| Reused utilities | The selector's `COUNTRY_LABELS` is unchanged and is checked against the new table. The 21-country catalogue is **not** reused as the eligibility list | A2: never derive eligibility from the selector |
| Lowercase input | **Refused**, not normalised | One representation. The same rule in the definition schema, the model and the frontend contract |
| Duplicates | **Refused** at every layer | "Handle duplicates consistently". A duplicate is a sign of a mistaken definition |
| Omission / `[]` / list | Omitted keeps the stored list (a new Job gets none). `[]` is a deliberate clear. A list sets exactly those codes | A2 |
| Arrangement rule | A non-empty list is allowed only on a `FULLY_REMOTE` Job, or on a Draft whose arrangement is not set yet | The field describes a remote role. A list on a hybrid Job would be a claim that is never shown |
| Material change | The field is in `MATERIAL_FIELDS`: with Applications present, a change needs `--confirm-material-change` | Doc 12 §41 gives material changes as "examples such as … location"; where the role may be performed is of the same kind |
| Public DTO | **Job Detail only**, always present (`[]` when none), after `compensation`. The Careers list is unchanged | A2: "through the Job Detail contract"; Careers unchanged |
| A stored list that is not valid | Refused by the mapper (a safe 500); the document server answers 503 and the browser shows the error state | Never a partial or widened claim |
| Visible label | **"Eligible Remote-Work Countries"**: the owner's wording, in the Title Case of the other Doc 06 §97 labels. The value is the country names in the Job's order, joined with ", ". One constant in `JobDetailPage.content.js` | The owner wrote "a clear Doc 06 label **such as** Eligible remote-work countries" |
| Where the row appears | Employment Details, after Compensation and before Date Posted. On open and retained closed pages alike, like Location | It is a fact of the vacancy, independent of the regional view |
| JobPosting description | For a `TELECOMMUTE` posting, the description also repeats the two visible rows: "Work Arrangement: Fully remote" and the countries | Google: "the job description must clearly state that the job is 100% remote"; both rows are on the page |
| Country object | `{ "@type": "Country", "name": "<the visible name>" }` | The same words as the page. Google requires at least one country |

## 3. Not approved here, or still open

| Item | Status |
| --- | --- |
| **The countries for the genuine vacancy** | **OPEN, AWAITING owner input.** This is the minimum remaining eligibility decision: the explicit list of countries from which Valida has confirmed it can employ someone to perform this role. The Draft holds `eligibleWorkCountries: []` and declares it AWAITING INPUT |
| Final visual sign-off of the social card | Pending the owner's inspection |
| Publish readiness | **Unchanged.** The field is optional; a remote Job without a list publishes as before, with no JobPosting. G4's earlier "at least one country before publication" proposal is not adopted |
| `jobSnapshot` on Applications (G9) | Not approved; unchanged (Doc 10 §77) |
| The Admin interface (G3) | Release E (E3). How it will manage the field: contract §6 |
| Canonical-document text | Pending synchronisation: contract §5 |
| SEQ-1 (website publication before E6), Doc 16 §§85–86 text, and the privacy, legal, provider, retention and host items | As recorded in OD-2026-11-09-01 and the C4 records |

Nothing is provisioned or published. Production candidate acknowledgements stay disabled.
