# Owner decision OD-2026-11-21-01 — SA-1: E1–E5 may be built and tested locally before Release C is VERIFIED

| | |
| --- | --- |
| Identifier | **OD-2026-11-21-01**, the next free identifier after [OD-2026-11-15-01](OWNER_DECISION_2026-11-15-01_C6_T1_RECRUITMENT_MODE.md). No identifier is reused |
| Date | 2026-11-21 |
| Decided by | Saeed (owner), under Doc 00 §5 change control (source hierarchy level 1: an explicit approved change) |
| Source | The owner's instruction of 2026-11-21: "I approve SA-1. Record this narrow sequencing change under Doc 00 and start E1–E5 now…", in reply to `docs/operations/COMPLETE_LAUNCH_REQUEST_2026-11-21.md` §2 |
| Baseline | `main` = `2b39e8e799329428f0f68b4fb70f88f85c6eda69` (RG accepted, act I done on 2026-11-21) |
| Recorded against | **Doc 18** §188 ("Do not build before C complete": *full Admin*) and §218 (Release E entry gate) |
| Scope rule | **Only §2 is decided.** It authorises local development and testing on a feature branch, CI within its free allowance, a push of that branch and one review pull request. It does **not** authorise Production spending, a merge to `main`, any deployment, a DNS change or public activation; each needs its own authorisation |
| Recorded by | Claude, on the local branch `e-work` |

## 1. Why

Doc 18 §188 forbids "full Admin" work before Release C is VERIFIED, and Release C needs C7 in a paid Production. Followed literally, Production would run and cost money while Admin code was still being written. The owner's goal is one complete public launch with recruitment fully operational, at the lowest sustainable cost.

## 2. Decision (SA-1)

> Milestones **E1–E5** may be **implemented and tested locally and in CI** before Release C is VERIFIED. They may not be deployed to any hosted environment, use Production data or be publicly exposed until the **unchanged** Release E entry gate (Doc 18 §218) is met: Release C VERIFIED, Release D sufficiently operational, real approved vacancy content, canonical Job URL, real Careers mailbox and real Apply. The Doc 11 and Doc 17 requirements, tests and evidence for E1–E5 are unchanged. E6 and E7 stay in order.

1. **Data.** Only synthetic data is used: local disposable databases and CI's service container. No Review or Production database is touched.
2. **Release gates unchanged.** Release C (C7), the Release E entry gate, E6, E7 and the single complete public launch stay as Doc 18 states them.
3. **Nothing is VERIFIED by this decision.** E1–E5 code may reach IMPLEMENTED with local test evidence. VERIFIED still needs the hosted evidence Doc 18 §§225 and 237 require, after the entry gate.

## 3. Doc 00 synchronisation

The authoritative register is Doc 00 (`00_DOCUMENT_REGISTER.md`; held by the owner as `00_Valida Document Register.docx`). It is outside this repository, and the copy this environment can reach is read-only. So:

- **Done in this repository:** this record.
- **Not done, and not claimed:** the entry in Doc 00. **Adoption there is not verified.**

**The exact entry for Doc 00.** Destination: §30 Central Delivery Tracker, as a note to the "Recruitment Console" and "Candidate Management" rows, and wherever the owner keeps the canonical revision log.

> **OD-2026-11-21-01 (SA-1), 2026-11-21.** Authority: §5 Change Control; source hierarchy level 1.
> Doc 18 §188 is amended for Release E milestones **E1–E5 only**: they may be implemented and tested **locally and in CI** before Release C is VERIFIED. No hosted deployment, Production data or public exposure is permitted until the unchanged Release E entry gate (Doc 18 §218) is met. Doc 11/17 requirements and evidence, E6, E7 and every other §188 item are unchanged.

## 4. What stays open

| Item | State | Where |
| --- | --- | --- |
| Doc 00 entry (§3) | Not verified | The owner's canonical collection |
| Release C (C7) | Not started; needs Production (spending authorisation) | `COMPLETE_LAUNCH_REQUEST_2026-11-21.md` §4 |
| Release E entry gate (§218) | Not met | Doc 18 |
| E1–E5 VERIFIED | Not claimed; hosted evidence after the entry gate | Doc 18 §§225, 237 |
