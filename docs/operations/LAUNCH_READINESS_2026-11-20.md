# Valida launch readiness and the next hosted session (H2) — 2026-11-20

| | |
| --- | --- |
| Goal | One complete public launch of `cybervalida.com`, including recruitment, at the lowest sustainable cost on Render and MongoDB Atlas |
| Base | Hosted Review of `2b39e8e` (owner record draft `docs/review/OWNER_RECORD_2026-11-20-01_C6_HOSTED_REVIEW_2B39E8E.md`) |
| Authority | Doc 18 §§173–257 (read from the owner's Drive copy, `18_Implementation Roadmap.docx`, 2026-09-09) |
| Status | Prepared by Claude; **nothing here is authorised by its existence**. Not committed |

## 1. Where the launch stands

| Release | Requirement (Doc 18) | Status | Evidence / blocker |
| --- | --- | --- | --- |
| **C6** | Providers, Review/Production separation, CI, deployment evidence, backup | **Review done except H2 items** | Owner record draft §2; CI 9/9; restore RECOVERY VERIFIED; rollback rehearsed |
| C6 | Monitoring, email, Safari/Lighthouse, R1, R10, closed-mode readiness | **H2 done 2026-11-21**: all PASS. Open: iOS Safari evidence, email auth headers, error/uptime alerting gaps | Owner record §5; `C:\ME\Valida-H2-2026-11-21\HANDOFF.md` |
| C6 | RG: owner accepts the Review/release SHA; act I: `main` fast-forward | Open, after H2 | GHSA exception expires **2026-12-18T05:31Z** — RG and act I must land first |
| C6 | Production services, domain, backup activation (D-11) | Open, after act I | Plan §4 |
| **C7** | Live browser → frontend → API → production MongoDB → private storage → notification → response, with a QA candidate; all Doc 17 Phase 1 requirements | Not started | Needs Production (§4) |
| **D1** | Domain, DNS, registrar lock, MFA, canonical host, TLS | **Partly in place** | Registrar Network Solutions, transfer-prohibited, expires 2027-09-19; DNS at Bluehost. Apex serves a Bluehost page (ZeroSSL cert); **`www` fails TLS**. Cut-over to Render is §4 step 3 |
| D2 | `shervin@`, `careers@`, `info@` with MFA and recovery | Unverified | Titan MX live. Mailbox list and MFA state are the owner's to confirm |
| D3 | Transactional identity (`notify.` namespace preferred) | **Gap** | No `notify.cybervalida.com` records. Approved B6/Titan path sends from the Titan mailbox; D3 namespace is a decision (§5) |
| D4 | SPF, DKIM, DMARC `p=none` **with aggregate reporting** | **Gap: reporting** | SPF `include:spf.titan.email ~all` ✓; DKIM `titan1` (1024-bit) ✓; DMARC `p=none` but **no `rua=`** — proposed record §5 |
| D5 | Website ↔ domain ↔ email coherent | Not started | After D1–D4 |
| **E1–E5** | Admin auth (Argon2id, sessions, CSRF, MFA…), admin shell, Job management, secure résumé review, status/notes/audit | **Not built** — no admin code exists | §188: no "full Admin" work before Release C is VERIFIED |
| E6 | Real vacancy, LinkedIn/Indeed | Blocked | Vacancy content AWAITING INPUT (P-6); stays Draft |
| E7 | Recruitment end-to-end | Blocked | After E1–E6 |
| Privacy | P-1 contact, P-2 provider inventory, P-4 log retention, P-5 legal review | AWAITING INPUT | `docs/privacy/C4_PRIVACY_LEGAL_CHECK.md` |

**Offline checks:** nothing further is runnable offline that CI (9/9), C5 lab evidence and the Review evidence do not already cover. The one new offline result is the public DNS/RDAP audit above (2026-11-20).

## 2. Genuine launch blockers (in order)

1. ~~H2 hosted session~~ (done 2026-11-21; Safari evidence and email headers pending) → **RG** and **act I** before **2026-12-18**.
2. **Production stage + C7** (§4), with recruitment in `testers` mode only (Doc 18 §182).
3. **Release D gaps**: DNS cut-over, `www` TLS, DMARC reporting, transactional identity decision, mailbox/MFA confirmation.
4. **Release E E1–E5 implementation** — the largest item; starts only after Release C is VERIFIED.
5. **Owner inputs**: real vacancy content (P-6), privacy contact (P-1), provider inventory and log retention (P-2, P-4), legal review (P-5).
6. **D-3**: Atlas tier before Release E (M10 ≈ US$57/month vs. Flex US$8–30 with 24 h RPO, no PITR) — the lowest-cost choice must be decided explicitly.

## 3. H2 — one short hosted session (authorisation request)

**Scope:** private Review of `2b39e8e` again (same configuration plus the §4 host facts), one day, then torn down.

| # | Action | Who | Laptop? |
| --- | --- | --- | --- |
| 1 | Atlas Flex `valida-review` (Frankfurt), 5 custom roles, access list (operator address 1 week, Render Frankfurt ranges), indexes, journal-init | Claude | No |
| 2 | Six database users via `provision-review-users.mjs` with a short-lived service account and Render key, then both deleted | Owner | **Yes, ~5 min** |
| 3 | Render API + documents (starter), `2b39e8e`, `TRUST_PROXY=2`, corrected build | Claude | No |
| 4 | G-ACCESS re-run on the new hostnames: listed, then unlisted (hotspot), then listed | Claude + owner switches network | **Yes, ~3 min** |
| 5 | **Monitoring**: Render service notifications (deploy/health failures, email to the owner) and Atlas default project alerts; R13 monitor half = Render log search for the marker. *If you keep Sentry (D-4a) instead: you create the EU project and type the DSN on your phone* | Claude / owner | No |
| 6 | **Act E email**: SMTP to `smtp.titan.email:465` from one Titan mailbox you choose; you type its app password into Render (phone works) | Owner types secret | No |
| 7 | Closed-mode readiness: `/api/v1/health/ready` 200 with email configured, then `RECRUITMENT_MODE=closed` → readiness 200 and an empty Jobs list for a listed tester | Claude | No |
| 8 | R1: suspend the API → Job routes 503 with `Retry-After` → resume | Claude | No |
| 9 | R10: 11 Apply attempts from the listed laptop within 15 min → the 11th is 429 | Claude | No |
| 10 | R12: Lighthouse mobile + desktop, 3 runs each, from the listed laptop | Claude | No (runs on it) |
| 11 | Safari: you open the Review site on your **iPhone on home Wi-Fi** (5-screen checklist I send); macOS Safari only if you have a Mac | Owner | No |
| 12 | Synthetic data deleted via the journal; everything torn down; costs recorded | Claude | No |

**Email scope (act E, D-13):** internal new-application notification only; **at most 3 messages**, each from one synthetic application; **one recipient you control**, also set as `EMAIL_RECIPIENT_ALLOWLIST`; window ≤ 2 hours; `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`; no external recipient; headers kept with addresses redacted (this also gives the D4 SPF/DKIM/DMARC header test).

**Incremental cost:** ≈ US$0.75 for one day (Render 2 × starter ≈ $0.47, Atlas Flex ≈ $0.26, no scanner run); **cap US$3** (≈ CAD 4). Native monitoring and Titan add $0.

## 4. Production and C7 plan (prepared; each step needs its own authorisation)

| Step | Action | Monthly cost (USD) |
| --- | --- | --- |
| 1 | After RG: act I — fast-forward `main` to the RG SHA; required `ci` check, protected `main` (D-10) | $0 |
| 2 | Separate Atlas **project** "Valida Production", Flex Frankfurt, its own users (G4 isolation by project), journal-init; no Review data | $8–30 |
| 3 | Render Production API + documents (starter), custom domains `cybervalida.com` + `www` (redirect to apex), auto TLS; Bluehost DNS: apex A → Render, `www` CNAME → Render; old records exported first | $14 |
| 4 | Scanner cron (4 GB) daily | ≈ $0.10–1 |
| 5 | `SITE_ACCESS=public`, `RECRUITMENT_MODE=testers` (owner allowlist) — **no external recruitment** (§182) | — |
| 6 | C7: one QA application end-to-end, notification received, journal deletion after | — |
| | **Total** | **≈ $23–45** |

## 5. Release D items ready to apply (each an owner action at Bluehost/Titan)

- **DMARC with reporting** (D4 §208): `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<a mailbox you choose>@cybervalida.com; adkim=r; aspf=r; pct=100` — keep `p=none` until reports show alignment.
- **D3 decision:** send automated mail as `careers@cybervalida.com` through Titan (approved B6 path, $0), or create `notify.cybervalida.com` with a transactional provider (new provider, new cost). Recommendation for lowest cost: Titan `careers@` now; revisit at volume.
- **D2 confirmation:** list existing Titan mailboxes and confirm MFA/recovery on each.

## 6. Next executable step toward public activation

**Owner (phone is fine):**
1. Send the H2 email's headers (Titan → ⋯ → show original), with addresses redacted, and the iOS Safari answers with your iOS version.
2. Confirm the owner record (§§1–5).
3. Accept the release SHA (RG), so act I (`main` fast-forward) lands before 2026-12-18.

**Act I is ready (checked 2026-11-21):** `origin/main` is `e2c7ce7` and is an ancestor of `2b39e8e`. The fast-forward is clean (49 commits), and PR #1's head is `2b39e8e`. After the owner's RG, the step is `git push origin 2b39e8e799329428f0f68b4fb70f88f85c6eda69:refs/heads/main`. Then protect `main` with the required `ci` check (D-10, GitHub settings).
