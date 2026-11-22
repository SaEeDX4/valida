# Launch of cybervalida.com — consolidated owner request (2026-11-22, corrected)

| | |
| --- | --- |
| Supersedes | `COMPLETE_LAUNCH_REQUEST_2026-11-21.md` §§3–5, and the first version of this file (commit `cf9fa5b`). That version wrongly re-added S3 from the pre-CR-AN plan (`C6_HOSTING_STAGE_ASSIGNMENT.md` §8) |
| Base | `main` = `60bb58a` (merge of PR #2, head `ebace49`, CI 9/9). E1–E5 **IMPLEMENTED** on `main`, not VERIFIED |
| Stack (owner, 2026-11-22; CR-2026-11-18-AN) | **Render:** hosting and scanning. **MongoDB Atlas Flex:** records, résumés (`RESUME_STORAGE_DRIVER=mongodb`) and native recovery (daily Flex snapshots, deletion journal in Atlas). **Bluehost / Titan:** domains, DNS and email (already paid). **No S3, no external journal, no encrypted export, no backup cron** |
| Finish line | One public launch with the full recruitment flow VERIFIED, including the **candidate acknowledgement** and the **authorised HR download of the original CLEAN résumé** |
| Status | Prepared by Claude at $0. **Nothing here authorises spending, deployment, a DNS change or public recruitment** (§5) |

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

## 2. Corrected monthly budget (CAD, tax-inclusive)

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

## 4. Grouped request: private deployment, with the DNS it needs (approval P)

One approval covers §§4.1–4.4. Everything stays **private** (`SITE_ACCESS=private`, `RECRUITMENT_MODE=testers`) with synthetic data only, and nothing is public. The cost is §2's lowest plan, from the day it is created.

### 4.1 Resources and settings

| # | Where | What | Who |
| --- | --- | --- | --- |
| P-a | Atlas | New project **"Valida Production"**, Flex, Frankfurt. Custom roles exactly as `mongoRoles.js`: `valida_api_runtime` (with Z-1), `valida_resume_storage`, `valida_resume_scanner`, `valida_deletion_operator`, `valida_journal_reader`. One user per role, **each restricted to this cluster**. Access list: Render Frankfurt egress ranges | Claude prepares; **owner** creates users and roles in the console (≈ 5 min) |
| P-b | Atlas | `npm run db:indexes:apply` (19 indexes, incl. the session TTL); `ops:recovery:journal-init`; owner records the anchor | Claude; owner records the anchor |
| P-c | Render | API on **Starter**, website on **free**, scanner cron daily (4 GB). Auto-deploy Off; deploy the approved SHA by commit | Claude |
| P-d | Render env (API) | `APP_ENV=production`, `TRUST_PROXY=2`, `RESUME_STORAGE_DRIVER=mongodb`, `RECRUITMENT_MODE=testers`, `ACCESS_ALLOWLIST`, `CORS_ALLOWED_ORIGINS=https://app.cybervalida.com`, `ADMIN_AUTH=enabled`, `ADMIN_APP_ORIGIN=https://app.cybervalida.com`, Titan SMTP from the mailbox you choose (H2 used `notifications@`), with `RECRUITMENT_NOTIFICATION_RECIPIENT=careers@`, `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false` (until A-5) | Claude; **owner types every secret**: database URIs, `ADMIN_SESSION_SECRET`, `ADMIN_MFA_KEYS`, the Titan password, `INTERNAL_SERVICE_KEY` |
| P-e | Render env (website) | `SITE_ACCESS=private`, the same allowlist and internal key; build `VITE_API_BASE_URL=https://api.cybervalida.com` | Claude |
| **P-f** | **Bluehost DNS** | **Add two CNAMEs only:** `app` → the website's Render host, `api` → the API's Render host. **No existing record changes** | **Owner** (≈ 3 min), after Claude exports the current zone as a rollback copy |
| P-g | Render | Add `app.cybervalida.com` and `api.cybervalida.com`; TLS issued; confirm the domain counter shows 2/2 | Claude |
| P-h | Render shell | `npm run admin:provision create --email <owner mailbox> --name "<name>"` | **Owner** |

**SHA:** `60bb58a` as merged, or `main` after this branch's PR (roles test and corrected docs; runtime code unchanged). The Atlas roles in P-a follow Z-1 either way.

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
| H-11 | **C7**: a QA candidate applies through the real Apply | 201. The `careers@` notification arrives. The application is listed in Admin with its applied-role snapshot |
| H-12 | Résumé before the scan → **409 `RESUME_NOT_AVAILABLE`**; anonymous → 401. Scanner cron run → `CLEAN` | As stated |
| H-13 | **HR download of the original:** ⓞ the owner downloads the résumé in Admin | `attachment`, `nosniff`, `private, no-store`. **SHA-256 of the download = SHA-256 of the file the QA candidate uploaded** (recorded on both sides). `RESUME_ACCESSED` audited first |
| H-14 | E5: status change; a stale change → 409 `STATUS_CONFLICT`; note; recorded communication; owner audit view | As stated |
| H-15 | ⓞ iOS Safari: public pages and Admin sign-in | No blocker |
| H-16 | One delivered message's headers (addresses redacted) | SPF, DKIM and DMARC pass |
| H-17 | Teardown of synthetic data through the journal; QA Admin disabled | Owner records the anchor |

### 4.3 Recovery: only the checks the new Admin data and the Production gate add

All run in **one** Production Flex→Flex rehearsal after the first +24 h snapshot. That rehearsal is CR-AN G3, the only one, and carries its ≈ CAD 1.50 one-time cost. The rest of the procedure is carried forward (§3).

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

## 5. Approvals (each separate; none is given by this document)

| # | Approval | Cost | Unblocks |
| --- | --- | --- | --- |
| **P** | **Private deployment:** spending (lowest plan, ≈ **CAD 24.07/month** at 5 % GST, plus ≈ CAD 1.50 one-time), Atlas Production project, Render services, the deployment of the SHA, and **DNS: the two new CNAMEs `app.` and `api.`** (§4.1) | §2 | §4.2 and §4.3: C7, E1–E5 VERIFIED, and Production recovery VERIFIED |
| A-4 | **DNS, public:** apex and `www` to the website, TLS, `www` → apex redirect; DMARC `rua=` record; remove `app.`. Admin moves to `https://cybervalida.com`, then a short re-check of H-5 to H-7 | $0 (or + CAD 0.38/month for a third domain) | Public hostnames |
| A-5 | **Candidate acknowledgement:** (1) accept the G-SUP evidence and authorise replacing the unconditional refusal with the design's suppression start-up check (code + CI at $0); (2) decide G-COPY: approve it and its evidence, or record an exception; (3) suppression secrets: `SUPPRESSION_HMAC_KEY`/`_KEY_ID`, the operator ids, and the location of the protected second key copy; (4) the acknowledgement budget (D2b) and the known Outlook.com Junk observation | $0 | Hosted check **H-18:** a QA candidate receives the acknowledgement, and a suppressed QA address receives none |
| A-6 | **Public recruitment:** `SITE_ACCESS=public`, indexing on (R3, R12, HSTS), the real vacancy published, `RECRUITMENT_MODE=open` (E6), JobPosting validated (G7), then **E7** end-to-end with acknowledgement and HR download | — | **Launch.** Needs §6 first |

**Smallest next step:** send the billing tax location, then approve **P**. Everything in §4 then runs in one hosted window, plus the +24 h rehearsal. A-5 can be decided in parallel, at $0.

## 6. Missing inputs (owner)

**Vacancy (P-6):** the Cybersecurity Specialist Draft is refused publication (`AWAITING_INPUT`) until these exist:
- eligible work countries
- physical work location
- employment type
- schedule wording
- description, responsibilities and requirements
- preferred qualifications, screening questions and closing date (each may be "none")
- confirmation of the planning data (title, fully remote, 30 h/week, CAD 35.00/h gross)
- whether to collect phone and message

**Privacy:**
- **P-1:** the privacy contact (`careers@` only if you designate it).
- **P-2:** confirm the provider inventory:
  - Render, Frankfurt: hosting, logs, scanning
  - MongoDB Atlas, Frankfurt: applications, résumés, Admin accounts, sessions, audit, deletion journal, snapshots
  - Bluehost/Titan: email (its data location is to be confirmed)
  - GitHub: code and CI only, synthetic data

  Also confirm each provider's data processing terms and the transfer basis for these US companies.
- **P-3:** the recruitment retention period.
- **P-4:** logs: Render, 7 days on Hobby; no IP, user agent, body or cookie in the access log.
- **P-5:** the legal and privacy review of `/privacy` and `/legal` (Lithuanian entity, GDPR).
- **Admin data (proposed inventory entry):**
  - Admin name, email, roles, status and timestamps
  - Argon2id hash
  - encrypted TOTP secret and hashed recovery codes
  - sessions with a coarse device label (browser and OS only), expiring by TTL
  - append-only audit events with no candidate PII

  Retention is part of P-3.

**Also needed:** the billing tax location or entity, and any GST/HST or EU VAT number; the DMARC report mailbox; MFA confirmed on `shervin@`, `careers@` and `info@`.

## 7. Sources (read 2026-11-22)

- Render: [custom domains](https://render.com/docs/custom-domains) (Hobby includes 2; $0.25/month each beyond; apex and `www` added together); [Render accounts are now workspaces](https://render.com/changelog/render-accounts-are-now-workspaces); [cron jobs](https://render.com/docs/cronjobs); [logging](https://render.com/docs/logging).
- MongoDB Atlas: [Flex limitations](https://mongodb.com/docs/atlas/reference/flex-limitations) (5 GB, 500 ops/s); [Flex costs](https://mongodb.com/docs/atlas/billing/atlas-flex-costs); [international usage and taxes](https://mongodb.com/docs/atlas/billing/international-usage).
- `onrender.com` as a public suffix: [Render community](https://community.render.com/t/setting-samesite-attribute-for-cookies-from-different-render-domains/16868); [publicsuffix.org](https://publicsuffix.org/learn/).
- Exchange rate: [Bank of Canada lookup](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) (authoritative); mid-November market level ≈ 1.42–1.43.
