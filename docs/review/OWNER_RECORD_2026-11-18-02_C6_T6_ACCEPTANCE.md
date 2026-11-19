# Owner record 2026-11-18 (second): C6-T6 accepted (local)

| | |
| --- | --- |
| Date | 2026-11-17 23:01 America/Vancouver = 2026-11-18T06:01Z |
| Decided by | Saeed (owner), after Astra's independent review of the C6-T6 packages, including the audit-gate correction |
| Source | The owner's instruction "Valida — record C6-T6 acceptance and finalize the hosting assignment" |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed. This record is documentation only |
| Governing | Doc 00 §5 (change control); Doc 17 (review evidence); Doc 18 C6 (§§176–180); C6 plan revision 3 with correction 1 |
| Not an owner-decision identifier | No new `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. Accepted

| | |
| --- | --- |
| **Accepted commit** | **`aa92ed545d47bad73c2b26ead519807ad2443e17`** |
| **Accepted tree** | **`511607ae6ca8f04e3f946a23b0c3759fd96073b9`** |
| Scope | C6-T6 as authorised in owner record 2026-11-17-02 §4 and owner records 2026-11-17-03 and 2026-11-18-01: <br>- Sentry error monitoring in the API and the document server (D-4a); <br>- the hourly résumé copy, the snapshot manifest, the deletion log and the restore gate (D-9); <br>- the CI and backup workflows, **not activated**; <br>- the read-only review-host checker; <br>- the runbooks; <br>- the authorised-deletion correction; <br>- the dependency remediation (`mongoose` 9.11.4; the patched frontend tooling); <br>- the `mongo:8.0` digest pin; <br>- the dependency audit gate with the approved, time-limited exception for GHSA-fc5q-39xc-vjpf; <br>- the gate's fail-closed correction |
| Commits | `13bf1a5` … `aa92ed5` on top of the accepted C6-T5 commit `2a1ec6f` (17 commits, each signed; listed in the T6 handoffs) |
| Records | `C6_T6_MONITORING_CI_CHECKER_BACKUP.md` (task record); the three runbooks in `docs/operations/`; owner records 2026-11-17-02, 2026-11-17-03 and 2026-11-18-01 |
| Evidence | The review packages `c6-t6` (T6), `c6-t6-r1` (correction 1), `c6-t6-r2` (CI remediation), `c6-t6-r3` (final CI correction) and `c6-t6-r4` (audit-gate correction). Each is kept unchanged, with its own checksums |
| Independent verification | Astra verified the signatures (36), the ancestry, the tree and the checksums, and ran the gate controls |

## 2. What this acceptance is, and what it is not

| | Status |
| --- | --- |
| **Local C6-T6** (code, local tests and evidence, workflow files, runbooks) | **ACCEPTED** at `aa92ed5` |
| Hosted verification: <br>- the first GitHub Actions run; <br>- the Review deployment; <br>- G-ACCESS (R0) and R1–R14; <br>- Sentry delivery and the alert; <br>- the real-provider storage checks; <br>- the backup copy, manifest and restore rehearsal on a real provider; <br>- the bounded live-email checks; <br>- Safari on real devices | **NOT DONE.** Each needs its own authorisation (hosting assignment) |
| **Completion of C6** (Doc 18) | **NOT COMPLETE.** C6 completes only after the hosted gates pass, the owner accepts the Review/release SHA, and `main` is integrated and the Production stages run, each separately authorised |
| Activation of any workflow, the `backup` environment, the backup schedule, any provider resource | **Not authorised** by this record |

The approved audit exception continues on its own terms:
- It runs until **2026-12-18T05:31:00Z** and is never extended automatically.
- A CI run at or after that time fails unless the exception has been removed or re-decided (owner record 2026-11-18-01).

## 3. Canonical-document adoption: tracked separately

The authoritative Documents 00–18 are not held in this repository, so this record cannot update them. The proposals below remain **proposals under Doc 00 §5** until the owner adopts them into the authoritative collection.

| Source | Proposal | Status |
| --- | --- | --- |
| T1–T5 records (`C6_T1…`–`C6_T5…`, "proposed canonical entries") | The recruitment-mode, Jobs and cache, private-Review, storage and CSP/release-header entries | **Not adopted**: tracked as in the T5 acceptance record §1 and §5 |
| T6 task record §6 | Doc 15: `SENTRY_DSN`; the `BACKUP_*` variables, the protected `backup` environment, the four role tokens and the read-only manifest user | **Not adopted** |
| T6 task record §6 | Doc 13 §213: the monitoring event allowlist; the backup role boundary | **Not adopted** |
| T6 task record §6 | Doc 17 QA-085–088: the copy, manifest and rehearsal evidence | **Not adopted** |
| Owner record 2026-11-18-01 | Doc 13 §310 risk acceptance for GHSA-fc5q-39xc-vjpf (time-limited) | **Recorded here only**; it is not a canonical change |
| Titan amendments (`B6_TITAN_AMENDMENTS.md`) | The Doc 14 entries | As recorded there |

## 4. Unchanged

- **No new implementation is authorised.**
- **Outside this record:**
  - publication, pull requests and workflow dispatch;
  - purchases, provisioning, deployment, DNS and live email;
  - repository settings;
  - changes to the Windows workspace (`C:\ME\Valida`).
- Production candidate acknowledgements stay disabled. The genuine vacancy stays Draft through E6.
- The hosting-stage assignment is a **proposal** (`docs/operations/C6_HOSTING_STAGE_ASSIGNMENT.md`). Each of its acts needs its own written authorisation.
