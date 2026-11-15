# Owner record — C5 accepted at `a6a0fe1` (2026-11-15)

| | |
| --- | --- |
| Source | The owner's instruction of 2026-11-15 ("I formally accepted C5 on 15 November 2026 at `a6a0fe11b60a3e8dd37d896fdefe1e9466c77c4b` and approved all four decisions"), with the technical instruction "Valida C5 final owner acceptance and C6 planning assignment" (15 November 2026; decision authority: Saeed; technical coordinator and independent reviewer: Astra) and two owner records of the same date supplied with it |
| Recorded by | Claude, in one signed, documentation-only commit whose parent is the accepted implementation `a6a0fe1` |
| Nature | A record of decisions already made by the owner. **It decides nothing new.** Claude does not declare acceptance; it records the owner's |
| Supersedes | The wording "acceptance pending", "C5 is not accepted" and "under review" in the earlier C5 records and status lines. Those records are kept as written, as the history of their dates |

## 1. What the owner accepted

| Item | State | Identity |
| --- | --- | --- |
| **C5 — Integrated Site Quality** (Doc 18 §§168–172) | **Accepted (final owner acceptance), 2026-11-15** | Commit **`a6a0fe11b60a3e8dd37d896fdefe1e9466c77c4b`**, tree `3e94bd4239eb84c56edcc27eae1eccb120de9ca2`, on local `c5-work` |

**Verified before this record was written** (2026-11-15, in the environment that holds `c5-work`):

- `c5-work` HEAD was `a6a0fe11b60a3e8dd37d896fdefe1e9466c77c4b`; its tree was `3e94bd4239eb84c56edcc27eae1eccb120de9ca2`; the worktree was clean, with nothing staged, untracked or stashed.
- `389c421a72fb090dc2c08c8251b664bada73d9a0`, the last verified GitHub `main` checkpoint, is an ancestor. A read-only query of the remote on the same day returned `main` = `389c421`.
- `389c421..a6a0fe1` holds **37** commits. (The round-5 handoff said 36; that count was taken one commit before the final one. The commits and the bundle are unaffected.)
- The checksum files of the five C5 evidence packages (r1 to r5) all verified.

### The four decisions, as approved

| # | Decision | Recorded as |
| --- | --- | --- |
| 1 | **The C4 document-server change is accepted**: the server writes a preload hint for the public Job GET on Job Detail and Apply documents (`5af9893`; C5 record §9.2, §9.3). This closes OD-C5-3 | Both sets of results are preserved as measured: the directly measured mobile lab improvement (LCP p75 about 2.1–2.2 s, from about 2.7–2.8 s) **and** the Lighthouse results (simulated mobile LCP 3.1–3.5 s on Job Detail and 2.5–3.0 s on Apply, Performance score passing). They disagree; neither is field evidence. **Field performance remains open** |
| 2 | **The C5-14 reduced-motion criterion and the corrected recorder are accepted** (C5 record §10.3, §11.1; `c7bf09d`, `79b1b7b`) | The failed historical runs stay failed and unaltered (`8049060`, `b5ec779`). The later controls and scoped runs stand as recorded: one complete suite at `c7bf09d` (22 passed, 1 skipped by design), and at `79b1b7b` 15 unit tests and 8 Chromium repeats of C5-14 |
| 3 | **The current visuals are accepted for C5.** Brand-image derivatives (OD-C5-2) and the minor design improvements (OD-C5-4) are **carried as follow-up** | Not closed, not implemented: see §4 |
| 4 | **Desktop Safari and iOS Safari verification is carried to the C6 review host** and is to be resolved before final C7 acceptance | **Status: OPEN** (§4) |

## 2. Evidence levels, kept as supplied

Nothing below is upgraded by this record.

| Evidence | Level | What is and is not asserted |
| --- | --- | --- |
| Automated C5 evidence, r1 to r5 | Executed and recorded by Claude in Playwright's Chromium on Linux, by commit | As stated in each package, with its original scope. Failed runs keep their outcomes |
| The owner's manual review on Windows and Android | **Owner-reported** | The owner reports completing his manual review and testing, with satisfactory functionality, responsiveness, usability and overall quality, and no issue requiring changes. Device and software versions, per-route results and unreported sub-cases were not supplied |
| **NVDA screen-reader testing on Windows** | **Personally tested by the owner; owner attestation** | The owner confirms he completed NVDA testing on Windows himself, with satisfactory results and no accessibility issue requiring changes. This supersedes an earlier owner addendum of the same day that recorded NVDA as not yet run; that addendum stays as the history of its session. Browser and software versions, exact route coverage, speech transcripts and separate assistive-technology observations were **not supplied**. No independent NVDA execution is asserted |
| The synthetic application confirmation in Edge | **Directly evidenced** by a screenshot the owner supplied to the reviewer | The screenshot is the owner's evidence and is not in this repository |
| WCAG conformance | **Not asserted** | No general WCAG conformance determination is made by this record, by the automated tests or by the owner's attestation (Doc 16 A11Y-002) |

No new browser version, transcript or per-route result is asserted. The manual checklist of the C5 record (§11.4) keeps its rows; where the owner's reports do not name a row, the row is not marked as individually evidenced.

## 3. Doc 06 synchronisation (Doc 00 §5; OD-2026-11-10-01)

[OD-2026-11-10-01](OWNER_DECISION_2026-11-10-01_C5_LABEL_IN_NAME.md) approved three accessible names. Its §3 said the canonical Doc 06 still had to be amended. **The owner has now supplied the synchronised revision.** This section supersedes the pending status in OD-2026-11-10-01 §3 and in the C5 record (§8.1, §9.5, §11.4 row D1); those texts are kept as written.

**The C5 reference for Doc 06** is the owner-held file `06_Valida_Content_Copy_Deck_C5.docx`.

| Clause | Text in the supplied revision (read from the file) | OD-2026-11-10-01 | Implementation at `a6a0fe1` |
| --- | --- | --- | --- |
| **§9 Mobile navigation** | Menu button: "Menu". Accessible name in both states: "Menu". Expanded state: `aria-expanded="false"` when closed and `"true"` when open | matches | `MobileNavigation.jsx`: no `aria-label`; `aria-expanded` |
| **§87 Job card / row labels** | CTA: "View Role". Accessible link pattern: "View Role: {job.title}" | matches | `JobRow.jsx` |
| **§110 Apply — back link** | "Back to Role". Accessible: "Back to Role: {job.title}" | matches | `ApplyPage.content.js` |

| Check | Result |
| --- | --- |
| SHA-256 of the supplied revision | **`c93c25b8e4007472ccc3ab1d70fa949101e7a4456102a7b669887ed9a09e6129`** — computed from the supplied file; **equals** the value in the owner's review addendum of 2026-11-15 |
| SHA-256 of the original (source) Doc 06 | `2695991763d7ca98b653686708968a6a3d5fa188fc1b7564e059f342508c47aa` — **recorded as supplied by the owner; not verified here.** The original file's bytes are not available in this environment (only its extracted text is) |
| The three clauses | **Verified** in the supplied revision, as in the table above |
| The old names | Absent from the revision: "Open navigation", "Close navigation", "View {job.title} role" and "Back to {job.title}" do not occur |
| The rest of the document | 234 numbered sections, in sequence, as in the original. A sample of strings from other sections is present unchanged. **A full byte or paragraph comparison against the original was not possible** (see the source hash above); the comparison made is of extracted text |
| Scope | Only these three clauses are synchronised by this revision. The canonical clauses still pending under earlier decisions (OD-2026-11-09-03 §5, the eligibility contract §5 and the earlier records) are **not** changed by it |

### The register entry, and where it goes

Doc 00 §5 requires "the affected canonical documents and tracker entries" to be updated. The authoritative register is Doc 00 itself (`00_DOCUMENT_REGISTER.md`, §21 Canonical Document Register and §30 Central Delivery Tracker). It and the canonical Doc 06 are held outside this repository, in the owner's maintained canonical collection, and **cannot be written from the environment that produced this commit.** So:

- **Done in this repository:** this record, the status lines of `README.md`, `docs/README.md` and the C5 record. These are the repository's tracker entries.
- **Not done, and not claimed:** the entry in Doc 00, and the replacement or addition of the Doc 06 revision in the maintained canonical collection. **Adoption there is not verified.**

**The exact entry for Doc 00** (destination: `00_DOCUMENT_REGISTER.md`, as a revision note to the §21 row of document 06, and wherever the owner keeps the canonical revision log):

> **Document 06 — `06_CONTENT_COPY_DECK.md` — revision "C5", 2026-11-15.**
> Authority: owner decision **OD-2026-11-10-01** (2026-11-10), under §5 Change Control.
> Changed clauses, and only these: **§9** Mobile navigation — accessible name "Menu" in both states, with `aria-expanded` "false" when closed and "true" when open (was "Open navigation" / "Close navigation"); **§87** Job card / row labels — accessible link pattern "View Role: {job.title}" (was "View {job.title} role"); **§110** Apply back link — accessible name "Back to Role: {job.title}" (was "Back to {job.title}"). Visible labels unchanged.
> Revision file: `06_Valida_Content_Copy_Deck_C5.docx`, SHA-256 `c93c25b8e4007472ccc3ab1d70fa949101e7a4456102a7b669887ed9a09e6129`.
> Supersedes for these clauses: the original `06_Valida Content Copy Deck.docx`, SHA-256 `2695991763d7ca98b653686708968a6a3d5fa188fc1b7564e059f342508c47aa`, **retained** as the historical source.
> Implemented at `c5-work` `7dcfe02` (fix F5); accepted with C5 at `a6a0fe11b60a3e8dd37d896fdefe1e9466c77c4b`.
> Document status: BASELINED (unchanged). Runtime change: none.

## 4. Still open (unchanged by this acceptance)

| Item | Status | Where it is resolved |
| --- | --- | --- |
| **Desktop Safari (macOS) and iOS Safari** | **OPEN** | On the C6 review host; to be resolved before final C7 acceptance (decision 4) |
| **Field Core Web Vitals** (p75 LCP, INP, CLS; Doc 16 PERF-001 to -005) | **OPEN.** No field measurement exists; every figure so far is a lab figure | Production traffic, C6/C7 and after |
| Host delivery: compression, caching, the preload hint and `connect-src` at the production host | OPEN | C6 |
| Brand-image derivatives (OD-C5-2) and minor design items (OD-C5-4) | **Carried as follow-up** (decision 3) | A later, separately authorised change |
| Adoption of the Doc 06 revision in the maintained canonical collection, and the Doc 00 entry | Not verified (§3) | The owner's canonical collection |
| The recorder's stated limit: an effect shorter than one frame that starts after the frame's reading is not seen (C5 record §11.1) | Stated; not implemented | A decision for the reviewer, if wanted |
| `injectHead` interprets `$` sequences in a Job title (C5 record §9.5) | Noticed; not changed | A later, separately authorised change |
| The eligible work countries of the genuine Cybersecurity Specialist vacancy | **OPEN.** The vacancy stays **Draft** through the approved Release E gates, including E6 | Release E |
| Production candidate acknowledgements | **Disabled**, pending separate authorisation | — |
| The items carried by the C4 acceptance record §3 | Unchanged | As recorded there |

## 5. The four states, kept separate

| | C5 |
| --- | --- |
| Accepted | **yes, `a6a0fe1`** (this record) |
| Branch-published | **no.** `c5-work` exists only locally. No push is authorised |
| Merged into `main` | no. Remote `main` is `389c421` |
| Deployed | no |

Publication, integration and deployment are separate owner decisions. Each changes state only after it is authorised, executed and independently verified.

## 6. Consequences in this repository

- **C5 is frozen at `a6a0fe1`.** This record is a documentation-only commit on top of it. No product or test file is changed by it.
- **Status lines updated in this commit:** `README.md` (C5 accepted; local only), `docs/README.md` (this record indexed; the C5 record and OD-2026-11-10-01 rows), and `docs/qa/C5_INTEGRATED_SITE_QUALITY.md` (its status row and a closing §12 that points here).
- **Kept verbatim:** every earlier section of the C5 record, OD-2026-11-10-01, and the r1 to r5 review packages and evidence, which are held outside the repository.
- **C6 — Production Infrastructure & Deployment (Doc 18 §§173–182) has not started.** Its planning material is prepared separately and is **not** part of this branch.

## 7. What this record does not do

- It does not publish, merge or deploy anything, and it authorises none of those.
- It does not assert WCAG conformance, any browser or device result that was not supplied, or any field measurement.
- It does not place private evidence, personal library references or workstation details in the repository.
- It does not change the genuine vacancy, the acknowledgement setting, or any approved copy.
