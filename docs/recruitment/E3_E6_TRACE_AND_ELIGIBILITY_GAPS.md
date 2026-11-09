# Release E trace and eligible-work-country gaps (BR-ELIG-01)

| | |
| --- | --- |
| Authority | [OD-2026-11-09-01](../review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md), R2 and R6 |
| Read | Doc 18 §§109–110, 145, 165, 180–186, 218, 230–234 (E3), 237, 246–252 (E6), 364, 384; Doc 09 §§54, 63, 169–173, 180–186; Doc 10 §§19–28, 57–70, 75–78, 136–141, 147–151; Doc 11 §§146–160, 172–174, 198–201; Doc 12 §§4–47, 176, 208–218, 262–263; Doc 13 §§313–314; Doc 02 §§48–51, 62; Doc 06 §§87, 97–98, 107–108, 169, 178; Doc 15 §§171–175; Doc 16 §§124–138 |
| Scope | **Documentation and gap analysis only.** Nothing here is implemented. No Admin implementation and no public API contract change are authorised. |
| Status of every design below | Written as **PROPOSED** (OD-2026-11-09-01). Since OD-2026-11-09-02, see §0 for what is implemented. |

## 0. Status after OD-2026-11-09-02 (2026-11-09)

The owner approved one optional field in C4 ([OD-2026-11-09-02](../review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md)). Its contract is [`ELIGIBLE_WORK_COUNTRIES_CONTRACT.md`](ELIGIBLE_WORK_COUNTRIES_CONTRACT.md). The analysis below is kept as written; where it says PROPOSED, read this table.

| Gap | Status |
| --- | --- |
| G1 Job model | **Implemented** (C4): `Job.eligibleWorkCountries`, ISO 3166-1 alpha-2. The Doc 10 text is pending synchronisation |
| G2 Controlled provisioning | **Implemented**: the optional definition key (omitted keeps, `[]` clears), validated, material |
| G3 Admin editing | **Release E (E3)**, unchanged. How it will be managed: contract §6 |
| G4 Validation | **Implemented** for codes, duplicates and the arrangement. The proposed "at least one country before publication" is **not adopted**: the field is optional, and a remote Job without a list carries no JobPosting |
| G5 Public DTO | **Implemented**, Job Detail only. The list is unchanged |
| G6 Visible copy | **Implemented**: "Eligible Remote-Work Countries". The Doc 06 text is pending synchronisation |
| G7 JobPosting | **Implemented**: `TELECOMMUTE` plus `applicantLocationRequirements` from the explicit list; withheld otherwise. The Doc 16 §132 text is pending synchronisation |
| G8 Material change | **Implemented** under Doc 12 §41's "examples such as". The canonical text is pending synchronisation |
| G9 `jobSnapshot` | **Open**: not approved, unchanged |
| G10 External consistency | **Canonical text only**, pending synchronisation (contract §5) |
| G11 Release A `hiringMarkets` | **Done as proposed**: comments now say presentation only; no runtime change |

## 1. The approved business requirement

**BR-ELIG-01 (APPROVED, OD-2026-11-09-01 R6).** Authorised admins can maintain the eligible remote-work countries **separately for each vacancy**, with **no code change per advertisement**.

It is bound by R2:
- the countries are never derived from the regional selector, `job.location`, a publication market, nationality or the occupational reference;
- for the first vacancy they are **OPEN**, so they are AWAITING INPUT.

As a requirement, this means three things, and no more:
- the countries belong to the **vacancy record**;
- they are maintained through the **authorised Job-management path**, the same one as every other Job field;
- what the public sees about them comes **from that record alone**.

How they are stored, validated and exposed is design (§3).

## 2. The established lifecycle, reused

| Capability | Existing clauses | Permission (Doc 11 §§150–152; default deny) | Phase 1 interim: controlled provisioning (`backend/scripts/provision-job.mjs`) | BR-ELIG-01 gap |
| --- | --- | --- | --- | --- |
| Draft creation | Doc 12 §§19, 213: a new Job is always DRAFT. Doc 10 §57 | `jobs:create` | `apply` creates a DRAFT, or DRAFT → PUBLISHED in one confirmed run. Any other initial status is refused (`INVALID_INITIAL_STATUS`) | Field missing: G1, G2 |
| Editing | Doc 12 §§21, 40, 214: slug, enum, limit and material-change protection. Doc 10 §65: Draft flexibility | `jobs:update` | Re-applying an edited definition file. No source change (Doc 12 §47) | G1–G4 |
| Preview | Doc 12 §§22–23: a protected `/admin/jobs/{jobId}/preview`, not indexed, never through the public API. Doc 09 §173 | Admin session (`jobs:read`) | Only the `plan` report. There is no rendered preview before E3 (§5.4) | G6: the preview must show the countries exactly as the public page will |
| Publication validation | Doc 12 §§25–27, 215. Doc 10 §64. Doc 18 §232: server authority | `jobs:publish` | Refuses `AWAITING_INPUT`, `NOT_PUBLISH_READY`, `PLACEHOLDER_CONTENT`, `CLOSES_AT_NOT_FUTURE`. One confirmed transition per run | G4 |
| Close | Doc 12 §§29–33, 216 | `jobs:close` | PUBLISHED → CLOSED with `--confirm-lifecycle`, and closesAt effects are confirmed too | none |
| Permitted reopen | Doc 12 §§34–36, 217. Doc 10 §58: CLOSED → PUBLISHED only, with readiness revalidation; `publishedAt` kept | `jobs:publish` | CLOSED → PUBLISHED with the same readiness checks | The G4 rule applies automatically through revalidation |
| Archive | Doc 12 §§37–39, 218. Doc 10 §69: terminal, no hard delete with recruitment history | `jobs:archive` | ARCHIVED is terminal (`ARCHIVED_IS_TERMINAL`) | none |
| Linked Applications preserved | Doc 10 §§75–78, 136–138: `jobId` plus an immutable `jobSnapshot`. Doc 12 §§42–43: a material change means close and create a new Job | — | `MATERIAL_FIELDS` with `--confirm-material-change` when Applications exist | G8, G9 |
| Audit history | Doc 12 §§207–210: `JOB_CREATED`…`JOB_ARCHIVED`, safe metadata. Doc 10 §§141, 147–151: AuditEvent, Phase 3. Doc 11 §§198, 201: immutable | `audit:read` (ADMIN_OWNER) | No AuditEvent in Phase 1. The record is the operator's `plan`/`apply` output and the version-controlled definition file | none: a country change is a `JOB_UPDATED` |
| Public effect | Doc 18 §234. Doc 12 §§30, 38. Doc 11 §160: the public and admin Job APIs are separate | — | The public DTO and pages read the stored Job | G5–G7 |

**No new role or permission is needed.**
- The countries are edited under `jobs:update`.
- They are validated at `jobs:publish`, including on reopen.
- Both RECRUITMENT_ADMIN and ADMIN_OWNER hold these permissions (Doc 11 §151).

## 3. Gaps and the smallest proposed amendment for each

Each amendment follows Doc 00 §5 and Doc 18 §364:
1. identify the affected documents;
2. record a superseding decision;
3. update the canonical text;
4. assess the roadmap.

| ID | Area | The gap today | Smallest proposed amendment (PROPOSED) | Affected document | Approval needed |
| --- | --- | --- | --- | --- | --- |
| **G1** | Job model | Doc 10 §19 has no field for the countries a role may be performed from. `location` (§§24–28) is one place with one `countryCode`, required before publication (§§25–26), so it cannot carry several countries without changing its meaning | **One new Job field**, e.g. `eligibleWorkCountries`: an array of ISO 3166-1 alpha-2 codes, uppercase, unique, in entry order, with a documented maximum (proposed 50). Plus one sentence in §24: `location` presents where the role is based or advertised and **never establishes eligibility** (R2) | Doc 10 §§19, 24 (and the planning data in §70) | Owner: schema |
| **G2** | Controlled provisioning | The strict definition schema (`jobDefinitionSchema`) has no such key. `CONTENT_FIELDS`, `AWAITABLE_FIELDS` and `MATERIAL_FIELDS` lack it. Today only `location` can be declared AWAITING, and it is | Add the key to the definition schema and to `CONTENT_FIELDS`, which also makes it awaitable; add it to `MATERIAL_FIELDS`, the content comparison and the G4 readiness rule. This is **one** code change. Afterwards, each vacancy's countries are data in its definition file, applied by the CLI, with **no code change per advertisement** | Doc 10 (schema); Doc 12 §§46–47 and Doc 15 §§171–175 need no text change | Authorised milestone for the code |
| **G3** | Admin editing (E3) | Doc 12 §§211–214 and Doc 09 §172 define the admin create and update APIs, but their exact contracts are "finalized with Documents 10–12 before Phase 3 implementation". None lists this field | Include the field in the E3 create/update contract (`POST`/`PATCH /api/v1/admin/jobs…`), with the G4 validation and the G8 rule. The Admin form offers a country multi-select from an ISO 3166-1 list. **That list is not the 21-country regional selector**, which would derive eligibility from the selector (R2) | Doc 12 §§213–214; Doc 09 §172; the E3 UI | Owner: E3 contract |
| **G4** | Validation | Readiness (Doc 10 §64, Doc 12 §25) and reopen (§35) do not cover the countries, and nothing forbids deriving them | **Readiness:** a FULLY_REMOTE Job needs at least one eligible work country before PUBLISHED and on every reopen. **Values:** each code must be a real ISO 3166-1 alpha-2 code, checked against a list and not only `^[A-Z]{2}$`, with no duplicates. **No server default:** never copied from `location.countryCode`, a visitor region, a market or anything else. **Draft:** may be empty (§65). For a FULLY_REMOTE Job, `location.countryCode` becomes optional, because the work countries replace it | Doc 10 §§64–65; Doc 12 §§25, 35, 214–217 | Owner |
| **G5** | Public DTO | The public Job DTO (Doc 09 §§54, 63) exposes `location` as one display string. `job.mapper.js` drops `countryCode` and `regionCode` | **One additive, read-only field** on the public list and detail DTOs, e.g. `eligibleWorkCountries: ["XX", …]`. It is `[]` when it does not apply (predictable shape, §186). Additive is compatible within `/api/v1` (§§180–181), but it is still a **public contract change** | Doc 09 §§54, 63, 186 | Owner: public API change (not authorised this round) |
| **G6** | Visible copy | Doc 06 §§97–98 have no label or value for the countries. Doc 05 §92's visitor asks "Where is it? Is it remote?". Google requires "All information in the markup must be visible on the job page" | **One Doc 06 §97 label and one §98 value pattern.** Proposed label: "Eligible Work Countries", with the country names as the value. Also decide whether the Careers row (§87) shows it. **The wording is the owner's.** Google also requires "the job description must clearly state that the job is 100% remote": the approved description should say so | Doc 06 §§87, 97–98 | Owner: copy |
| **G7** | JobPosting | Doc 16 §131 requires `TELECOMMUTE` and accurate applicant-location requirements. §132 ties them to "British Columbia, Canada", which OD-2026-11-09-01 supersedes. The code withholds the markup (`NO_APPLICANT_ELIGIBILITY`) and has no location properties | **§132 becomes:** "applicant location requirements equal the vacancy's approved eligible work countries, as displayed on the Job page". **Mapping:** `jobLocationType: "TELECOMMUTE"` plus `applicantLocationRequirements: [{ "@type": "Country", "name": … }]`, emitted only when the DTO field is non-empty **and** shown on the page. Google: "You must specify a minimum of one country", and "jobLocation … isn't required if applicantLocationRequirements is present". **Validate** with current tooling before publication (§137) | Doc 16 §§131–132 | Owner; implementation after G5 and G6 |
| **G8** | Material change | Doc 12 §41 and `MATERIAL_FIELDS` list `location`, but not the work countries | Add "eligible work countries" to §41's list. §42 then applies: close the Job and create a new one, unless the change is a correction | Doc 12 §41 | Owner |
| **G9** | Application snapshot | `jobSnapshot` (Doc 10 §77) keeps title, slug, location, arrangement, type, schedule, hours and pay, but not the countries. An Application would not show which countries were advertised | Add the field to `jobSnapshot`. It is immutable under §§78 and 138 | Doc 10 §77; Doc 12 §43 | Owner |
| **G10** | External consistency | Doc 12 §176, Doc 18 §250 and Doc 02 §62 list location and the remote arrangement, but not the countries | Add "eligible work countries" to each list | Doc 12 §176; Doc 18 §250; Doc 02 §62 | Owner |
| **G11** | Release A regional model (frontend only) | `markets.js` and `resolveJobMarketPresentation.js` accept an optional `hiringMarkets` per Job, described as "where a Job may actually be filled". **No backend field feeds it**, so no real Job has it, and its JobPosting is withheld (`REGIONAL_PRESENTATION`). It overlaps BR-ELIG-01 and could be mistaken for an eligibility source | Proposed: keep `hiringMarkets` **presentation-only**, as regional location and pay display, and reword its comments when G1/G5 land. Eligibility is then shown only from the new field. The alternative is to retire it. **No runtime change now** | The frontend specification / Release A record | Owner |

**Not gaps:**
- **Audit:** a change is a `JOB_UPDATED`. The country codes are not personal data.
- **Permissions:** §2.
- **The 21-country selector:** it is preserved unchanged, as R2 requires.
- **Close and archive:** unchanged.

## 4. Requirement versus design

| Approved (business) | Proposed (design, for approval) |
| --- | --- |
| Per-vacancy eligible remote-work countries | The field name `eligibleWorkCountries`, the ISO 3166-1 alpha-2 type, the maximum, uniqueness and order |
| Maintained by authorised admins | Through `jobs:update` and `jobs:publish`; the E3 contract and form; the G2 definition key for the interim |
| No code change per advertisement | Data in the Job record: the definition file before E3, the Admin form after E3 |
| Never derived from the selector, `location`, a publication market, nationality or the occupational reference | No server default; validation against an ISO list, not the selector; the G11 rewording |
| OPEN for the first vacancy | `location` declared AWAITING INPUT in the Draft (done locally, §6) |

## 5. Until E3: controlled provisioning, and what the roadmap allows

### 5.1 What the roadmap permits for an initial website vacancy

- **Mechanism.** Before Recruitment Admin exists, Job records are kept through a controlled server-side mechanism (Doc 12 §§46–47; Doc 15 §§171–175; Doc 18 §§109–110, B3). The planned vacancy exists as a DRAFT definition. It stays DRAFT until approved content exists (Doc 12 §45), which now includes the work countries.
- **Release C value.** Doc 18 §145 says that after Release C a visitor can "see real open Job → open Job Detail → Apply". Release C therefore presumes that a real open Job can be live on the website.
- **Truth rules.** Doc 02 §48: "Do not publish a vacancy until the vacancy is genuinely authorized for recruitment". §51: "We are hiring" only when the vacancy is actually open.
- **Gates that apply whenever the genuine vacancy is first published, on any channel:**
  - Doc 12 §§25, 45: readiness and approved content;
  - Doc 06 §§169, 178: the privacy and legal publication gates, "before public deployment";
  - Doc 13 §313: the Phase 1 security gate;
  - Doc 18 §180: backup "before meaningful real candidate data accumulates";
  - Doc 18 §384: real candidate data only after the production, security and privacy gates;
  - Doc 16 §137: structured-data validation before publication, if a JobPosting is emitted.

### 5.2 What belongs to the external recruitment launch (E6)

- Doc 18 §182: external recruitment does not launch until the Release D/E prerequisites are met.
- Doc 18 §218: the E entry gate, which includes "real approved vacancy content".
- Doc 18 §§246–252:
  - "Real Job must be complete and approved";
  - "Publish real vacancy";
  - LinkedIn / Indeed → Job Detail → Apply;
  - external consistency;
  - current platform checks.
- Master Prompt §13 and Doc 12 §4: "Phase 3 adds real vacancy publication". Doc 12 §263: the Phase 3 gate starts with "real vacancy is Published".

### 5.3 The sequencing question

**Exact clauses.** Doc 18 §145 (Release C) presumes a real open Job on the website. Master Prompt §13, Doc 12 §4 and Doc 18 §248 place "publishing the real vacancy" in Phase 3 / E6. The documents do not say which applies to the genuine Cybersecurity Specialist vacancy on the website before E6.

**Smallest decision (SEQ-1):** *May the genuine vacancy be PUBLISHED on the Valida website, through controlled provisioning, after Release C is verified (C7) and the §5.1 gates pass, before E6, with LinkedIn/Indeed advertising still waiting for E6?*

- **Yes:** amend Doc 18 §248 to "Publish the real vacancy, or confirm the one already published on the website under SEQ-1, and verify it against §250".
- **No:** read §145 as a capability. C7 then proves the chain without a genuine public vacancy, and the method is decided at C7.

**Either way:**
- the release order C5 → C6 → C7 → D → E stays;
- E6 stays the external launch;
- no gate is relaxed.

**A consequence for the decision.** Applications received before E4 could not be reviewed through the documented secure path:
- the resume-release gate (Doc 11 §174; Doc 18 §237) needs a `CLEAN` scan state;
- notifications never attach resumes (Doc 09 §§189–190);
- there is no Admin resume access before E4.

### 5.4 Preview before E3

Doc 12 §22's protected preview is Phase 3. Before E3, the owner could review the Draft's public presentation in the separate, noindexed Review environment (Doc 18 §177; Doc 16 §82). That is **PROPOSED** for C6. Today `plan` is the only preview.

## 6. The interim guard applied in C4 (local, `c4-work`)

- **The Draft.** `backend/provisioning/jobs/cybersecurity-specialist.json` keeps its stored values. It declares `location` **AWAITING INPUT**, and its notes cite OD-2026-11-09-01. Publication is refused with `AWAITING_INPUT` even if every other field were filled (`backend/tests/jobs-provisioning.test.js`). It was not provisioned anywhere except the existing B3 real-database test, which loads it into a disposable `valida_test_*` database and asserts that it stays DRAFT and returns 404 publicly.
- **The JobPosting.** It stays withheld for fully remote Jobs (`NO_APPLICANT_ELIGIBILITY`). The visible Job Detail and Apply are unchanged.
- **The public API.** Unchanged.
