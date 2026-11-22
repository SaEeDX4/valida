# Complete launch of cybervalida.com — consolidated owner request (2026-11-21)

| | |
| --- | --- |
| Goal (owner, 2026-11-21) | One public launch with recruitment fully operational: secure HR access, résumé scanning, tested recovery, working email |
| Base | `main` = `2b39e8e` (RG accepted, act I done). C6 Review and H2 all PASS (owner record §§1–5) |
| Superseded | §§3–5 by `LAUNCH_REQUEST_2026-11-22.md` (2026-11-22). PR #2 merged: `main` = `60bb58a` |
| Status | Prepared by Claude. **No spending, DNS change or public activation is authorised by this document.** The US$7/month proposal is on hold |

## 1. What blocks the goal

| Need | State | Blocker |
| --- | --- | --- |
| Secure HR access (E1 Admin auth, E2 shell) | **Not built.** The repo has no auth library, Admin model or admin routes | Doc 18 §188: no "full Admin" before Release C VERIFIED |
| Job and application management, résumé review (E3, E4) | Not built. Scan states `CLEAN`/`QUARANTINED`/`INFECTED` and the ClamAV cron image already exist and are CI-tested | Same; E4 §237 needs `CLEAN` before a résumé is opened |
| Status, notes, audit, communications (E5) | Not built | Same |
| Release C VERIFIED (C7 live end-to-end) | Not started | Needs Production (spend) |
| Tested recovery in Production | Flex-to-Flex restore VERIFIED in Review | Needs the Production Flex cluster, plus one rehearsal after its first +24 h snapshot |
| Working email | **Verified** (H2: Titan SMTP, delivered) | Render's free tier blocks SMTP, so the API needs a paid instance |
| Release D: DNS, `www` TLS, DMARC `rua=` | Prepared | Owner approval for DNS |
| Owner inputs: real vacancy (P-6), privacy contact (P-1), provider inventory and log retention (P-2, P-4), legal review (P-5) | AWAITING INPUT | Real candidate data must not be collected without them (business address in Lithuania: GDPR) |

## 2. Smallest sequencing change (for owner approval): SA-1

> **SA-1 (Doc 18 §188 amendment):** Milestones E1–E5 may be **implemented and tested locally and in CI** before Release C is VERIFIED. They may not be deployed to any hosted environment, use Production data or be publicly exposed until the unchanged Release E entry gate (§218) is met: Release C VERIFIED, Release D sufficiently operational, real approved vacancy content, canonical Job URL, real Careers mailbox and real Apply. Doc 11/17 requirements, tests and evidence for E1–E5 are unchanged. E6 and E7 stay in order.

Effect: Admin development starts now at **$0**, and Production is created only when Admin is ready, so no monthly cost runs while code is being written.

## 3. Lowest sustainable monthly cost for the complete site

Prices are from the Nov 19–21 Render and Atlas invoices. CAD is at **1.40** CAD/USD (recent quotes range 1.35–1.41; confirm with the bank).

| Component | Choice | USD/month | CAD/month |
| --- | --- | --- | --- |
| API (Admin, Apply, email) | Render Starter, required for SMTP | 7.00 | 9.80 |
| Public website | Render **free** (first visit after 15 idle min waits about 1 min) | 0.00 | 0.00 |
| Résumé scanning | Render cron 2c-4g, ClamAV, **daily** (the $1/month minimum dominates) | ≈ 1.00 | ≈ 1.40 |
| Database with backups (tested recovery) | Atlas **Flex** Frankfurt, daily snapshots ($0.011/h at ≤ 100 ops/s; ceiling $30) | ≈ 8.03 | ≈ 11.24 |
| Email, domain, DNS, TLS, native monitoring | Titan, registrar and Bluehost (already paid); Render TLS; Render/Atlas alerts | 0.00 | 0.00 |
| **Lowest complete total** | | **≈ 16.03** | **≈ 22.44** |
| Recommended: website always on | + Render Starter for the website | + 7.00 → **≈ 23.03** | → **≈ 32.24** |

**Worst case:** Flex reaches its $30 ceiling under heavy load and the scanner runs hourly (≈ $3.50). That gives **$40.50 (CAD 56.70)** for the lowest plan, or **$47.50 (CAD 66.50)** for the recommended plan.

**One-time, at activation:** ≈ **US$1 (CAD 1.40)** for the C7 run and a one-day Flex restore target for the Production recovery rehearsal.

**Not cheaper in practice:**
- Atlas free tier: backups are preview or unavailable, so recovery can't be tested.
- Free API: no SMTP, and readiness stays 503.
- Dropping the scanner: E4 §237 then blocks résumé review.

## 4. Path to the one public launch

| Step | What | Cost | Needs |
| --- | --- | --- | --- |
| 1 | ~~Approve SA-1~~ — approved 2026-11-21 (OD-2026-11-21-01) | $0 | Done |
| 2 | ~~Build E1–E5 locally~~ — IMPLEMENTED on `e-work`, tests green locally, review PR open (`docs/review/E1_E5_HANDOFF_2026-11-21.md`) | $0 | Owner: review the PR and the `/admin` screens |
| 3 | Meanwhile, owner inputs: P-1, P-2, P-4, P-5, real vacancy (P-6); DMARC `rua=` mailbox choice; D2 mailbox MFA | $0 | Owner |
| 4 | **Spending approval** (§3), then Production: Atlas Flex project "Valida Production", Render API Starter + website + scanner cron, **private** (`SITE_ACCESS=private`); hosted Review of the Admin SHA | §3 monthly | Owner approval; laptop ~5 min for database users; Titan password typed into Render |
| 5 | C7 end-to-end with a QA candidate → **Release C VERIFIED**; after +24 h, Production restore rehearsal → recovery VERIFIED | ≈ $1 one-time | Claude |
| 6 | E-evidence in Production: login, MFA, protected/forbidden requests, logout, reset; résumé `CLEAN` → review; status, notes, audit | — | Claude + owner (MFA enrolment) |
| 7 | **DNS approval:** apex and `www` to Render, TLS, DMARC reporting | $0 | Owner approval at Bluehost |
| 8 | **Public activation:** `SITE_ACCESS=public`, real vacancy published, `RECRUITMENT_MODE=open` (E6), then E7 | — | Owner approval |

## 5. Request (one decision now)

**Approve SA-1 as worded in §2.** It costs nothing, and I start E1 (Admin authentication) locally right away. The spending in §3 is requested separately at step 4, when Admin passes CI. DNS (step 7) and public activation (step 8) each get their own explicit approval.
