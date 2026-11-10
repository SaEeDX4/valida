# docs/

Repository documentation directory.

Declared in the canonical repository structure:
- `07_TECHNICAL_ARCHITECTURE.md` section 12
- `15_DEVOPS_DEPLOYMENT.md` section 18
- `18_IMPLEMENTATION_ROADMAP.md` section 24

## Purpose

May hold copies of the canonical engineering documents (00-18) or
developer-facing implementation notes.

## Rule

Documentation must not replace executable behaviour
(`07_TECHNICAL_ARCHITECTURE.md` section 12). A document describing a feature is
never evidence that the feature works.

## Status

| Document | Purpose | Milestone |
| --- | --- | --- |
| [`A6_WINDOWS_QA_MATRIX.md`](A6_WINDOWS_QA_MATRIX.md) | The browser, device, screen-reader, zoom, reduced-motion and Lighthouse checks that automated tests cannot perform, with setup steps and result tables | A6 |
| [`privacy/DATA_INVENTORY.md`](privacy/DATA_INVENTORY.md) | The personal-data and provider inventory entries for recipient suppression (SUP-6; Doc 13 §§197–198). Undecided production inputs are marked AWAITING INPUT | B7 |
| [`seo/C4_SEO_IMPLEMENTATION.md`](seo/C4_SEO_IMPLEMENTATION.md) | How the public routes reach crawlers: configuration, statuses, heads, JobPosting mapping, sitemap and robots; what is deferred to the production host (C6); open owner decisions | C4 |
| [`privacy/C4_PRIVACY_LEGAL_CHECK.md`](privacy/C4_PRIVACY_LEGAL_CHECK.md) | The Privacy Notice and Legal page compared with the implemented system, claim by claim (Doc 18 §166); open items for the publication gates | C4 |
| [`review/OWNER_RECORD_2026-11-07_C3_ACCEPTANCE.md`](review/OWNER_RECORD_2026-11-07_C3_ACCEPTANCE.md) | The owner's acceptance of C3 at `f07ea35`, with the four states kept separate | C4 |
| [`review/OWNER_RECORD_2026-11-07_C3_PUBLICATION.md`](review/OWNER_RECORD_2026-11-07_C3_PUBLICATION.md) | The authorised push of `f07ea35` to `refs/heads/c3-work`: pre-flight, push, post-flight, fresh-fetch verification | C4 |
| [`review/OWNER_DECISION_2026-11-07-01_C4_DATE_LABELS.md`](review/OWNER_DECISION_2026-11-07-01_C4_DATE_LABELS.md) | OD-2026-11-07-01: the Job Detail labels "Date Posted" and "Applications Close", and how they are shown | C4 |
| [`review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md`](review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md) | OD-2026-11-09-01: the first vacancy (international audience, work countries OPEN), the canonical origin `https://cybervalida.com`, the Doc 06 titles against Doc 16 §85, the social-card preview, and requirement BR-ELIG-01 | C4 |
| [`review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md`](review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md) | OD-2026-11-09-02: the approved social card integrated in Open Graph (final visual sign-off pending), and the optional eligible remote-work countries field | C4 |
| [`review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md`](review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md) | OD-2026-11-09-03: the eligibility implementation and its label approved; social card revision 2 and the social-sharing copy (final visual sign-off pending); SEQ-1 closed — the first genuine vacancy only after the Release E gates, including E6 | C4 |
| [`review/OWNER_RECORD_2026-11-10_C4_ACCEPTANCE.md`](review/OWNER_RECORD_2026-11-10_C4_ACCEPTANCE.md) | The owner's final acceptance of C4 at `2193433`, with Social Card Version 2 (`c86554a2…c2a5`) and its revised preview; the four states kept separate | C4 |
| [`review/VALIDA_GITHUB_CONSOLIDATION_AND_RETURN_TO_C5_CHECKPOINT.md`](review/VALIDA_GITHUB_CONSOLIDATION_AND_RETURN_TO_C5_CHECKPOINT.md) | VALIDA — GitHub Consolidation and Return to C5 Checkpoint: the return baseline (this checkpoint, once verified at `refs/heads/main`), the status of the paused assignment, and the preserved C5 assignment | C4 → C5 |
| [`qa/C5_INTEGRATED_SITE_QUALITY.md`](qa/C5_INTEGRATED_SITE_QUALITY.md) | C5 integrated site quality: environment, method, findings by severity (four fixed with before/after evidence), results by requirement, lab performance, owner decisions OD-C5-1–4, and the manual checklist (open) | C5 |
| [`recruitment/ELIGIBLE_WORK_COUNTRIES_CONTRACT.md`](recruitment/ELIGIBLE_WORK_COUNTRIES_CONTRACT.md) | The field's contract delta by layer, the canonical-document clauses with wording pending synchronisation, and how Release E will manage it | C4 |
| [`recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md`](recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md) | BR-ELIG-01 traced to the Job lifecycle (Doc 12, Doc 18 E3/E6); the gaps, each with its smallest PROPOSED amendment and its status; the website-versus-E6 sequencing question SEQ-1, closed by OD-2026-11-09-03 | C4 (analysis for E3/E6) |
| [`brand/social-card-preview/README.md`](brand/social-card-preview/README.md) | The 1200 × 630 social card: source, inputs, rendering command, both revisions' checksums, the revision 2 spacing measurements and approved alt text; its integration (OD-2026-11-09-02/-03). Revision 2 approved with C4's acceptance | C4 |

The canonical documents 00-18 are maintained outside the repository. Copying
them in is a documentation decision for Saeed, not an implementation
requirement.

The QA matrix records what must be checked by a person. Until it is executed it
is a checklist, not evidence — consistent with the rule above.
