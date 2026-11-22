# Launch of cybervalida.com — consolidated owner request (2026-11-22, corrected)

| | |
| --- | --- |
| Supersedes | `COMPLETE_LAUNCH_REQUEST_2026-11-21.md` §§3–5, and the first version of this file (commit `cf9fa5b`). That version wrongly re-added S3 from the pre-CR-AN plan (`C6_HOSTING_STAGE_ASSIGNMENT.md` §8) |
| Base | **Reviewed release SHA `f1f70ab`** (`main`, merge of PR #3; PR head `101491c` CI 9/9). E1–E5 **IMPLEMENTED**, not VERIFIED. D-3 (§4.4) is on the review branch `ccr-a5e61e13-8rm3ng`, not yet on `main` |
| Stack (owner, 2026-11-22; CR-2026-11-18-AN) | **Render:** hosting and scanning. **MongoDB Atlas Flex:** records, résumés (`RESUME_STORAGE_DRIVER=mongodb`) and native recovery (daily Flex snapshots, deletion journal in Atlas). **Bluehost / Titan:** domains, DNS and email (already paid). **No S3, no external journal, no encrypted export, no backup cron** |
| Finish line | One public launch with the full recruitment flow VERIFIED, including the **candidate acknowledgement** and the **authorised HR download of the original CLEAN résumé** |
| Status | Prepared by Claude at $0. **Nothing here authorises spending, deployment, a DNS change, live email or public recruitment** (§5) |
| **Owner budget (2026-11-22)** | **CAD 26 / month in total** for the new Render and Atlas services, including scanning, usage, tax, currency conversion and card fees. **Neither provider can enforce it** (§2.1): flagged before provisioning |

## 1. Zero-cost preparation completed on 2026-11-22

| # | Item | Result |
| --- | --- | --- |
| Z-1 | **Least-privilege gap (fixed on this branch).** `valida_api_runtime` had no privileges on `admins`, `admin_sessions` or `audit_events`, and only `find` on `jobs` | **Shown:** the real API with Admin enabled, under the production users only, failed at the first step (`not authorized … insert: "admins"`); Job creation then failed for want of `listIndexes`. **Fixed** in `backend/src/ops/backup/mongoRoles.js`: `jobs` find/insert/update/listIndexes; `admins` find/insert/update; `admin_sessions` find/insert/update/remove; `audit_events` find/insert (append-only). **New test** `backend/tests/mongo-roles/mongo-admin-roles-server.test.js` drives the whole HR path under those users. The path covers provisioning, activation, MFA, Job create and publish, the public Apply, the scanner's `CLEAN` verdict, the HR download (**byte-identical and SHA-256-equal to the uploaded file**), status, note, communication, audit, overview, sign-out and sign-in. **Roles suite 5/5 locally** (auth-enabled MongoDB 8.0, CI's pinned image). The handoff's Atlas role instructions are corrected to match. CI runs it on the next PR into `main` |
| Z-2 | **Document-server routing** (`frontend/server/documentServer.js`) | GET and HEAD only. It serves every `/admin` path as the Admin shell, with `private, no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`. Its only outbound calls are public Jobs reads and the visitor-address delegation. **It does not proxy the API**, so the website and the API are always two origins. Making them one origin would need a new reverse proxy (new security-relevant code); this is not proposed |
| Z-3 | **Admin sign-in and hostnames** | The session cookie is `__Host-valida.sid`: Secure, HttpOnly, `SameSite=Strict`, host-only. `onrender.com` is a public suffix, so two `*.onrender.com` services are **cross-site** and the cookie never travels. **Cheapest supported way, with no change to the cookie protections:** two new CNAMEs at Bluehost, `app.cybervalida.com` (website) and `api.cybervalida.com` (API). Both are under one registrable domain, so they are same-site. The apex, `www`, MX, SPF, DKIM and DMARC records stay untouched. $0 at Bluehost, and within Render Hobby's 2 included domains |
| Z-4 | **Render domain count** | Render docs: Hobby **includes 2** custom domains, and **each beyond costs $0.25/month**, so there is no hard block. Adding an apex makes Render **add `www` automatically**, redirecting to the apex; adding `www` adds the apex. **Whether the auto-added half counts toward the 2 is not stated** in the docs found, so the budget carries it as a possible $0.25. Public stage: apex + `www` + `api.` = 2 or 3 domains, after `app.` is removed at cut-over. Confirm with the dashboard counter when adding the domains (zero cost) |
| Z-5 | **Audit gate expiry (verified before marking resolved)** | `ops/ci/audit-gate.mjs` checks an exception's expiry **only while its advisory is reported**. **Today's live `npm audit`** (backend and frontend, full dependency tree) reports 0 findings: the gate gives **PASS at 2026-11-22, 2026-12-19 and 2027-06-01**. **Replaying the 2026-11-18 report** gives PASS WITH APPROVED EXCEPTION at 05:30:59Z and **FAIL `EXPIRED` at exactly 2026-12-18T05:31:00Z**, so it still fails closed if the advisory returns. **GitHub's runner** on `ebace49` printed `AUDIT GATE backend: PASS` with no exception applied. Gate tests: 23/23. **Resolved** for the deadline; picomatch is still at 4.0.7 (no new release), so the gate stays the guard |
| Z-6 | **Acknowledgement path** | Production refuses `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` at start-up, unconditionally (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`, `backend/src/config/env.js`). OD-2026-11-04-02: lifting it is **a separate owner decision after the G-SUP evidence is accepted**. G-COPY is still PROPOSED. Decisions in §5 (A-5) |
| Z-7 | **Recovery of the new Admin data** | A Flex snapshot restore returns the whole database as of up to 24 h earlier, including `admins`, `admin_sessions` and `audit_events`. The added checks are in §4.3 |
| Z-8 | **D-3: Admin closed on a restored database** (review branch) | Implemented and proven with synthetic data (§4.4). Local evidence: offline 3079 passed; database 327 passed (including the new 4); recovery 42 passed (including the new 5); roles 5/5; frontend Admin 13/13 |
| Z-9 | **`main` CI incident, `f1f70ab`** | The first push run failed in the roles job only. The disposable MongoDB container never answered (`ECONNREFUSED 127.0.0.1:27018` in all three files, including two this PR did not touch); the setup loop did not stop the job. **One re-run: green** (MongoDB ready in 13 s), so `ci` is 8/8 on `main`. The D-3 branch makes that step **fail fast with the container's logs** (`.github/workflows/ci.yml`) |

## 2. Corrected monthly budget (CAD, tax-inclusive)

### 2.1 Against the owner's CAD 26 ceiling — and whether it can be enforced

**Flag before provisioning: neither provider offers a hard spending cap. Only alerts exist, and Render has no billing alert at all.**
- **Render:** no spend limit or billing alert was found; a spend limit is an open feature request on Render's feedback site. Current usage and projected charges are visible on the billing page, and services can be suspended at any time to stop charges.
- **Atlas:** billing alerts notify on "monthly pending invoice total" above a USD amount; they do not stop charges. Flex has a built-in maximum of **US$30/month**, which is above this budget.

**Fixed by configuration, so it cannot drift:**
- the API on Render Starter, US$7.00, prorated;
- the website on Render's free tier;
- two custom domains, inside Hobby's included two.

**Usage-dependent:**
- the scanner cron: $1 minimum; a daily run of a few minutes stays at the minimum;
- Atlas Flex: US$8.03 at ≤ 100 ops/s, more above that, up to $30.

| CAD per month (lowest plan, private stage) | 5 % GST | 11 % (SK) | 12 % (BC/MB) | 13 % (ON) | 15 % (NB/NL/PE) |
| --- | --- | --- | --- | --- | --- |
| US$16.03 at 1.43, with tax | 24.07 | 25.44 | 25.67 | 25.90 | 26.36 |
| **+ 2.5 % card foreign-transaction fee** | **24.67** | 26.08 ✗ | 26.31 ✗ | 26.55 ✗ | 27.02 ✗ |
| Headroom to CAD 26 | **+1.33** | −0.08 | −0.31 | −0.55 | −1.02 |

**Verdict:** CAD 26 holds **only** in one of these cases:
- **(a)** the billing location pays GST only (5 %); at 5 % plus the card fee, it holds up to 1.507 CAD/USD;
- **(b)** a GST number is on both billing profiles: CAD 23.49 with the card fee;
- **(c)** you pay with a card that has no foreign-transaction fee: CAD 25.44 at 11 %, 25.67 at 12 %, 25.90 at 13 %.

Otherwise the lowest plan exceeds CAD 26 by CAD 0.08–1.02 a month. There is no cheaper sustainable configuration: the API must be paid for SMTP, Flex is the cheapest tier with backups, and scanning is required to release résumés.

At 5 % plus the card fee, the CAD 1.33 headroom equals about **US$0.86** of usage per month. Flex above 100 ops/s, extra scanner runs or Render bandwidth beyond the included allowance could use it up.

**Controls we can apply** (detection plus a stop rule, not a cap):
- an Atlas billing alert at **US$9** month-to-date, and an Atlas Flex operations alert;
- a weekly look at Render's projected charges (owner, about 1 min);
- **stop rule:** if the projected month exceeds the equivalent of CAD 26, suspend the Render services and pause recruitment, then report. Suspending stops Render charges at once. Atlas Flex keeps billing until the cluster is terminated, which would also end recovery.

**Public stage:** the apex and `www` plus `api.` may count as 3 domains (+US$0.25, ≈ CAD 0.39). That is still within CAD 26 at 5 % with the card fee (CAD 25.06).

### 2.2 One-time costs (itemised)

| Item | When | USD | CAD at 5 % + 2.5 % fee |
| --- | --- | --- | --- |
| Hosted check session (§4.2) | Day 1 | 0 extra: the services already running, plus scanner runs within the $1 minimum | 0.00 |
| Restore rehearsal target: Flex, billed hourly, ≥ 24 h (§4.3) | Day 2–3 | ≈ 0.26 (≤ 0.79 if kept 3 days) | ≈ 0.40 (≤ 1.21) |
| Restore-rebaseline check on the target (D-3) | Same window | 0: run from the existing API's Render shell | 0.00 |
| DNS records, TLS | Day 1 | 0 (Bluehost, Render) | 0.00 |
| **Total one-time** | | **≈ 0.26 (≤ 0.79)** | **≈ 0.40 (≤ 1.21)** |

**First calendar month:** the services are prorated from the day they are created. A full month plus the rehearsal is ≈ CAD 25.07 at 5 % with the card fee, within CAD 26. (The earlier "≈ US$1 one-time for C7" over-estimated: C7 adds nothing beyond the running services.)


**Assumptions**
- **Prices:** USD list prices from the Nov 19–21 Render and Atlas invoices.
- **Exchange rate:** **1.43 CAD/USD**, the mid-November 2026 market level.
- **Tax:**
  - **5 % GST** is the headline (Alberta, Yukon, NWT, Nunavut; your commits carry UTC−07:00, which also fits parts of BC).
  - Atlas documents charging GST to Canadian billing addresses that have no GST number. Render's policy was not found, so the same rate is assumed.
  - Provincial PST, if a provider applies it, is shown in the other rows.
  - No card foreign-transaction fee is included; about +2.5 % if you pay USD with a CAD card.
- **The invoices' own tax lines were not available:** confirm with the first Production invoice.

| Component | Choice | USD/month |
| --- | --- | --- |
| API (Admin, Apply, email) | Render Starter, required for SMTP | 7.00 |
| Website and `/admin` shell | Render free (about 1 min first load after 15 idle min) | 0.00 |
| Résumé scanning | Render cron (ClamAV) daily; $1 minimum | 1.00 |
| Records, résumés, recovery | Atlas Flex Frankfurt ($0.011/h at ≤ 100 ops/s; cap $30). **5 GB hard storage cap, including résumé bytes** | 8.03 |
| Domains, DNS, email, TLS, alerts | Bluehost, Titan, Network Solutions (paid); Render TLS; Render and Atlas native alerts | 0.00 |
| Third custom domain, only if the auto-added `www` counts | Render | 0.25 |

| Plan | USD before tax | **CAD at 5 % GST** | 12 % (BC/MB) | 15 % (NB/NL/PE) | With a GST number |
| --- | --- | --- | --- | --- | --- |
| **Lowest sustainable** | 16.03 (16.28) | **24.07 (24.44)** | 25.67 (26.07) | 26.36 (26.77) | 22.92 (23.28) |
| Website always on (+ Starter $7) | 23.03 (23.28) | 34.58 (34.95) | 36.88 (37.29) | 37.87 (38.28) | 32.93 (33.29) |
| Worst case, lowest plan (Flex at $30, scanner hourly) | 40.50 (40.75) | 60.81 (61.19) | 64.86 (65.27) | 66.60 (67.01) | 57.91 (58.27) |
| **One-time:** C7 run and the one-day Flex restore target | ≈ 1.00 | **≈ 1.50** | 1.60 | 1.64 | 1.43 |

Figures in brackets include the possible third domain. Other rates for the lowest plan: SK 11 % CAD 25.44; ON 13 % 25.90; NS 14 % 26.13; QC 14.975 % 26.36; billed to Valida MB without an EU VAT number (21 %) 27.74. Billed to Valida MB with an EU VAT number: reverse charge, no VAT on the invoice.

**Removed from the budget:** S3 (all buckets), the backup copy and manifest workflows, and the second restore rehearsal (CR-2026-11-18-AN).

**Storage watch:** with no retention period decided (P-3), nothing is deleted automatically. At the 5 MiB maximum, 5 GB holds about 900 résumés, and many more at typical sizes. Set Atlas's storage alert at 80 %. M10 (≈ US$57/month) is the next tier and is not budgeted.

## 3. Checks carried forward (not repeated)

| From | Check | Carried forward as | Re-run? |
| --- | --- | --- | --- |
| Review of `2b39e8e`, 2026-11-19/20 | **B-R Flex→Flex restore**: RECOVERY VERIFIED, freshness `LIVE_JOURNAL`, deletion re-applied (1 application, 1 file), live users refused on the restored cluster 16/16 | The procedure, the freshness rule, target identification and deletion replay are proven | One Production rehearsal is the gate (§4.3); the procedure is not re-proven |
| Same | Rollback rehearsal (both services to `f383fa1` and back, 13/13) | The procedure | No |
| Same | Scanner: real ClamAV on a Render cron (1 CLEAN) | The host set-up (4 GB, cron env vars first) | One Production scan (P-4) |
| Same / H2 | Host facts: `TRUST_PROXY=2`; documents build `npm ci --include=dev`; first Flex snapshot at +24 h | Configuration | No |
| H2, 2026-11-21 | Titan SMTP delivery (1 message, `notifications@` → `careers@`); closed-mode readiness 200 with email configured; R1 (503 + `Retry-After`); R10 (429 per client); Lighthouse R12 (Careers 100, Job 95–100) | Results | R12 again only at public activation (indexing on) |
| PR #2, 2026-11-22 | E1–E5 local suites; CI 9/9 on `ebace49` | Results | No |
| This branch | Z-1 to Z-5 | Results | Z-1 on CI at the next PR |

**Hostname- or SHA-bound, so repeated:** G-ACCESS R0, R1–R14 (R14 names the new SHA), the Atlas least-privilege check (the API role changed in Z-1), and R13 with Admin traffic.

**Still open from H2:** the iOS Safari evidence, and the SPF/DKIM/DMARC headers of one delivered message.

## 4. Deployment request: one bounded private rollout on Render and Atlas (approval P)

One approval covers §§4.1–4.5.
- **Private throughout:** `SITE_ACCESS=private`, `RECRUITMENT_MODE=testers`, synthetic data only, nothing public.
- **Cost:** §2 from the day the services are created, within the CAD 26 ceiling only under §2.1's conditions.

**Bounds:**
- **Scope:** one Atlas Flex project and one Render API (Starter), website (free) and scanner cron, plus two DNS records. Nothing else is created.
- **Sessions:**
  - **Session 1 (day 1, about 3 h, owner present for the ⓞ steps):** provisioning and **every hosted recruitment check** in §4.2, in one sitting.
  - **Session 2 (after the first +24 h Flex snapshot, about 1 h, mostly Claude):** the §4.3 recovery checks.
- **Live email:** only the C7 internal notification, to **one owner-controlled recipient**, **at most 3 messages** in session 1 (as H2). Candidate acknowledgements stay off until A-5.
- **Stop rule:** a failed check that cannot be fixed by a new reviewed commit in the session, a projected month above CAD 26 (§2.1), or your word. Stopping means the API, website and cron are suspended (Render charges stop), recruitment stays closed, and the synthetic data is deleted through the journal. The Flex cluster is terminated only on your instruction, because that ends recovery.
- **After the rollout:** the services stay private, at §2's monthly cost, until A-4 and A-6, or are suspended if you prefer.

### 4.1 Resources and settings

| # | Where | What | Who |
| --- | --- | --- | --- |
| P-a | Atlas | New project **"Valida Production"**, Flex, Frankfurt. Custom roles exactly as `mongoRoles.js`: `valida_api_runtime` (with Z-1), `valida_resume_storage`, `valida_resume_scanner`, `valida_deletion_operator`, `valida_journal_reader`. One user per role, **each restricted to this cluster**. Access list: Render Frankfurt egress ranges | Claude prepares; **owner** creates users and roles in the console (≈ 5 min) |
| P-b | Atlas | `npm run db:indexes:apply` (19 indexes, including the session TTL); **`npm run db:identity:init`**, which records the live database's identity anchor once, insert-only, with the same temporary owner-level user; `ops:recovery:journal-init`. The owner records the journal anchor | Claude; owner records the anchor |
| P-c | Render | API on **Starter**, website on **free**, scanner cron daily (4 GB). Auto-deploy Off; deploy the approved SHA by commit | Claude |
| P-d | Render env (API) | `APP_ENV=production`, `TRUST_PROXY=2`, `RESUME_STORAGE_DRIVER=mongodb`, `RECRUITMENT_MODE=testers`, `ACCESS_ALLOWLIST`, `CORS_ALLOWED_ORIGINS=https://app.cybervalida.com`, `ADMIN_AUTH=enabled`, `ADMIN_APP_ORIGIN=https://app.cybervalida.com`, **`ADMIN_DATABASE_REPLICA_SET=<the Flex cluster's replica-set name>`** (D-3: without it the Admin does not start), Titan SMTP from the mailbox you choose (H2 used `notifications@`), with `RECRUITMENT_NOTIFICATION_RECIPIENT=careers@`, `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false` (until A-5) | Claude; **owner types every secret**: database URIs, `ADMIN_SESSION_SECRET`, `ADMIN_MFA_KEYS`, the Titan password, `INTERNAL_SERVICE_KEY` |
| P-e | Render env (website) | `SITE_ACCESS=private`, the same allowlist and internal key; build `VITE_API_BASE_URL=https://api.cybervalida.com` | Claude |
| **P-f** | **Bluehost DNS** | **Add two CNAMEs only:** `app` → the website's Render host, `api` → the API's Render host. **No existing record changes** | **Owner** (≈ 3 min), after Claude exports the current zone as a rollback copy |
| P-g | Render | Add `app.cybervalida.com` and `api.cybervalida.com`; TLS issued; confirm the domain counter shows 2/2 | Claude |
| P-h | Render shell | `npm run admin:provision create --email <owner mailbox> --name "<name>"` | **Owner** |

**SHA:** the **reviewed release SHA `f1f70ab`** (`main`).
- **D-3 is not in it.** On `f1f70ab`, a restored database is kept closed by procedure only (§4.4, step 1).
- If you merge the D-3 branch first, the release SHA becomes that merge, and the API itself refuses to open the Admin on an un-re-baselined restore. **Recommended before session 2.**
- The Atlas roles in P-a follow `mongoRoles.js` **at the deployed SHA**. D-3 adds `find` on `restore_authorization` and `admin_restore_state` to `valida_api_runtime`.

### 4.2 Hosted checks, in order (with carried-forward checks excluded)

Expected codes are those on `main`. ⓞ marks steps the owner does.

| # | Check | Pass |
| --- | --- | --- |
| H-1 | Start-up lines; Reading 1 (deploy record) and Reading 3 (served assets equal a local build) | `site access` private; `release identity` = SHA; no secret printed |
| H-2 | **G-ACCESS R0.1–R0.10** on `app.` and `api.` (runbook 1 §3; checker `--mode production`, listed and unlisted) | Every row; deviations A, C and D as accepted |
| H-3 | **R1–R14** with a synthetic open and closed Job; R11 and R13 operator rows | 13/13 automated plus operator rows |
| H-4 | **Atlas least privilege** with the Z-1 roles; live users cannot authenticate on any other cluster | All pass |
| H-5 | Admin document and API refusals: `/admin` headers as Z-2; `GET /api/v1/admin/overview` without a cookie → **401 `AUTHENTICATION_REQUIRED`**; with a foreign `Origin` → **403 `ORIGIN_REJECTED`** | As stated |
| H-6 | ⓞ Activation link (≤ 8 h, single use), password, TOTP enrolment, 10 recovery codes | Enrolled |
| H-7 | Cookie in devtools: `__Host-valida.sid`, Secure, HttpOnly, SameSite=Strict, no Domain, sent to `api.` | This proves Z-3 |
| H-8 | ⓞ Sign-out, sign-in; 5 wrong TOTP → `MFA_CHALLENGE_ENDED`; 5 wrong passwords → generic `INVALID_CREDENTIALS` and a 15 min lock; 31st attempt → 429; 30 min idle → `SESSION_EXPIRED`; step-up → `RECENT_AUTH_REQUIRED`; reset link 30 min, single use, all sessions revoked | As stated |
| H-9 | A QA `RECRUITMENT_ADMIN`: `/admins` and `/audit` → 403; revoking its session → 401 `SESSION_REVOKED` | As stated |
| H-10 | E3: a QA Job, Draft → publish (listed testers only) → close → archive, all audited | As stated |
| H-11 | **C7**: a QA candidate applies through the real Apply with a synthetic PDF whose SHA-256 is recorded first | 201. The internal notification reaches the one owner-controlled recipient (live email, ≤ 3 messages). The application is listed in Admin with its applied-role snapshot |
| H-12 | **Real scanning:** the résumé before the scan → **409 `RESUME_NOT_AVAILABLE`**; anonymous → 401. Trigger the Render scanner cron manually: real `clamd` with current official signatures → `CLEAN`, bound to the stored version and digest. Optional negative case: a synthetic DOCX whose member is the standard EICAR test file, **if** the Apply validator accepts it → `QUARANTINED`, never released. If Apply rejects it at upload, that negative case stays covered by CI's real-ClamAV job (`clamd-scanner.test.js`, which seeds the record directly) | As stated |
| H-13 | **HR download of the original:** ⓞ the owner downloads the résumé in Admin | `attachment`, `nosniff`, `private, no-store`. **SHA-256 of the download = SHA-256 of the file the QA candidate uploaded** (recorded on both sides). `RESUME_ACCESSED` audited first |
| H-14 | E5: status change; a stale change → 409 `STATUS_CONFLICT`; note; recorded communication; owner audit view | As stated |
| H-15 | ⓞ iOS Safari: public pages and Admin sign-in | No blocker |
| H-16 | One delivered message's headers (addresses redacted) | SPF, DKIM and DMARC pass |
| H-17 | Teardown of synthetic data through the journal; QA Admin disabled | Owner records the anchor |

### 4.3 Recovery: only the checks the new Admin data and the Production gate add

All run in **one** Production Flex→Flex rehearsal, in session 2 after the first +24 h snapshot. That rehearsal is CR-AN G3, the only one, and carries the ≈ CAD 0.40 (≤ 1.21) one-time cost of §2.2. The rest of the procedure is carried forward (§3). R-A2 to R-A4 are carried out by `restore-rebaseline` (§4.4) when D-3 is deployed.

| # | Check | Why | Pass |
| --- | --- | --- | --- |
| R-P | Production rehearsal: restore, freshness from `LIVE_JOURNAL`, deletion replay of the H-17 deletions | Production gate (Release C/E) | **RECOVERY VERIFIED** on Production |
| R-A1 | The restored target holds `admins`, `admin_sessions`, `audit_events`, `scan_attempts` and `deletion_journal`; `db:indexes:check` shows all 19 indexes, incl. the session TTL | Admin collections and indexes are in the snapshot | All present |
| R-A2 | **Sessions:** before any reopening, rotate `ADMIN_SESSION_SECRET` with **no** previous secret; a cookie issued before the snapshot → 401 | Restored sessions could include ones revoked or signed out after the snapshot | 401 |
| R-A3 | **Admin state:** compare `admin:provision status` for every Admin with the owner's offline record of Admin changes. Re-apply any later disable, role change or MFA reset. Reissue any restored unexpired activation or reset token | Restore can revert a disable, a role change or a reset made after the snapshot | Matches the record |
| R-A4 | **MFA keys:** every retired `ADMIN_MFA_KEYS` entry is kept ≥ 8 days (snapshot retention); one TOTP sign-in on the restored data | Restored MFA secrets must still decrypt | Sign-in works |
| R-A5 | **Audit window:** the record notes that audit events after the snapshot (≤ 24 h) are not in the restored log | RPO ≤ 24 h (CR-AN G2) | Noted in the owner record |
| R-A6 | Live users stay restricted to the live cluster; the restore writer to the target (the 16/16 check, with the Z-1 role) | CR-AN G4 | All refused as before |

**New operating rule (proposed):** after each Admin change (invite, disable, role change, MFA reset), the owner notes it offline, as is done for deletion anchors. This rule needs your approval.

### 4.4 A restored environment stays closed unless post-snapshot Admin revocations are verified

A **revocation** is any Admin change that removes access: disable, role removal, password reset or change, MFA reset, session revocation, an `authVersion` bump, or a withdrawn invitation. A snapshot is up to 24 h old, so a restore can undo any revocation made after it. The rule follows the deletion rule of CR-2026-11-18-AN: **what cannot be proven newest does not open anything.**

**1. Closed state.** A restored environment always starts here, and this needs no code:
- the API runs with `ADMIN_AUTH` **unset**, so the Admin surface is not mounted and `/api/v1/auth/*` and `/api/v1/admin/*` answer 404;
- `RECRUITMENT_MODE=closed`, `SITE_ACCESS=private`, `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`;
- `ADMIN_SESSION_SECRET` is replaced, with no `ADMIN_SESSION_PREVIOUS_SECRETS`, before `ADMIN_AUTH` is ever set again.

The deletion gate is unchanged: freshness must come from `LIVE_JOURNAL`, or the target stays closed.

**2. Verification.** Only one source **proves** the Admin state: the former live cluster, still readable (like `LIVE_JOURNAL`).
- **Compare** each Admin's `status`, `roles`, `authentication.authVersion`, `passwordChangedAt`, `mfa.enabled` and `mfa.enrolledAt`, and the `audit_events` written after the snapshot time.
- **Apply** the more restrictive value on the restored data: DISABLED wins, the fewer roles win, the higher `authVersion` wins.
- **Record** the result in the owner record.
- **Then** set `ADMIN_AUTH=enabled` and continue with R-A2 to R-A6.

**3. If the live cluster cannot be read, the revocations are unverifiable.** The owner's offline Admin-change record is useful evidence, but **it cannot prove that no later revocation happened**. Like `--owner-attestation`, it **never reopens** the Admin.
- `ADMIN_AUTH` stays unset and `RECRUITMENT_MODE` stays `closed`.
- Applications cannot be reviewed, so none are accepted.

**4. Reopening an unverifiable restore needs a re-baseline.** Every restored Admin is treated as revoked:
- every Admin set to DISABLED;
- `authVersion` +1;
- activation and reset tokens cleared;
- MFA secrets and recovery codes cleared;
- then **one named owner** re-enabled with **no password**, and a fresh activation (≤ 8 h) issued to the owner's mailbox.

The owner re-enrols MFA and re-invites the other Admins.

**D-3 implemented (2026-11-22; correction 1 on the same PR #4; review branch `ccr-a5e61e13-8rm3ng`, not on `main`):**

**Correction 1 (owner, 2026-11-22):**
- **Bound to its database.** The Admin opens only when the connection's replica-set name equals `ADMIN_DATABASE_REPLICA_SET`, and the database is either:
  - the intended live one: its `database_identity` anchor, written once at provisioning by `db:identity:init`, names exactly this cluster and database; or
  - a restore whose **own** re-baseline marker is bound to its own authorisation, cluster and database.
- **What stays closed:**
  - a fresh unmarked restore, because the anchor it inherits names the live database;
  - a restore carrying an **older** marker, because that marker is bound to another cluster or database;
  - an unprovisioned database, a configuration mismatch, and any read error.
- **Inherited authorisations.** `prepare-target` (an owner step before the gate) sets aside, unchanged, any authorisation inherited through the snapshot into `restore_authorization_inherited`, and only then writes this target's own. An authorisation bound to this target still refuses. This lets a second-generation restore complete its own recovery. **The applicant-deletion gate itself (`restoreTarget.js`) is byte-identical to `main`.**
- **Private, recoverable delivery.**
  - The link goes to the owner's file **before any Admin write**: exclusive create, mode 0600, no symlink, never overwritten, in an owner-only directory, fsync'd, hard-linked into place, directory fsync'd. Any failure changes nothing.
  - The attempt is then claimed by insert, so exactly one of concurrent attempts wins; a loser removes its own file.
  - The revoke and owner-arm steps are **fenced by the claim's epoch**, so a stale attempt cannot overwrite a newer link.
  - The marker is published **last**, only by the attempt holding the claim.
  - **Interrupted:** re-run with the same file and it resumes with the **same** link.
  - **File lost:** `--restart-pending <attempt>` replaces the attempt after a 15-minute lease, under a higher epoch.

- **The API refuses to start with `ADMIN_AUTH=enabled` on any restored database** (one that carries a `restore_authorization`) until a `REBASELINED` mark exists for that target. A read error also refuses (fail closed). The fixed message is `AdminRestoreClosedError`, with reason `ADMIN_RESTORE_NOT_REBASELINED`. Without `ADMIN_AUTH`, the applicant API runs and no Admin route exists. `backend/src/server.js`; `backend/src/modules/admin/restoreRebaseline.js`.
- **`mongo-recovery.mjs restore-rebaseline`** (owner):
  - It runs the **unchanged applicant-deletion gate first**, with the same inputs and freshness rule as `restore-verify`.
  - **Any verdict but RECOVERY VERIFIED:** Admin CLOSED, zero Admin writes.
  - **After VERIFIED, and only against the verified target cluster** (never the live one), it:
    - disables every restored Admin and adds 1 to `authVersion`;
    - clears passwords, activation and reset tokens, MFA secrets, pending enrolments and recovery codes;
    - removes every Admin session;
    - re-enables **one** named owner with **no password**, and writes a fresh activation link (8 h) to a 0600 file, never to stdout;
    - writes the mark last.
  - **An interrupted run** leaves the Admin closed and is safe to repeat. A second run refuses with `ALREADY_REBASELINED`.
- **Not implemented:** the live-comparison route of step 2. Until it exists, every restored database reopens its Admin only by re-baselining.
- **The offline Admin-change record** stays a **proposal pending your decision**; nothing depends on it.

**Proven with synthetic data:**

`backend/tests/db/d3-admin-restore-rebaseline.test.js` (6 tests: real server, real session store, real Argon2id).
- **Identity:** the live database starts only with its anchor and the configured cluster (`NOT_PROVISIONED`, `NOT_CONFIGURED` and `MISMATCH` stay closed). A fresh unmarked restore is closed. A restore carrying an older marker is closed until its own re-baseline.
- **Delivery:** a failed fsync, an existing file and a world-writable directory each change nothing. Of two concurrent attempts exactly one claims, and the loser leaves no file. The winner, interrupted after the claim, stays closed and resumes with the **same** link. A retry without that file, or a restart before the lease, is refused. After the lease, a restart (epoch 2) wins, and the stale attempt X ends `REBASELINE_SUPERSEDED` with the owner's token still R's.
- **Access:**
- **Restored and not re-baselined:** the Admin is closed. It refuses to start with `ADMIN_AUTH`, and without it the Admin routes are 404. The recruiter, revoked after the snapshot and ACTIVE again in the restored data, cannot get in.
- **An interrupted re-baseline** keeps it closed.
- **After the re-baseline**, with the **same** session secret (worst case):
  - old cookies → 401; the control is the same cookie answering 200 on the live server;
  - old passwords → `INVALID_CREDENTIALS`; the old invitation → `ACTIVATION_INVALID`;
  - the old TOTP secret and an old recovery code are refused at the MFA step.
- **Only the owner**, freshly activated with a new password and a new MFA secret, signs in.

`backend/tests/recovery/admin-rebaseline.test.js` (7 tests, two replica sets). Added in correction 1: a fresh unmarked restore is closed on its own cluster; a second-generation restore that carries the older marker is prepared (the inherited authorisation is ignored), stays closed, and opens only through its own re-baseline. Unchanged:
- missing inputs refuse with zero writes;
- **deletion gate not passed** (live journal unavailable, export only): `RECOVERY FAILED`, Admin CLOSED, **zero writes** on both clusters, no link;
- VERIFIED but the admin URI names the live cluster: Admin CLOSED, no Admin write anywhere;
- VERIFIED on the target: the deletion is re-applied, then every Admin revoked, one owner re-enabled, the link file mode 0600, the mark written;
- a second run re-verifies the deletion gate and refuses the Admin step.

### 4.5 Spending ceiling: the owner's CAD 26 (replaces the earlier CAD 70/75 proposal)

| | Expected (5 % GST + 2.5 % card fee) | Ceiling | Enforced by |
| --- | --- | --- | --- |
| Monthly, all new Render and Atlas services | ≈ CAD 24.67 | **CAD 26** (owner) | **Nothing at the providers** (§2.1): an Atlas alert at US$9, a weekly look at Render's projection, and the stop rule |
| First month including one-time items | ≈ CAD 25.07 | CAD 26 | Same |

Upgrading the website to Starter (≈ CAD 35.4 with fee) or Atlas to M10 (≈ US$57) would break the ceiling; neither is planned.

## 5. Approvals (each separate; none is given by this document)

| # | Approval | Cost | Unblocks |
| --- | --- | --- | --- |
| **P** | **Bounded private rollout** (§4): spending within CAD 26, **accepting that the providers can only alert** (§2.1); the Atlas Production project; the Render services; the deployment of the release SHA; **DNS: the two new CNAMEs `app.` and `api.`**; **live email: the C7 internal notification only, one recipient, ≤ 3 messages** | ≈ CAD 24.67/month + ≈ CAD 0.40 one-time | §4.2 and §4.3: C7, E1–E5 VERIFIED, and Production recovery VERIFIED |
| D-3 | **Merge** the re-baseline branch (§4.4), after its CI. **Separately:** adopt or decline the offline Admin-change record | $0 | The coded Admin closure on restore |
| A-4 | **DNS, public:** apex and `www` to the website, TLS, `www` → apex redirect; DMARC `rua=` record; remove `app.`. Admin moves to `https://cybervalida.com`, then a short re-check of H-5 to H-7 | $0 (or + CAD 0.38/month for a third domain) | Public hostnames |
| A-5 | **Candidate acknowledgement:** the decision sheet in §5.1 | $0 | Hosted check **H-18:** a QA candidate receives the acknowledgement, and a suppressed QA address receives none |
| A-6 | **Public recruitment:** `SITE_ACCESS=public`, indexing on (R3, R12, HSTS), the real vacancy published, `RECRUITMENT_MODE=open` (E6), JobPosting validated (G7), then **E7** end-to-end with acknowledgement and HR download | — | **Launch.** Needs §6 first |

**Smallest next step:** send the billing tax location (it decides whether CAD 26 holds, §2.1). Then merge D-3 and approve **P**. Session 1 runs every recruitment check; session 2 the rehearsal after +24 h. A-5 can be decided in parallel, at $0.

### 5.1 Decision sheet: candidate acknowledgement (A-5)

**Already approved or done:**
- the acknowledgement's subject, preheader and wording (OD-2026-10-26-02, D4) and the Concept A presentation;
- the suppression design (D2a) and its implementation (B7, OD-2026-11-04-02), including the r6 stale-primary fix;
- the daily bounce-observation procedure (OD-2026-11-03-01).

**Blocked by:** the unconditional Production refusal `ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`. OD-2026-11-04-02 keeps it until the G-SUP evidence is accepted.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| AK-1 | Accept the G-SUP evidence. Authorise replacing the unconditional refusal with the design's start-up requirement: in Production, acknowledgements start only when the suppression key (`SUPPRESSION_HMAC_KEY`, `SUPPRESSION_HMAC_KEY_ID`) and `SUPPRESSION_OPERATOR_IDS` are configured and pass the key check; the send path keeps the design §3.2 coverage check and fails closed | Accept and authorise the change (code and CI at $0, then H-18), or keep the refusal | **Accept**: required for the finish line |
| AK-2 | G-COPY (proposed; it would block **every** Production automated email, the C7 internal notification included, until a copy-to-Sent mechanism is built and tested) | (a) leave it unapproved for launch; (b) approve it: build it first, and C7 waits; (c) approve it with a recorded, time-limited exception | **(a)** for launch. Titan keeps no Sent copy; each attempt's outcome is recorded durably in the database. Revisit at volume |
| AK-3 | Suppression secrets and operators | The key and key id, typed into Render by you; your operator token; **where the protected second copy of the key is kept** (design §4.2) | Your password manager, with MFA |
| AK-4 | Acknowledgement budget (D2b, optional, no number proposed) | Adopt (a separate change) or not now | **Not now** |
| AK-5 | Sender and reply address | From: the Titan mailbox used in H2 (`notifications@`); Reply-To: `careers@` (Doc 14 §203) | As stated |
| AK-6 | Known risks | Outlook.com Junk placement seen in B6 (P1, cause unknown); confirm the OneDrive bounce-log conditions before the first entry | Accept P1 as an observed risk; confirm OneDrive |

**After AK-1 to AK-6:** H-18 in private Production. A QA candidate receives the acknowledgement; a QA address entered in the suppression register receives none (`RECIPIENT_SUPPRESSED`, zero SMTP). E7 then repeats it publicly.

## 6. Prefilled launch-input checklist (from approved records)

### 6.1 Vacancy: the Cybersecurity Specialist (`backend/provisioning/jobs/cybersecurity-specialist.json`, DRAFT)

| Field | Approved value and source | Status |
| --- | --- | --- |
| Title | Cybersecurity Specialist (OD-2026-11-09-01 R1) | **Approved** |
| Work arrangement and audience | Fully remote; international recruitment audience (R1) | **Approved** |
| Canonical Job URL | `/careers/cybersecurity-specialist` (Doc 12 §6) on `https://cybervalida.com` (R3) | **Approved** |
| Internal occupational reference | NOC 21220, internal only; never public and never a restriction (R1; Doc 10 §23) | **Approved** |
| Eligibility field and label | `eligibleWorkCountries`, shown as "Eligible Remote-Work Countries" (OD-2026-11-09-02 and -03) | **Approved** (implemented) |
| Publication timing | Only after the Release E gates, including E6 (OD-2026-11-09-03 §4) | **Approved** |
| Application form | Résumé required (Doc 10 defaults) | **Approved** |
| Weekly hours | 30 (Doc 10 §70: "editable planning data") | **Confirm** |
| Compensation | CAD 35.00 gross per hour (same) | **Confirm** |
| Physical work location | "British Columbia, Canada" is the historical planning value only (R2) | **Needed** |
| Eligible work countries | OPEN pending company and employment arrangements (R2) | **Needed** (ISO list) |
| Employment type; schedule wording | — | **Needed** |
| Description; responsibilities; requirements | Must reflect Valida's actual role; nothing may be invented (R1; Doc 12 §45) | **Needed** |
| Preferred qualifications; screening questions; closing date | — | **Needed** ("none" is an answer) |
| Collect phone? Collect a message? | Off by default (Doc 10) | **Needed** |

### 6.2 Privacy

| ID | Approved so far, and source | Still needed |
| --- | --- | --- |
| P-1 Privacy contact | `careers@cybervalida.com` is the recruitment mailbox and the Reply-To of automated mail (Doc 14 §203). No approved source names it as the privacy contact (C4 check) | **Designate** a contact (`careers@` or another) |
| P-2 Providers | **Render** (hosting, logs, scanning) and **MongoDB Atlas** (applications, résumés, Admin data, deletion journal, snapshots), **Frankfurt** (CR-2026-11-18-AN; D-1). **Titan / Bluehost** Professional Email for corporate and transactional mail (OD-2026-10-26-02). Native Render/Atlas alerting (H2 choice, in the **draft** owner record 2026-11-20-01). Bounce log on OneDrive Personal, **conditional** on its access, MFA and ownership conditions (OD-2026-11-03-01, item 4). GitHub: code and CI, synthetic data only | **Confirm** each provider's role and data processing terms, the transfer basis for these US providers, Titan's data location, and whether the notice names providers (Doc 13 §181) |
| P-3 Retention | None decided; no automatic deletion (C4 check; data inventory) | **Determine** the recruitment retention period. Admin data and audit retention are part of it |
| P-4 Logs | Destination: Render logs (approved stack). Content: request id, method, route shape, status and duration only; no IP, user agent, body or cookie (C3 r3, implemented) | **Accept** the 7-day retention (Render Hobby) |
| P-5 Legal review | Required before public deployment (Doc 06 §§169, 178); not started | **Commission** the review of `/privacy` and `/legal` (Lithuanian entity, GDPR) |
| Admin data (new) | E1–E5 store: Admin name, email, roles, status and times; an Argon2id hash; an encrypted TOTP secret; hashed recovery codes; sessions with a browser and OS label, expiring by TTL; append-only audit events with no candidate PII | **Approve** this inventory entry |

### 6.3 Other inputs

- **Billing:** the billing tax location or entity, and any GST/HST or EU VAT number.
- **DMARC:** the mailbox for `rua=` reports.
- **Mailboxes:** confirm MFA on `shervin@`, `careers@`, `info@` and `notifications@`.
- **H2 leftovers:** the iOS Safari evidence and one message's headers.

## 7. Sources (read 2026-11-22)

- Render: [custom domains](https://render.com/docs/custom-domains) (Hobby includes 2; $0.25/month each beyond; apex and `www` added together); [Render accounts are now workspaces](https://render.com/changelog/render-accounts-are-now-workspaces); [cron jobs](https://render.com/docs/cronjobs); [logging](https://render.com/docs/logging).
- MongoDB Atlas: [Flex limitations](https://mongodb.com/docs/atlas/reference/flex-limitations) (5 GB, 500 ops/s); [Flex costs](https://mongodb.com/docs/atlas/billing/atlas-flex-costs); [international usage and taxes](https://mongodb.com/docs/atlas/billing/international-usage).
- `onrender.com` as a public suffix: [Render community](https://community.render.com/t/setting-samesite-attribute-for-cookies-from-different-render-domains/16868); [publicsuffix.org](https://publicsuffix.org/learn/).
- Exchange rate: [Bank of Canada lookup](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) (authoritative); mid-November market level ≈ 1.42–1.43.
