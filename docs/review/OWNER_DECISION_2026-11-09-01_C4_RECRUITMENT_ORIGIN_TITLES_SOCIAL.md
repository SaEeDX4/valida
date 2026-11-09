# Owner decision OD-2026-11-09-01 — First vacancy, work countries, canonical origin, page titles and social-card preview

| | |
| --- | --- |
| Identifier | **OD-2026-11-09-01**. No decision dated 2026-11-09 existed; the previous one is [OD-2026-11-07-01](OWNER_DECISION_2026-11-07-01_C4_DATE_LABELS.md). No identifier is reused. |
| Date | 2026-11-09 |
| Decided by | Saeed (owner), under Doc 00 §5 (change control) and Doc 18 §364 (change control after baseline) |
| Source | The owner's instruction "Valida — Complete the independent C4 work and record the recruitment decisions" (2026-11-09) |
| Recorded by | Claude, on local `c4-work` after the reviewed commit `767d6c96d749b7021a207e019a814f3a80de2fc9`. Nothing is pushed. |
| Recorded once | This file is the only record of these decisions. Other documents link here and do not restate them. |

## 1. The decisions, as given

| # | Decision |
| --- | --- |
| R1 | **First genuine vacancy.** The first planned genuine vacancy is **Cybersecurity Specialist**, **fully remote**, with an **international recruitment audience**. Canadian **NOC 21220 is an occupational reference**. The future description must reflect Valida's actual responsibilities and requirements. It does **not** establish a Canada-only restriction. |
| R2 | **Work countries OPEN.** The countries from which the employee may perform this role are **OPEN**, pending company and employment arrangements. All 21 regional-selector countries are kept for presentation and discovery. Employment eligibility is **never** derived from that selector, from `job.location`, from a publication market, from nationality or from the occupational reference. |
| R3 | **Canonical origin.** The intended canonical origin is **`https://cybervalida.com`**. |
| R4 | **Page titles.** The existing Doc 06 page titles are kept. This record states how that resolves the conflict with Doc 16 §85 (§3). The other Doc 16 SEO requirements are preserved. |
| R5 | **Social card.** A 1200 × 630 social-card **preview** and proposed alt text are authorised. **Final asset approval is pending.** |
| R6 | **Long-term requirement (approved business requirement BR-ELIG-01).** Authorised admins can maintain the eligible remote-work countries **separately for each vacancy**, with **no code change per advertisement**. This round authorises documentation and gap analysis only. It authorises **no** Admin implementation and **no** public API contract change. |

## 2. Affected requirements, and how they read now

### 2.1 R1 and R2 — the vacancy and its work countries

| Clause | Text (short) | Effect of this decision |
| --- | --- | --- |
| Master Prompt §6; Doc 00 §10; Doc 01 §17; Doc 02 §§49, 66; Doc 06 §107; Doc 10 §70; Doc 12 §44 | Planning data: "Fully remote", "Physical work location: British Columbia, Canada", 30 h/week, CAD 35.00 gross/hour, NOC 21220 internal reference | These clauses call the values **editable planning data**. Doc 02 §49 says they "may change through approved business decisions before publication". This is such a decision. **"Physical work location: British Columbia, Canada" no longer fixes where this role is performed.** The work country or countries are OPEN. The stored value stays in the Draft as planning data. It is marked AWAITING INPUT and is not published or used for eligibility (§4). Title, fully remote, 30 h/week and CAD 35.00 gross/hour are **unchanged**. |
| Doc 10 §23; Doc 12 §54 | NOC is "internal by default" and is not in the public DTO | Unchanged. R1 confirms it is a reference, not a restriction, and authorises no public display. |
| Doc 12 §45; Doc 18 §247 | The initial Job stays DRAFT until approved content exists; E6 requires the real Job to be "complete and approved" | The **approved work country or countries** are now also part of the content the vacancy needs before publication. Doc 12 §25 already requires `location`. |
| Doc 16 §132 | "public structured location eligibility must remain consistent with the approved real British Columbia, Canada employment/work-location requirement" | **The BC basis is superseded.** Eligibility markup must be consistent with the vacancy's approved work countries. They are OPEN, so the JobPosting stays **withheld** (`NO_APPLICANT_ELIGIBILITY`), as on `767d6c9`. Doc 16 §131 (remote semantics) is unchanged. |
| Doc 02 §§62–63; Doc 12 §176; Doc 18 §250 | External ads must match the real vacancy, including location | Applies to the work countries once approved. |
| `frontend/src/features/jobs/markets.js` (Release A regional view) | 21 selector countries; "A visitor's region NEVER creates eligibility" | **Preserved unchanged** for presentation and discovery. |
| Master Prompt §15; Doc 18 §§258–264 (Release F) | The intended employment setup in British Columbia | **Not changed by this decision.** Release F rechecks its planning facts against the finalised arrangement (§262). |

### 2.2 R3 — canonical origin

| Clause | Effect |
| --- | --- |
| Doc 14 §§3–4 | For the website canonical host, the `<PRIMARY_DOMAIN>` token resolves to `cybervalida.com`. The domain already carries the approved mail identities (OD-2026-10-26-02). Registrar, DNS and certificate facts (Doc 14 §§6–27) are **not** decided here. |
| Doc 14 §23; Doc 16 §§89–92 | **The apex is the canonical host.** `www.cybervalida.com` must redirect to it. The redirect, DNS, HTTPS and production-host verification are **C6**. |
| `docs/seo/C4_SEO_IMPLEMENTATION.md` D-1 | **Closed** by this decision. |

### 2.3 R4 — page titles: how the conflict with Doc 16 §85 is resolved

**The conflict.**
- Doc 16 §85 lists the "canonical title patterns":
  - Home: "Valida — Secure Systems. Deliberate Engineering."
  - About: "About Valida | Valida"
  - Careers: "Careers | Valida"
  - Job Detail: "{Job Title} | Valida Careers"
  - Privacy: "Privacy | Valida"
  - Legal: "Legal | Valida"
- Doc 16 §86 gives the Apply title "Apply — {Job Title} | Valida".
- Document 06 gives different SEO titles:
  - §11 "Valida | Cybersecurity & Secure Technology"
  - §54 "About Valida | Security-First Technology"
  - §77 "Careers at Valida | Open Technology & Cybersecurity Roles"
  - §94 "{job.title} | Careers at Valida"
  - §109 "Apply for {job.title} | Valida"
  - §155 "Privacy Notice | Valida"
  - §170 "Legal Information | Valida"
  - §179 "Page Not Found | Valida"
- Doc 04 §110 leaves the exact wording to "Documents 06 and 16". It names no tie-breaker.

**The resolution.**

1. **Document 06 is the single authority for the text of every page `<title>`.** The `og:title` repeats it.
2. **The title strings in Doc 16 §85 are superseded and are not implemented.**
3. The Apply title is one of "the existing Doc 06 page titles" (Doc 06 §109). The **string** in Doc 16 §86 is therefore superseded in the same way.
   - §86's requirement is **preserved**: the noindex Apply page still has a title "for browser/user clarity".
4. **Every other Doc 16 SEO requirement is unchanged:**
   - §84: a unique, meaningful title on every indexable page;
   - §§78–83: indexing, Apply noindex, and a review build that is `noindex, nofollow`;
   - §§87–88: descriptions from Document 06;
   - §§89–93: canonical URLs;
   - §§94–97: Open Graph, with `og:image` pending R5;
   - §§98–102: rendering;
   - §§103–113: sitemap and robots;
   - §§114–123: statuses and closed Jobs;
   - §§124–140: JobPosting;
   - §266: the gate.
5. **No code or copy change is required.** The implemented titles are already exactly Document 06's. They are now tested against both lists, Doc 06 and the superseded Doc 16 strings (`frontend/src/seo/seo.test.js`).
6. **Canonical-document follow-up.** Doc 16 §§85–86 should be revised in the canonical file to point to Document 06, under Doc 00 §5. That is a canonical-document revision outside this repository. Proposed text:
   - "§85 TITLE PATTERNS — Page titles are the Document 06 SEO titles (§§11, 54, 77, 94, 155, 170, 179; OD-2026-11-09-01)."
   - "§86 APPLY TITLE — Document 06 §109, despite its noindex status, for browser/user clarity."

This closes `C4_SEO_IMPLEMENTATION.md` D-2.

### 2.4 R5 — social card

| Clause | Effect |
| --- | --- |
| Doc 16 §§94–96; SEO-006 | A preview is produced **outside the production build inputs** (`docs/brand/social-card-preview/`). It is not wired: no `og:image` and no `og:image:alt` are emitted until the owner approves the actual image. The Open Graph item of Doc 18 §165 therefore stays **open at C4**. |
| Doc 16 §266 | Real social-platform previews are checked on the production host (C6) after approval and wiring. |

### 2.5 R6 — BR-ELIG-01

| Clause | Effect |
| --- | --- |
| Doc 18 §§230–234 (E3 Job management); Doc 12 §§19–43, 208–218; Doc 11 §§146–160 | The requirement is assigned to the established Job lifecycle and permissions. Its trace, gaps and smallest proposed amendments are in [`docs/recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md`](../recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md). Every schema and API shape there is **PROPOSED**, not approved. |
| Doc 12 §§46–47; Doc 15 §§171–175 | Until E3 exists, the operating method is controlled provisioning (`backend/scripts/provision-job.mjs`). |

## 3. What this record changes in the repository (local, `c4-work`)

| Change | Where |
| --- | --- |
| Indexable builds are pinned to `https://cybervalida.com`. Any other origin is refused at build time, and is never used at runtime (`SITE_URL_NOT_CANONICAL`). The existing host validation and the review build are unchanged. | `frontend/src/seo/siteConfig.js`, `frontend/server/serve.mjs`, tests |
| Configuration documentation names the approved origin | `frontend/.env.example`, `frontend/src/config/env.js`, `backend/.env.example`, `e2e/README.md`, `e2e/support/seoStack.js`, `docs/seo/C4_SEO_IMPLEMENTATION.md` |
| The planned vacancy's Draft keeps its stored values, and declares `location` **AWAITING INPUT**. Its notes cite R1/R2. It is **not provisioned**. | `backend/provisioning/jobs/cybersecurity-specialist.json`, backend provisioning tests |
| Title source comment points here | `frontend/src/seo/routeHeads.js` |

## 4. What this decision does not decide

- **The work country or countries** for this vacancy: OPEN, AWAITING owner input (R2).
- **The approval of the actual social-card image** and its final alt text (R5).
- **The schema, provisioning definition, admin API, public DTO, Doc 06 copy and JobPosting mapping** for eligibility. These are PROPOSED in the gap analysis and need their own approvals (R6).
- **When the genuine vacancy may first be published**, website versus E6. See the sequencing item in the gap analysis.
- **Whether the Draft's stored planning value "British Columbia, Canada / CA / BC" is retired or kept.** It is kept unchanged and marked AWAITING INPUT. It is not deleted (Doc 18 §365, no documentation amnesia).

Nothing is provisioned or published. Production candidate acknowledgements stay disabled.
