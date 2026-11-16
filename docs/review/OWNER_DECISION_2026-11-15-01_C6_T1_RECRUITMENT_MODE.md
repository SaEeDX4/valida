# Owner decision OD-2026-11-15-01 — C6-T1: a recruitment mode in the API that is closed unless configured

| | |
| --- | --- |
| Identifier | **OD-2026-11-15-01**, the next free identifier after [OD-2026-11-10-01](OWNER_DECISION_2026-11-10-01_C5_LABEL_IN_NAME.md). No identifier is reused |
| Date | 2026-11-15 |
| Decided by | Saeed (owner), under Doc 00 §5 change control |
| Source | The owner's instruction of 2026-11-15 authorising "local C6-T1 only", after Astra's review of the C6 plan, revision 3, §4.6.1 |
| Baseline | `e2c7ce74a4555f38f1d40810016718a92ce2fa7e` — GitHub `main` and `c5-work`; the C5 acceptance record |
| Recorded against | **Doc 13** (security: access control on public endpoints) and **Doc 15** (deployment: environment configuration) |
| Scope rule | **Only what §2 lists is decided.** It authorises local implementation and testing. It authorises no push, merge, deployment, provisioning, DNS change, live email or vacancy publication, and no further C6 task |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |

## 1. Why

Through Release C the public API served every published Job to everyone: publication was the only switch. Three things in C6 and C7 need a second one.

- A hosted Review environment and Production are on the public internet, and each needs synthetic Jobs for testing. No visitor may see or apply to them.
- The genuine vacancy stays Draft until the Release E gates, including E6. Opening recruitment must then be a deliberate act, not the absence of a setting.
- Doc 15 requires separate, explicit environment configuration; Doc 13 requires that a control fail safely.

## 2. Decision

**The API has an explicit recruitment mode, and anything that is not exactly right means closed.**

| Mode | Jobs list | Job Detail | Application submission |
| --- | --- | --- | --- |
| `closed` | an empty page, for everyone | the unknown-Job answer | the unknown-Job answer, **before the request body is read** |
| `testers` | the accepted behaviour for a client whose address is in `ACCESS_ALLOWLIST`; `closed` for everyone else | the same | the same |
| `public` | the accepted behaviour, for everyone | the same | the same |

1. **Configuration.** Three environment variables, read by the backend:
   - `RECRUITMENT_MODE` — exactly `closed`, `testers` or `public`;
   - `ACCESS_ALLOWLIST` — addresses or CIDR ranges, IPv4 and IPv6, comma-separated; used only by `testers`;
   - `RECRUITMENT_PUBLIC_AUTHORISATION` — the identifier of the owner decision that opens recruitment, in the form `OD-YYYY-MM-DD-NN`; required by `public`.
2. **Closed unless proven otherwise.** The effective mode is `closed` when `RECRUITMENT_MODE` is absent, empty, misspelt, in the wrong letter case or padded; when `testers` has no list or a list with any invalid entry; when `public` is set outside `APP_ENV=production`; or when `public` has no well-formed authorisation. A check that fails for one request answers that request as `closed`.
3. **A wrong value does not stop the backend.** The site's other endpoints keep working; recruitment is shut; one start-up log line states the effective mode and a fixed reason code.
4. **The Job lifecycle is not changed.** The mode is a condition in front of the accepted rules (Doc 09 §§48–70, 77–78, 186–190). A client that is let through gets exactly what it got before: open, closed, Draft, archived and not-yet-published Jobs behave as accepted.
5. **A refused submission does no work.** It is answered before body parsing, before a temporary file is created, before a résumé is stored, before any database read or write and before any notification.
6. **A tester can be told apart before any Job exists.** Jobs responses to a listed client in `testers` mode carry `X-Valida-Audience: tester`. No one else receives it.
7. **Nothing private is written.** Tester addresses appear in no log line, error message or serialised configuration; only their number is reported. A rejected value is never echoed.
8. **Opening recruitment to the public** is a later act with its own authorisation: after the E6 gates, with a new owner-decision identifier in `RECRUITMENT_PUBLIC_AUTHORISATION`. This record does not authorise it, and its own identifier must not be used for it.

**Unchanged:** the Job and Application models; every documented response body, status and message (Doc 09; Doc 06); the accepted middleware order apart from the one added step; rate limits; CORS; the notification and suppression rules. **Production candidate acknowledgements stay disabled** (refused at start-up while G-SUP is unmet). The genuine vacancy stays Draft.

## 3. Two details settled in implementation — for the reviewer

Both are narrower than the plan's text, in the closed direction.

| Detail | What was built | Why |
| --- | --- | --- |
| The broadest range an allowlist entry may cover | An IPv4 prefix shorter than `/8` or an IPv6 prefix shorter than `/16` makes the whole list invalid, and so the mode `closed` | `0.0.0.0/0` would make `testers` mean "everyone" — public by another name, without the decision identifier that `public` requires |
| A scoped address such as `fe80::1%eth0` | Not an address: never listed, and invalid in the list | A zone names an interface of the server, not a client |

## 4. Canonical-document synchronisation still needed

The implementation follows this decision. The canonical documents do not yet describe it; under Doc 00 §5 they are amended by the owner. Proposed entries:

| Document | Where | Proposed addition |
| --- | --- | --- |
| **Doc 15** | Environment variables; the Review and Production environment tables | The three variables of §2.1 with their rule: "Recruitment is closed unless `RECRUITMENT_MODE` is exactly `testers` (with a valid `ACCESS_ALLOWLIST`) or `public` (production only, with `RECRUITMENT_PUBLIC_AUTHORISATION`). Review uses `testers`. Production uses `closed`, `testers` for an authorised test, and `public` only after the E6 gates" |
| **Doc 13** | Public-endpoint controls; fail-safe defaults | "Access to the Jobs list, Job Detail and application submission is governed by the recruitment mode. An invalid or absent configuration denies access. A denied submission is refused before its body is read. Tester network addresses are configuration, never logged" |
| **Doc 00** | §30 Central Delivery Tracker; the change log of §5 | A change-control entry naming this record, the two documents above, and the status "implemented locally at C6-T1; hosted verification pending" |
| Doc 09 | — | **No change.** No endpoint, request, response, status or message is added or altered. `X-Valida-Audience` is a diagnostic response header for testers; if the owner wants it in Doc 09, that is a one-line addition |

**Status of the canonical entries: NOT MADE from this environment.** Docs 00, 13 and 15 are held in the owner's canonical collection, which is read-only here. Until the owner adds them, this record and `backend/README.md` are the description of the control.

## 5. What this record does not decide

- How the frontend document server restricts pages, forwards a client address or sets cache headers (C6-T2).
- How a trusted client address is established behind a real hosting proxy. Locally the API uses the address Express derives under the existing `TRUST_PROXY` setting; whether a host forwards addresses the way a hop count assumes is a hosted check (plan §4.6.3, §4.6.5).
- A private Review environment as a whole (`SITE_ACCESS`), providers, deployment, backups.
- Safari on real macOS and iOS devices: **OPEN**, on the C6 review host, due before C7 closes.

## 6. Implementation

`backend/src/config/recruitmentAccess.js` (the rules), `backend/src/middleware/recruitmentAccess.js` (the gate), and the three controllers. Tests: `backend/tests/c6-recruitment-config.test.js`, `backend/tests/c6-recruitment-http.test.js`, `backend/tests/db/c6-recruitment-api.test.js`. Description: [`backend/README.md`](../../backend/README.md), "Recruitment access (C6-T1)".
