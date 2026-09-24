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

The canonical documents 00-18 are maintained outside the repository. Copying
them in is a documentation decision for Saeed, not an implementation
requirement.

The QA matrix records what must be checked by a person. Until it is executed it
is a checklist, not evidence — consistent with the rule above.
