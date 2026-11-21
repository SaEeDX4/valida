# Owner record 2026-11-20 (DRAFT): C6 hosted Review of 2b39e8e

| | |
| --- | --- |
| Status | **DRAFT — prepared by Claude for the owner's written confirmation.** It records results and the owner's in-session deviation acceptance; it decides nothing else |
| Date | Review window 2026-11-19 14:52Z → 2026-11-20 23:08Z |
| Decided by | Saeed (owner): the G-ACCESS deviation acceptance of 2026-11-20 ("Accept, proceed"), §3. Everything else here is a result, not a decision |
| Source | The owner's instructions of 2026-11-19 (authorised private hosted Review, CAD 75 ceiling, Render and Atlas only) and 2026-11-20 (prepare the C6 owner record) |
| Recorded by | Claude, on the local branch `c6-work`. **Not committed, not pushed** |
| Governing | Doc 18 C6 (§§176–180); runbooks 1–3 (`docs/operations/C6_RUNBOOK_*`); CR-2026-11-18-AN (Atlas-native recovery) |
| Evidence | `C:\ME\Valida-C6-hosted-review-2026-11-20\HANDOFF.md` and `evidence/` (157 files; scanned: no address, no credential) |
| Not an owner-decision identifier | No `OD-` identifier. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` and does not accept the Review/release SHA (RG) |

## 1. Reviewed

| | |
| --- | --- |
| SHA | **`2b39e8e799329428f0f68b4fb70f88f85c6eda69`** (`c6-work`, PR #1); rollback target `f383fa10eafb9c106bb4a11389471e83b11c8090` |
| CI (reused) | 9/9 at the SHA (runs 44522152015, 44522151939); 9/9 at `f383fa1` |
| Infrastructure | Render "Cyber Valida MB" (Hobby, Frankfurt): API and documents (starter), scanner cron (4 GB). Atlas "Cyber Valida MB", Project 0: Flex `valida-review` and, for the rehearsal, Flex `valida-restore-target` (AWS eu-central-1). All torn down 2026-11-20 23:08Z |
| Data | Synthetic only |
| Cost | US$0.77 shown at teardown; ≈ US$1.15 (≈ CAD 1.60) expected final, before tax; ceiling CAD 75 |

## 2. Results (evidence: HANDOFF §§1–3)

| Gate | Result |
| --- | --- |
| Deployment evidence (Doc 18 §179) | Commit, URLs, build, startup lines, health, database, storage: **shown**. Readiness `false` only because email was not configured. Email and monitoring: **not shown** (outside this Review) |
| Reading 3 | Served assets equal a local LF build of the SHA |
| G-ACCESS (R0) | **Passed** with deviations A–C accepted (§3) |
| R1–R9, R11, R14 (checker, listed, with synthetic Jobs) | 13/13. R11 also by provider check (unauthenticated read refused) |
| Unlisted | R0.3, R0.4, R0.8, R11 pass; open Job invisible (403) |
| Scanner | Real ClamAV on Render cron: 1 CLEAN |
| Atlas least privilege | 22/22 |
| R13 (host logs) | Marker absent from host logs; the error-monitor half not run (no monitor) |
| Rollback (runbook 3 §2 rehearsal) | Both services to `f383fa1` and back, 13/13 each |
| B-R restore rehearsal (P-6, Flex→Flex) | **RECOVERY VERIFIED**, freshness `LIVE_JOURNAL`, anchor `1:693a5044577c447ce8b95841351471ba28ce1c3662a1955b5b2255806002f375`, deletion re-applied (1 application, 1 file); live users cannot authenticate on the restored cluster (16/16); deleted application and résumé absent on both clusters |

## 3. Deviations accepted by the owner (2026-11-20)

| | Deviation | Accepted basis |
| --- | --- | --- |
| A | Row 2: no address probe exists at the SHA | Cloudflare trace + `TRUST_PROXY` 1→2 behaviour + R0.4 spoofing pass |
| B | Row 6: the wrong-key failure surfaces in R1 (Job routes 503), not R0.5 | The API refused every badly keyed delegation; key restored → all pass |
| C | R14 on unlisted runs counts Cloudflare's own "error code: 1000" page for a forged `CF-Connecting-IP` | Every origin response carried the SHA; the forged request never reached a service |

## 4. Host facts for the next deployment (no code change)

`TRUST_PROXY=2` on Render; documents build `npm ci --include=dev` for `frontend`; cron env vars set before the first cron deploy; Atlas Flex first snapshot at +24 h, no on-demand (two-day rehearsal window); Debian ClamAV logs "OUTDATED" while signatures are current.

## 5. H2 hosted session (2026-11-21, `2b39e8e`, torn down) and what stays open before RG

Evidence: `C:\ME\Valida-H2-2026-11-21\HANDOFF.md` and `evidence\`. G-ACCESS passed again on both new hostnames (deviations A and C as above). The new deviation **D**: the unlisted vantage point was Render egress via the web Shell, not a tethered phone.

| Item | H2 result |
| --- | --- |
| Monitoring: owner chose **native** (Render failure notifications, Atlas default alerts) instead of Sentry; R13's monitor half | Native in place. R13 log check **PASS**. **Open gaps:** no application-error alerting, no uptime monitor |
| Act E: bounded live email (D-13) | **PASS**: 1 of 3 messages, `notifications@` → `careers@` via Titan SMTP. Delivered (owner screenshot); no candidate data in the body; acknowledgements off. SPF/DKIM/DMARC headers **not yet captured** |
| Act M: Lighthouse R12 | **PASS**: Careers 100 (mobile and desktop); Job page 95–100. SEO 66 only because of noindex (Review) |
| Act M: Safari | iOS: **owner reported done, evidence pending**. macOS: not run (no Mac) |
| R1 / R10 | **PASS**: 503 with `Retry-After: 60` while the API was suspended. 10 allowed, then 429 (the counter splits during an instance overlap; documented) |
| Closed-mode readiness with email configured | **PASS**: readiness 200; `recruitmentMode: closed`; Jobs empty; Job 404 |
| GHSA-fc5q-39xc-vjpf exception | Expires **2026-12-18T05:31Z**; RG and act I must finish first, or the dependency is remediated |

H2 cost ≈ US$0.06 (Render $0.04, Atlas ≈ $0.02). All Reviews to date ≈ US$1.23.

## 6. Unchanged

No implementation, publication, `main` change, Production resource, DNS change, live email or recruitment activation is authorised by this record. Production acknowledgements stay disabled; the genuine vacancy stays Draft through E6.

---

Owner confirmation: ☐ I confirm §§1–5 (and deviation D) as the record of the C6 hosted Review of 2b39e8e. — Saeed, date: ________
