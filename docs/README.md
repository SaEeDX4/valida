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

The canonical documents 00-18 are maintained outside the repository. Copying
them in is a documentation decision for Saeed, not an implementation
requirement.

The QA matrix records what must be checked by a person. Until it is executed it
is a checklist, not evidence — consistent with the rule above.
