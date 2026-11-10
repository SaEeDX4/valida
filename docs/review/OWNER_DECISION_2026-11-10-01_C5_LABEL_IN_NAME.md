# Owner decision OD-2026-11-10-01 — C5: accessible names that contain their visible labels (WCAG 2.5.3)

| | |
| --- | --- |
| Identifier | **OD-2026-11-10-01**, the next free identifier after [OD-2026-11-09-03](OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md). No identifier is reused |
| Date | 2026-11-10 |
| Decided by | Saeed (owner), under Doc 00 change control: a narrow, explicit approval of three accessible names in Doc 06 |
| Source | The owner's instruction "Valida C5 — Focused QA corrections and README reconciliation" (2026-11-10), item 1, answering **OD-C5-1** of [`docs/qa/C5_INTEGRATED_SITE_QUALITY.md`](../qa/C5_INTEGRATED_SITE_QUALITY.md) |
| Baseline | `c5-work` at `6487968a224557228be09957e090d549afc8b17f` |
| Scope rule | **Only these three accessible names are decided here.** Visible labels stay exactly as they are. Everything else in Doc 06 keeps its status |
| Recorded by | Claude, on local `c5-work`. Nothing is pushed |

## 1. The finding (C5, O1)

Three accessible names did not contain their visible labels (WCAG 2.2 SC 2.5.3 Label in Name, Level A; Doc 16 targets WCAG 2.2 AA). A speech-input user who says the visible words may not reach the control. axe-core's experimental rule and Lighthouse 13.6.0 both flagged them (C5-06, C5-19).

## 2. Decision

| Control | Visible label (unchanged) | Accessible name **before** (Doc 06) | Accessible name **approved** |
| --- | --- | --- | --- |
| Mobile menu toggle | Menu | "Open navigation" / "Close navigation" (§9) | **"Menu"**, with `aria-expanded` carrying the open/closed state |
| Careers role link | The title, its facts and "View Role" | "View {job.title} role" (§87) | **"View Role: {job.title}"** |
| Apply back link | Back to Role | "Back to {job.title}" (§110) | **"Back to Role: {job.title}"** |

**Unchanged:** the visible text of each control, its destination, the `aria-controls`/`aria-expanded` relationship of the toggle, and every other string.

## 3. Canonical-document synchronization still needed

The implementation follows this decision. The canonical documents still carry the old names until they are amended under Doc 00:

| Document | Section | Current text | Needs to read |
| --- | --- | --- | --- |
| Doc 06 | §9 Mobile navigation | "Accessible expanded label: Open navigation / Close: Close navigation" | "Menu button: Menu. Accessible name: Menu; the open/closed state is conveyed by `aria-expanded`" |
| Doc 06 | §87 Job card / row labels | "Accessible link pattern: View {job.title} role" | "Accessible link pattern: View Role: {job.title}" |
| Doc 06 | §110 Apply — back link | "Accessible: Back to {job.title}" | "Accessible: Back to Role: {job.title}" |

**No conflict found elsewhere:**
- Doc 05 §19 ("descriptive menu button label; `aria-expanded`") is met by "Menu" with `aria-expanded`.
- Doc 05 §88 ("each job has unique accessible link name") is met: each name carries the job title.
- Doc 16 §28 uses "Open Mobile Menu → close menu" only as an example of focus restoration, not as label copy.
