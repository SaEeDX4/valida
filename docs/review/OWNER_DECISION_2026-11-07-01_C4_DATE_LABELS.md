# Owner decision OD-2026-11-07-01 — Job Detail date labels (C4)

| | |
| --- | --- |
| Source | The owner's instruction "Valida — Publish accepted C1–C3 and complete the focused C4 corrections" (2026-11-07): "The owner approves the exact labels 'Date Posted' and 'Applications Close'." |
| Amends | Document 06 §97, Job Detail key labels. Two labels are added; the existing six are unchanged |
| Recorded by | Claude, in the C4 documentation commit on `c4-work` |

## Decision, as given

- **Labels.** The approved labels are exactly "Date Posted" and "Applications Close".
- **Date Posted** is displayed from the Job's actual `publishedAt`.
- **Applications Close** is displayed only for a valid, actual `closesAt`.
- **No closing date.** The entire closing-date row and the JobPosting `validThrough` property are omitted.
- **Consistency.** Visible dates and structured data stay consistent, including timezone handling.
- **Closed Jobs.** The accepted closed-Job behaviour is preserved.

## How it is implemented (implementation choices, recorded for review)

| Point | Choice | Reason |
| --- | --- | --- |
| Where | The **Employment Details** list of an **open** Job, after the six existing facts | It is the existing key-facts list (Doc 06 §97) |
| Closed Jobs | No date rows | A closing date on a closed page could contradict the closed state (Doc 12 §33); the accepted closed page stays unchanged |
| Timezone | Both dates are shown **in UTC**, the server time that decides whether a Job is open (Doc 12 §15). The deadline carries "UTC" | The page reads the same on every device and agrees with `datePosted` / `validThrough`, which carry the same instants |
| Format | "1 November 2026"; "31 March 2027, 23:59 UTC". The value is a `<time datetime="<instant>">` | This is the date style of Document 06 (e.g. "7 September 2026"); a deadline needs its time |
| Validity | Only an ISO 8601 instant with an explicit zone and in-range fields counts. Anything else shows no row and adds no property | A zoneless value would be read in the reader's local time; `Date.parse` rolls an impossible date over |

The time suffix (", 23:59 UTC") is presentation of the approved value, not new copy. If the owner prefers another timezone or format, only `formatJobDate` / `formatJobDeadline` in `frontend/src/features/jobs/utils/formatJob.js` change.
