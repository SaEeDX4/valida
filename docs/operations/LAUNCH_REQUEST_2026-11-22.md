# Launch of cybervalida.com — consolidated owner request (2026-11-22)

| | |
| --- | --- |
| Supersedes | `COMPLETE_LAUNCH_REQUEST_2026-11-21.md` §§3–5 (kept for history) |
| Base | `main` = `60bb58a` (merge of PR #2, 2026-11-22; head `ebace49`, 9/9 checks green). E1–E5 are **IMPLEMENTED** on `main`, not VERIFIED |
| Status | Prepared by Claude at $0. **Nothing here authorises spending, deployment, a DNS change or public recruitment.** Each needs the owner's explicit approval (§5) |

## 1. Where the launch stands

| Item | State |
| --- | --- |
| E1–E5 Recruitment Admin | On `main` (`60bb58a`). CI 9/9 on `ebace49`. Hosted evidence outstanding (§3) |
| C7 / Release C VERIFIED | Not started: needs Production (spend) |
| Production recovery | Restore VERIFIED in Review. Needs a Production rehearsal after its first +24 h snapshot |
| Email | Titan SMTP verified (H2). Needs a paid API instance (Render free blocks SMTP) |
| Release D (DNS, `www` TLS, DMARC `rua=`) | Prepared. Owner approval needed. **New finding (§2.3):** the hosted Admin checks need two DNS records **before** the apex cut-over |
| Vacancy and privacy | AWAITING INPUT (§4) |
| Dependency audit | `npm audit` (backend and frontend, committed lockfiles) reports **0** findings on 2026-11-22. The GHSA-fc5q-39xc-vjpf exception is only checked while the advisory is reported, so its 2026-12-18 expiry no longer fails CI as long as the advisory stays absent. To be confirmed on the next CI run |

## 2. Lowest sustainable monthly cost, tax-inclusive, in CAD

### 2.1 Basis

- **Prices:** USD list prices from the Nov 19–21 Render and Atlas invoices (`COMPLETE_LAUNCH_REQUEST_2026-11-21.md` §3), plus S3 (`C6_HOSTING_STAGE_ASSIGNMENT.md` §8), which the 2026-11-21 total left out.
- **Exchange rate:** **1.43 CAD/USD**, the mid-November 2026 market level (≈ 1.42–1.43). The Bank of Canada rate and your card's rate will differ.
- **Tax:** the invoices' tax lines are not in this repository, Gmail or Drive, so tax is computed, not read.
  - **Atlas** documents that it adds GST for a Canadian billing address unless a valid GST number is on the billing profile.
  - **AWS** charges GST/HST, and PST/QST where applicable, to Canadian accounts.
  - **Render:** its Canadian tax policy was not found. This assumes it charges the same rate, the conservative case.
- **Headline rate:** **5 % GST** (Alberta, Yukon, NWT, Nunavut). Your commits carry UTC−07:00, which fits Alberta but also parts of BC (12 %). §2.4 gives every rate.

### 2.2 The plans

| Component | Choice | USD/month |
| --- | --- | --- |
| API (Admin, Apply, email) | Render Starter, required for SMTP | 7.00 |
| Public website and `/admin` shell | Render **free**: the first visit after 15 idle minutes waits about 1 minute | 0.00 |
| Résumé scanning | Render cron (ClamAV), **daily**; the $1 minimum dominates | 1.00 |
| Database with daily backups | Atlas **Flex** Frankfurt ($0.011/h at ≤ 100 ops/s, cap $30) | 8.03 |
| Private storage and backups | AWS S3 Frankfurt, megabytes; a budget figure, not a measured one | 0.50 |
| Email, domain, DNS, TLS, native alerts | Titan, Network Solutions, Bluehost (already paid); Render TLS; Render/Atlas alerts | 0.00 |
| **Lowest, before tax** | | **16.53** |

| Plan | Before tax | Tax-inclusive (5 % GST) | **CAD / month** |
| --- | --- | --- | --- |
| **Lowest sustainable** | US$16.53 | US$17.36 | **≈ CAD 24.82** |
| Recommended: website always on (+ Render Starter $7) | US$23.53 | US$24.71 | ≈ CAD 35.33 |
| Lowest, worst case (Flex at its $30 cap, scanner hourly ≈ $3.50) | US$41.00 | US$43.05 | ≈ CAD 61.56 |
| Recommended, worst case | US$48.00 | US$50.40 | ≈ CAD 72.07 |
| **One-time** at activation (C7 run, one-day Flex restore target) | ≈ US$1.00 | US$1.05 | ≈ CAD 1.50 |

**Card fee:** paying USD with a CAD card usually adds a foreign-transaction fee of about 2.5 %. That is not a tax, and it brings the lowest plan to ≈ CAD 25.44.

### 2.3 Hosting facts that change the plan (found 2026-11-22)

1. **`onrender.com` is a public suffix.** Browsers treat `x.onrender.com` and `y.onrender.com` as **different sites**, so the Admin session cookie (`__Host-valida.sid`, `SameSite=Strict`) never travels from the website to the API on Render's default hostnames. **Admin sign-in cannot be tested hosted without custom subdomains of `cybervalida.com`.** The handoff already requires the same-site layout (`E1_E5_HANDOFF_2026-11-21.md` §4.1).
   - Smallest fix: two new records at Bluehost, **leaving the apex, `www`, MX, SPF, DKIM and DMARC untouched**: `app.cybervalida.com` (website, private) and `api.cybervalida.com` (API).
   - At public activation, the apex and `www` move to the website service and `ADMIN_APP_ORIGIN` becomes `https://cybervalida.com`. The short re-check in §3.4 then runs.
2. **Render custom-domain allowance.** Render states that a **newly created Hobby workspace may add at most 2 custom domains** in total; workspaces created earlier are not limited. Step 1 needs 2 (`app.`, `api.`). Public activation needs the apex, `www` and `api.`.
   - **Zero-cost check (owner, ~1 min):** Render → Workspace settings → the custom-domain count and limit.
   - If you are limited to 2: before activation, decide on Render Professional or a `www` redirect served elsewhere. Neither is priced in §2.2.
3. **Render log retention** on Hobby is **7 days** (Render documentation). This is a proposed answer to P-4 (§4.2).

### 2.4 Tax-inclusive CAD by tax location (lowest / recommended / one-time)

| Billing tax location | Rate | Lowest | Recommended | One-time |
| --- | --- | --- | --- | --- |
| AB, YT, NT, NU (GST) | 5 % | **24.82** | 35.33 | 1.50 |
| SK (GST + PST) | 11 % | 26.24 | 37.35 | 1.59 |
| BC, MB (GST + PST/RST) | 12 % | 26.47 | 37.69 | 1.60 |
| ON (HST) | 13 % | 26.71 | 38.02 | 1.62 |
| NS (HST) | 14 % | 26.95 | 38.36 | 1.63 |
| QC (GST + QST) | 14.975 % | 27.18 | 38.69 | 1.64 |
| NB, NL, PE (HST) | 15 % | 27.18 | 38.70 | 1.64 |
| Billed to Valida MB (Lithuania) **without** an EU VAT number | 21 % | 28.60 | 40.71 | 1.73 |

- **With a GST/HST registration number** on each billing profile, GST is not charged; Atlas documents this. If Valida is registered, the cost falls toward the before-tax figure, about **CAD 23.64**.
- **Billed to Valida MB with an EU VAT number:** reverse charge applies, so no VAT appears on the invoice.
- Provincial PST on hosting is applied by the provider's own rules. Confirm against your first invoice.

## 3. Exact hosted recruitment checks

**Where:** Production, kept **private** (`SITE_ACCESS=private`, `RECRUITMENT_MODE=testers`), at `main` = `60bb58a` (or the SHA you approve), on `app.cybervalida.com` and `api.cybervalida.com`.

**Data:** synthetic only, deleted through the journal afterwards. **Email:** one QA recipient you control.

**Who:**
- **Claude** prepares and checks.
- **Owner** (marked ⓞ) types every secret and does every MFA step.

### 3.1 Platform gate (existing runbooks, unchanged)

| # | Check | Pass |
| --- | --- | --- |
| P-1 | Start-up lines: `site access` private, effective `recruitment access`, `release identity` = SHA; no secret printed. The API starts with `ADMIN_AUTH=enabled`; it refuses to start if any `ADMIN_*` secret is missing or malformed | As stated |
| P-2 | **G-ACCESS R0.1–R0.10** (runbook 1 §3, `ops/review-host/check.mjs --mode production`, listed and unlisted) | Every row, every hostname, **before any synthetic Job** |
| P-3 | **R1–R14** with a synthetic open and closed Job (runbook 1 §4). Operator rows: R1, R10, R11, R12, R13 (host logs) | 13/13 automated plus the operator rows |
| P-4 | Scanner cron runs once by manual trigger: ClamAV signatures load; `CLEAN` / `QUARANTINED` / `INFECTED` written | Run log |

### 3.2 E1–E5 Admin, hosted (makes E1–E5 VERIFIED)

| # | Check | Pass (from the code on `main`) |
| --- | --- | --- |
| E-1 | `GET app…/admin/...` | 200; `Cache-Control: private, no-store`; `X-Robots-Tag: noindex, nofollow`; `Referrer-Policy: no-referrer`; no canonical or JSON-LD. Public pages never load the Admin chunk |
| E-2 | `GET api…/api/v1/admin/overview`, no cookie | **401 `AUTHENTICATION_REQUIRED`**, `Cache-Control: no-store` |
| E-3 | Same, with `Origin: https://example.org` | **403 `ORIGIN_REJECTED`**. No `Access-Control-Allow-Origin` for that origin; the Admin origin gets ACAO = itself plus `Allow-Credentials: true` |
| E-4 | ⓞ First owner: `npm run admin:provision create --email <owner mailbox> --name "<name>"` in the Render shell | Activation email arrives through Titan, or `--print-link` on a trusted terminal. The link works once within 8 h, and the token leaves the address bar on load |
| E-5 | ⓞ Password (12–128 characters), then TOTP enrolment (QR or key), then 10 recovery codes | Codes shown once; enrolment completes |
| E-6 | Cookie in devtools | `__Host-valida.sid`; Secure; HttpOnly; SameSite=Strict; Path=/; **no Domain**; sent on every API call. This proves the same-site layout of §2.3 |
| E-7 | ⓞ Sign out, then sign in with password + TOTP | The session id changes at the password step and at the MFA step; you return to the requested page |
| E-8 | 5 wrong TOTP codes | **`MFA_CHALLENGE_ENDED`**; a replayed valid code is refused |
| E-9 | 5 wrong passwords on a QA Admin | Locked 15 min. Every refusal is the generic **`INVALID_CREDENTIALS`**, and an unknown email answers the same way |
| E-10 | 31 login attempts in 15 min from one address | 31st is **429 `RATE_LIMITED`**, counted per real client behind Render's proxy (`TRUST_PROXY=2`), as R10 |
| E-11 | Idle 30 min | **401 `SESSION_EXPIRED`**. The 8 h absolute limit is enforced too: a session past it is refused and leaves the session list |
| E-12 | A high-risk action more than 10 min after sign-in | **403 `RECENT_AUTH_REQUIRED`**; after re-authentication it succeeds |
| E-13 | Password reset (forgot → email → reset) | Link valid 30 min and single use; every session revoked; MFA kept; no automatic sign-in; unknown email answers the same way |
| E-14 | Owner invites a QA `RECRUITMENT_ADMIN` | `/admins` and `/audit` → **403 `AUTHORIZATION_DENIED`**; the last-owner protection refuses removing the only owner |
| E-15 | Session list; revoke the other browser | That browser → **401 `SESSION_REVOKED`** |
| E-16 | E3: a QA Job, Draft → preview → publish → close → reopen → archive | Readiness enforced; listed tester sees it, unlisted gets R0.3's answer; each step is in the audit log |
| E-17 | **C7**: a QA candidate applies through the real public Apply (listed) | 201. The `careers@` notification arrives. The application is in the Admin list and search with the applied-role snapshot |
| E-18 | Résumé before the scan | **409 `RESUME_NOT_AVAILABLE`** signed in; **401** anonymous |
| E-19 | After the scanner run marks it `CLEAN` | Download as an attachment with `nosniff` and `private, no-store`; **`RESUME_ACCESSED` audit event written before the bytes**; R11 unauthenticated provider read refused |
| E-20 | E5: status change; a stale change from a second tab; a note; a recorded communication | History appended. **409 `STATUS_CONFLICT`** for the stale one. Notes and communications append-only. The owner audit view shows every step |
| E-21 | Argon2id timing on the instance (Doc 11 §35) | Recorded; raise `ADMIN_ARGON2_*` only if acceptable |
| E-22 | ⓞ iOS Safari: the 5-screen public checklist (pending from H2) plus Admin sign-in | No blocker |
| E-23 | Teardown | Synthetic Jobs and applications deleted through the journal; QA Admin disabled; costs recorded |

### 3.3 Recovery (Production)

| # | Check | Pass |
| --- | --- | --- |
| B-1 | `backup-copy` manual run, then `backup-manifest` after the first snapshot | `complete: true`; `PRELIMINARY: NO DEFECT FOUND` |
| B-2 | After +24 h: restore to a one-day Flex target (runbook 2 §5), damaged and healthy | **RECOVERY VERIFIED**, with RPO/RTO measured; target destroyed |

### 3.4 At public activation (after DNS approval)

| # | Check | Pass |
| --- | --- | --- |
| D-1 | Apex and `www` on Render; TLS on both; `www` → apex one 301 | R4, R14 on the canonical host |
| D-2 | `ADMIN_APP_ORIGIN=https://cybervalida.com`; re-run E-1, E-2, E-3, E-6, E-7 | As §3.2 |
| D-3 | `SITE_ACCESS=public`, indexing on: R3 with `--indexing true`; HSTS (P9) | As runbook |
| D-4 | DMARC `rua=` visible; one message's headers show SPF, DKIM and DMARC pass | Headers, addresses redacted |
| D-5 | Real vacancy published; `RECRUITMENT_MODE=open` (E6); JobPosting with `applicantLocationRequirements` validated (G7); then E7 end-to-end | Doc 18 §§246–252 |

## 4. Outstanding inputs (owner)

### 4.1 Vacancy (P-6): the Cybersecurity Specialist Draft

`backend/provisioning/jobs/cybersecurity-specialist.json` stays DRAFT, and publication is refused (`AWAITING_INPUT`), until each of these is supplied. **Nothing may be invented** (Doc 12 §45).

| Field | Needed |
| --- | --- |
| `eligibleWorkCountries` | The ISO countries from which Valida may employ someone in this remote role, or a decision that none are stated yet. **This also drives the privacy applicability review (P-5)** |
| `location` | The physical work location; "British Columbia, Canada" is only the historical planning value |
| `employmentType` | For example employee or contractor, part-time |
| `schedule` | Final wording (30 h/week is planning data) |
| `description`, `responsibilities`, `requirements` | Real text |
| `preferredQualifications`, `screeningQuestions`, `closesAt` | Each "none" or the real value |
| Confirm planning data | Title, fully remote, 30 h/week, CAD 35.00/h gross |
| `applicationConfig` | Collect phone? Collect a message? (both off by default) |

### 4.2 Privacy

| ID | Input | Ready-to-confirm proposal |
| --- | --- | --- |
| P-1 | Privacy contact method | `careers@cybervalida.com`, **only if you designate it** |
| P-2 | Provider inventory (Doc 13 §§197–198) | Render (Frankfurt: API, website, logs, scanner); MongoDB Atlas (Frankfurt: applications, Admin accounts, sessions, audit); AWS S3 (Frankfurt: résumés, backups); GitHub Actions (backup copy runs); Titan / Bluehost (email: **its data location is to be confirmed**). Each provider's data processing terms accepted, and the transfer basis for these US companies (EU–US DPF or SCCs), are **for you or your adviser to confirm** |
| P-3 | Recruitment retention period | **Your determination**; nothing is deleted automatically until then |
| P-4 | Log destination and retention | Render logs, **7 days** on Hobby; no IP, user agent, body or cookie in the access log |
| P-5 | Legal and privacy review of `/privacy` and `/legal` (Lithuanian entity, GDPR) | Required before public deployment (Doc 06 §§169, 178) |
| New | Admin personal data (accounts, sessions with a device label, audit events) is not yet in `docs/privacy/DATA_INVENTORY.md` | I can draft the entry at $0 for your review |

### 4.3 Other inputs

- **Billing:** the tax province, or the billing entity (personal in Canada, or Valida MB); any GST/HST or EU VAT number; the tax line from the Nov 19–21 invoices.
- **Render:** the workspace custom-domain limit (§2.3.2).
- **Release D:** the DMARC `rua=` mailbox; mailbox MFA on `shervin@`, `careers@` and `info@` (D2); the sender stays `careers@` through Titan (D3, recommended, $0).
- **From H2:** the iOS Safari answers and one email's headers, addresses redacted.
- **Monitoring gaps:** application-error alerting and an uptime monitor. Both have $0 options: Sentry Developer (EU) and UptimeRobot free. The alternative is to accept native alerts only.
- **Records:** the Doc 00 entry for OD-2026-11-21-01. Deleting the `e-work-write-time` branch (left for later).

## 5. Approvals requested (each separate; none is given by this document)

| # | Approval | Cost | Unblocks |
| --- | --- | --- | --- |
| A-1 | **Spending:** the lowest plan, ≈ **CAD 24.82/month** at 5 % GST (CAD 26.47 at 12 %, worst case CAD 61.56), plus ≈ CAD 1.50 one-time. Or the recommended plan, ≈ CAD 35.33 | §2 | Production: Atlas Flex "Valida Production", Render API Starter + website (free) + scanner cron, S3 |
| A-2 | **DNS, private stage:** add `app.cybervalida.com` and `api.cybervalida.com` at Bluehost; nothing else changes | $0 | §3.1–§3.3 (Admin sign-in needs same-site hosts) |
| A-3 | **Production deployment** of the approved SHA, private, with synthetic data only | within A-1 | §3 |
| A-4 | **DNS, public:** apex and `www` to Render, TLS, DMARC `rua=` | $0 | §3.4 |
| A-5 | **Public recruitment activation:** `SITE_ACCESS=public`, the real vacancy, `RECRUITMENT_MODE=open` (E6), then E7 | — | Launch. Needs §4.1 and §4.2 first |

**Smallest next step:** answer §4.3 "Billing" and "Render" (both at $0). Then approve A-1, A-2 and A-3 together. That lets the whole of §3 run in one hosted session, with Claude doing everything except the steps marked ⓞ.

## 6. Sources (read 2026-11-22)

- MongoDB Atlas, [international usage and taxes](https://mongodb.com/docs/atlas/billing/international-usage): GST charged without a GST number.
- AWS, [Canada tax help](https://aws.amazon.com/tax-help/canada).
- Render: [cron jobs](https://render.com/docs/cronjobs) ($1 minimum); [logging](https://render.com/docs/logging) (Hobby 7 days); [custom domains](https://render.com/docs/custom-domains) and [platform features by plan](https://render.com/docs/platform-features-by-plan.md); Hobby limited to 2 custom domains per the Render changelog.
- `onrender.com` on the Public Suffix List: [Render community](https://community.render.com/t/setting-samesite-attribute-for-cookies-from-different-render-domains/16868); [publicsuffix.org](https://publicsuffix.org/learn/).
- USD/CAD mid-November 2026 ≈ 1.42–1.43: market references; the [Bank of Canada lookup](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/) is authoritative.
