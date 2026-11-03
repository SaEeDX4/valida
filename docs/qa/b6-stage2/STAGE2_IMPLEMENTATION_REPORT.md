# B6 Stage 2 — implementation report (template version `b6-2`, approved logo integrated)

| | |
| --- | --- |
| Date | 2026-10-26 to 2026-10-27 (America/Vancouver; sandbox clock times below are UTC−7) |
| Update | **2026-10-27 (r2, r3) — no product runtime, test or verification-script change:** the owner-run Windows log registered as **EV-S2-W1** (§7.4; [`WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md`](WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md)); the Windows expectations corrected (§9); the DEP0190 warning assessed (§8); the Stage 3 plan prepared ([`STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md`](../b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md)); **r3:** the owner's package-verification transcript registered as **EV-S2-W2**, the Stage 3 coverage made explicit for both templates, a bounce-procedure decision sheet prepared. **Scope, stated exactly:** no file under `backend/` or `frontend/` changed — no product runtime code, no test, no `verify:*` script. **One new QA diagnostic script was added and executed:** `docs/qa/b6-stage2/tools/dep0190_trigger_probe.mjs` (r2), run three times in the sandbox (`node -e 0` children only; output `evidence/windows/dep0190-trigger-probe.log`); it is not part of the product, the test suites or `verify:b6`. The rest is documentation and preserved owner evidence. **r4 (2026-10-27) — no product runtime, template, test or verification-script change:** the owner's offline Outlook classic screenshots registered as **EV-S3-OC1** and findings F-01…F-04 analysed, with candidates PROPOSED ([`../b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md`](../b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md), [`../b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md`](../b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md)). **r6 (2026-11-02):** the current build is template **`b6-3`** (C2 masthead, `CAREERS` removed, P-04 — OD-2026-11-02-01), reported in [`../b6-3/B6-3_IMPLEMENTATION_REPORT.md`](../b6-3/B6-3_IMPLEMENTATION_REPORT.md). This report remains the record of `b6-2`; its evidence is not evidence for `b6-3`. |
| Authorisation | **OD-2026-10-26-03** ([record](../../review/OWNER_DECISION_2026-10-26-03_B6_STAGE2_AUTHORISATION.md)): Stage 2 and its sandbox test environment. **OD-2026-10-27-01** ([record](../../review/OWNER_DECISION_2026-10-27-01_B6_LOGO_ASSET.md)): the derived logo `b8c54174…341a` approved with its black field, and its Stage 2 integration. OD-2026-10-26-01 and -02 unchanged. |
| Result | **READY FOR GPT REVIEW.** Both emails are `b6-2` with the approved copy, the grapheme subject rule, the UTC timestamp and the **approved logo as one inline CID part**. T-01…T-12, the asset tests included, were executed **against the integrated deliverable** in the sandbox (offline). |
| Not established | Provider acceptance or delivery (PENDING by design); **any email-client rendering** (Stage 3, NOT RUN); five tests skipped on Windows (§7.4). Browser previews do **not** establish email-client compatibility. Real-database behaviour and Windows + Node 24 are now evidenced by the **owner's Windows run** (§7.4), not by the sandbox. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. No email sent, no account accessed, nothing committed, pushed or deployed. |

## 1. Baseline

The recovered working copy `/home/claude/recovery/valida` (local branch `b6-recovered-r9-rev6`, no commits):

| Layer | Identity |
| --- | --- |
| GitHub baseline | `SaEeDX4/valida` @ `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| B6 final r9 | `valida-B6-final-r9.zip`, SHA-256 `f11d21e65f56ba956f452dd4c7015495323b5dbbb8ab333418a31a38768634ec` (53 files) |
| rev 4 documentation | `valida-B6-r9-acceptance-docs-rev4-stage1.zip`, `f03b4be80176f6d7864e0da2eb470aa9cb74b6301da16bd3fafc56a5973d240b` |
| rev 6 overlay | `valida-B6-r9-acceptance-docs-rev6-overlay.zip`, `b91137ab217556579f653d36356a65e869b87af659e4493bb4a0fd53bae0c5a9` |

On 2026-10-27, before integrating the logo, the working copy was checked against the manifest of the 04:26 package `valida-B6-stage2-cumulative.zip` (`e32de266…252e`): 135 files, 0 mismatches, no unpackaged change. That package and the interim checkpoint remain the record of the pre-approval build. For every package the baselines are rebuilt from scratch (`git archive ec15048`, then the three ZIPs in order) and compared file by file; **no baseline file is removed**, and the lockfile and `package.json` are byte-identical to the baseline.

## 2. Environment (sandbox)

| Item | Result |
| --- | --- |
| Official Node 24 and MongoDB | **Blocked.** The sandbox proxy refuses `nodejs.org`, `fastdl.mongodb.org`, `downloads.mongodb.org`, `www.mongodb.org` and `repo.mongodb.org` (`CONNECT tunnel failed, response 403`; [`evidence/environment.txt`](evidence/environment.txt)). No official checksum could be checked. |
| Node used | **v24.21.0** — the runtime bundled with the pre-installed Playwright package (SHA-256 `0a05402f…9414`); V8 13.6.233.17-node.53, **ICU 78.3, Unicode 17.0**, CLDR 48.0, tz 2026c. Provenance **not verifiable** → **development evidence only**; it does not stand in for the owner's Node 24 run. Node 22 was not used for any result. |
| npm | 10.9.9 (the image's npm, executed by the Node 24 binary) |
| `npm ci` (backend, existing lockfile) | Completed — "added 170 packages" (no exit-code line in the log). Lockfile `c539a7e0…30fa` and `package.json` `3cf13f01…a083` unchanged. No dependency added or upgraded; no `npm audit fix`; engines unchanged. |
| MongoDB | **Not available.** The database gates were **NOT RUN**. |
| Lint | **The project has no lint tooling** (no ESLint/Prettier/Biome dependency or script); adding one would add a dependency, which is not permitted. Not run. `node --check` (syntax only) is recorded instead. |
| Previews / logo tooling | Chromium 153.0.8010.12 (Playwright, headless); Pillow 12.3.0, Python 3.13.17 |

## 3. What changed (against r9 + rev 6)

**Runtime code: three files** (`templates.js`, `smtpTransport.js`, new `emailLogo.js`) and the asset. Everything else is tests, review material and documentation. The full list with hashes is [`STAGE2_DELTA_MANIFEST.sha256`](STAGE2_DELTA_MANIFEST.sha256).

| File | Change |
| --- | --- |
| `backend/src/integrations/notifications/templates.js` | `b6-2` (SHA-256 `9d8e998c…9534`): Concept A HTML and plain text for both events; exact approved copy; `headerText` grapheme rule; `formatTimestamp` UTC; `singleLine` also makes input well-formed; the header logo (`cid:`, 158 × 36, `alt="Valida"`); the `CAREERS` label hidden at ≤ 480 px where the client honours the media query |
| `backend/src/integrations/notifications/emailLogo.js` (new) | The logo's constants (file, approved SHA-256, Content-ID `valida-logo.b6@cybervalida.com`, filename `valida-logo.png`, 158 × 36, alt); `emailLogoBytes()` reads the asset once and **refuses** bytes that do not match the approved hash |
| `backend/src/integrations/notifications/assets/valida-logo-email-316x72.png`, `SHA256SUMS.txt` (new) | The approved asset, byte-identical to the reviewed candidate (`b8c54174…341a`, 13,303 B) |
| `backend/src/integrations/notifications/smtpTransport.js` | `compose()` only: when the HTML references the logo's Content-ID, **one** inline `image/png` related part. Message-ID, `Auto-Submitted`, DSN parameters, From, Reply-To, envelope, sessions, timeouts and classification are unchanged (T-09) |
| `backend/tests/b6-stage2-templates.test.js` (new) | T-01…T-12, the asset tests included; one assertion added after the reviewed patch (§5) |
| `backend/tests/fixtures/mimeInspect.js` (new), `localSmtpServer.js` | Strict MIME / RFC 2047 / RFC 2231 decoder; RCPT TO parameters recorded (ORCPT check) |
| `backend/tests/b6-notification-service.test.js`, `b6-apply-notifications.test.js`, `b6-smtp-integration.test.js`, `apply-failures.test.js` | b6-1 expectations replaced by b6-2; checks of decoded rather than raw quoted-printable text; exactly one CID image allowed where "no image" was asserted |
| `backend/tests/db/b6-smoke-rehearsal.test.js` | Its raw-byte title match replaced by checks of the decoded Subject, plain-text and HTML parts (b6-2 encodes them). **Not executed here** (needs MongoDB) |
| `backend/tests/b6-gate.test.js`, `backend/scripts/verify-b6.mjs` | The new test file added to the B6 acceptance gate |
| `backend/README.md` | The `b6-2` template section and the logo paragraph; the adapter table's "no attachments" now names the one inline logo part as the only exception |
| `docs/qa/b6-stage2/**` | This report, the README, fixtures, previews, logo material, evidence logs, scripts, the delta manifest |
| `docs/review/OWNER_DECISION_2026-10-26-03_…`, `OWNER_DECISION_2026-10-27-01_…` (new) | The authorisation and the logo approval |
| `docs/review/B6_ACCEPTANCE_CHECKLIST.md`, `B6_DECISION_PACKAGE.md`, `IMPLEMENTATION_PLANS_…`, `docs/design/EMAIL_CONCEPT_A_SPEC.md`, `EMAIL_COPY_PROPOSAL.md` | Status records (rev 7 Stage 2, rev 8 logo). The approved copy and the specification text are unchanged |

**Unchanged (no file touched):** `notificationService.js`, `transport.js`, `application.*`, readiness, configuration, models, the frontend and the website copy — so recipients, routing, acceptance, persistence, eligibility, `APPLICATION_ACKNOWLEDGEMENT_ENABLED`, claims, retries, idempotency and the provider gate are as in r9.

## 4. What `b6-2` sends

- **Copy:** the subjects, preheaders, labels and bodies of OD-2026-10-26-02, verbatim (T-01). Internal: role title, role identifier, `Received (UTC): YYYY-MM-DD HH:MM:SS`, Application reference — no candidate data. Acknowledgement: receipt only.
- **Subject rule:** only the title segment is limited — at most 120 extended grapheme clusters including `…` (119 kept, trailing white space trimmed); the prefix and ` | Valida` are never shortened. The body keeps the full title.
- **Untrusted input:** well-formed (lone surrogates → U+FFFD), controls, line separators and bidi formatting removed, one line, HTML-escaped; CR/LF cannot create a header.
- **HTML:** one 600 px column of presentation tables; inline critical styles; explicit Concept A colours on every text element and cell; `lang="en" dir="ltr"`; one `h1`; hidden preheader; dark `color-scheme`; ≤ 480 px media query as enhancement; Outlook-only wrapper and font override; font stacks ending in Segoe UI / Arial / Helvetica. **The only image is the approved logo, carried in the message**; no links, scripts, forms, remote resources, web fonts or tracking. Plain text carries the same information.
- **MIME:** `multipart/alternative[text/plain, multipart/related[text/html, image/png]]`; text parts UTF-8 quoted-printable; the PNG base64, `Content-Disposition: inline; filename="valida-logo.png"`, `Content-ID: <valida-logo.b6@cybervalida.com>`.
- **Sizes (synthetic values, [`fixtures/fixtures-index.json`](fixtures/fixtures-index.json)):** internal HTML 9,675 B, message 30,277 B; acknowledgement HTML 5,926 B, message 26,096 B; long values 31,000 B — all under the 40 KB limit.

## 5. Logo — approval and integration

| | Source (approved 2026-09-10) | Derived asset (approved 2026-10-27, OD-2026-10-27-01) |
| --- | --- | --- |
| File | `frontend/public/brand/valida-logo-horizontal-dark.png` | `backend/src/integrations/notifications/assets/valida-logo-email-316x72.png` (= [`logo/valida-logo-email-316x72.candidate.png`](logo/valida-logo-email-316x72.candidate.png)) |
| SHA-256 | `920db434d9e20eb99ec8ba417b1e164eb2e72db8e31eb6a8f04f99f814d2dc5e` | `b8c541749d0869f2473cc3344e6de5e8ecea9813bb106feb1fc3531602c8341a` |
| Pixels, size | 1009 × 230, 8-bit RGB, 68,770 B | 316 × 72, 8-bit RGB, 13,303 B (IHDR, IDAT, IEND only); shown at 158 × 36 |

The black (`#000000`) field shows as a faint rectangle on the `#05070A` header; the owner accepted it as shown in the previews. **Integration (log [I0](evidence/integrated/I0-patch-apply.log)):** the reviewed patch [`logo/logo-integration.patch`](logo/logo-integration.patch) (SHA-256 `767f492e…a00`; named `…NOT-APPLIED.patch` until it was applied — bytes unchanged) was checked and applied with `git apply --binary` (exit 0 each). The asset equals the approved bytes (`cmp` identical), and the integrated code equals the code tested on 2026-10-26 in the scratch copy (0 differences outside README and the database test). **Two changes after the patch, both disclosed here:** one assertion in T-08 pins the approved hash as a literal, independent of the code under test; and the README adapter table's attachment statement was corrected.

## 6. Tests T-01…T-12 against the integrated deliverable

Basis: run **I1** (verbose reporter — every test is named in the log) and **I2**.

| Test | What it proves | Result |
| --- | --- | --- |
| T-01 | `b6-2`; exact approved subject, preheader, labels and text of both emails; receipt-only wording | PASS |
| T-02 | lang/dir, one `h1`, presentation tables, explicit colours; **the only `img` is the CID logo, 158 × 36, `alt="Valida"`**; no prohibited element or resource | PASS |
| T-03 | Every HTML text is in the plain text and vice versa | PASS |
| T-04 | Escaping; no control/bidi characters; lone surrogates; a CR/LF title through the real adapter adds no header; missing inputs refused | PASS |
| T-05 | 120 / 121 boundary; ZWJ emoji, flags, skin tone, keycaps, combining marks, Hangul jamo, astral characters never split; prefix and suffix whole; decoded Subject on the wire equals the rendered subject; ICU present | PASS |
| T-06 | 160-character title, 120-character slug, 24-hex reference: no width over 600 px; no fixed text heights | PASS |
| T-07 | Real Apply → real adapter → local SMTP server, ASCII and non-ASCII markers for every candidate field: **internal** — none in raw bytes, decoded headers, decoded parts (HTML also with references decoded), MAIL FROM, DSN or RCPT parameters; **acknowledgement** — the address only in `To` and RCPT TO (ORCPT only `rfc822;<same recipient>`), no display name; structure with the logo part | PASS |
| T-08 | The MIME tree above; the PNG's bytes equal the approved asset **and** the literal approved hash; base64, inline, constant filename and Content-ID; HTML ≤ 20 KB; message ≤ 40 KB. A mismatched asset is refused. A message whose HTML does not reference the logo gets no attachment | PASS (3 tests) |
| T-09 | Message-ID token, `Auto-Submitted`, From, Reply-To, To, no X-Mailer, DSN parameters, envelope sender | PASS |
| T-10 | Same `Received (UTC)` under UTC, America/Vancouver, Asia/Tehran, Pacific/Kiritimati, Pacific/Pago_Pago | PASS |
| T-11 | `’`, `·`, `—` encoded 7-bit on the wire and decoded exactly | PASS |
| T-12 | No test or synthetic vacancy label in the template source or output | PASS |

## 7. Test evidence — classes kept apart

All runs: Claude's sandbox, Linux, Node v24.21.0 of unverified provenance. **None of this is Windows evidence.** Only the logs are relied on; "not logged" means the log has no exit-code line.

### 7.1 The integrated deliverable (2026-10-27) — [`evidence/integrated/`](evidence/integrated/)

| # | What ran | Exit | Result (from the log) |
| --- | --- | --- | --- |
| [I0](evidence/integrated/I0-patch-apply.log) | Patch check and apply on the working copy; before/after hashes; asset comparison | 0, 0 | Applied; asset = approved bytes; code = the 2026-10-26 scratch copy's code |
| [I1](evidence/integrated/I1-focused-verbose.log) | `vitest run --reporter=verbose` of the seven affected files (`b6-stage2-templates`, `b6-notification-service`, `b6-apply-notifications`, `apply-failures`, `b6-smtp-integration`, `b6-smtp-transport`, `b6-nodemailer-contract`) | 0 | 7 files; **278 passed**; the 32 Stage 2 tests each named, no `todo` |
| [I2](evidence/integrated/I2-verify-b6.log) | `npm run verify:b6` | **1** | Node 24 **PASS**; offline suite **PASS** (54 files; 2228 passed, 1 skipped); B6 gate **PASS** (14 files; **458 passed**); B5 gate **PASS** (5 files; 236); B4 gate **PASS** (14 files; 584, 1 skipped); **B6 real-database gate FAIL — `MONGODB_TEST_URI` not set**; provider **PENDING**. The exit code comes only from the database gate |
| [I3](evidence/integrated/I3-mutation-checks.log) | Mutation checks, each in a fresh scratch copy of `backend/` ([`tools/mutation_integrated.py`](tools/mutation_integrated.py)) | 0 / 1 ×5 | **M0** control: T-07 + T-08 pass (4 tests). **M1** internal plain-text leak, **M2** internal HTML leak as numeric references only, **M3** acknowledgement HTML leak: T-07 fails (8, 4, 12 hits). **M4** asset replaced by other PNG bytes: T-08 fails on the hash. **M5** `compose()` stops attaching the logo: T-08 fails on the structure |
| [I4](evidence/integrated/I4-logo-mismatch-probe.log) | The real service and adapter with the M4 asset ([`tools/logo_mismatch_probe.mjs`](tools/logo_mismatch_probe.mjs)) | 0 | Both events `FAILED / PROVIDER_ERROR` (class UNCERTAIN; diagnostic `COMPOSE_FAILED`); **0 messages and 0 MAIL FROM reached the server** — fails closed, never a substitute image (finding 4, §8) |
| [I5](evidence/integrated/I5-rehearsal-assertion-probe.log) | Probe of the changed database assertion against the integrated MIME (no database; not the test itself) | 0 ×3 | Smoke title: old raw match false, new decoded Subject / text / HTML true; control title: new checks false |
| [I6](evidence/integrated/I6-node-check.log) | `node --check` on 13 changed JavaScript files | 0 each | Syntax only — not lint |
| [I7](evidence/integrated/I7-fixtures.log) | Fixtures and EMLs from the integrated build ([`tools/make_fixtures_integrated.mjs`](tools/make_fixtures_integrated.mjs)); privacy spot-check of the EMLs ([`tools/fixture_privacy_check.mjs`](tools/fixture_privacy_check.mjs)) | 0, 0 | Structure as §4 in all three; logo hash approved in all three; synthetic candidate address: none in the internal messages, only `To` in the acknowledgement |
| [I8](evidence/integrated/I8-previews.log) | Chromium previews ([`tools/make_previews_integrated.py`](tools/make_previews_integrated.py)) | 0 | No horizontal overflow at 680 / 390 / 320 px; logo 158 × 36 loaded from the EML's own part; `CAREERS` hidden at 390 / 320; with the image not loaded, its alt text shows. **Browser only** |

Files changed since I2: none that I1, I2 or I3 executed (documentation and fixtures only).

### 7.2 Earlier results (2026-10-26) — kept separate; not evidence for the integrated deliverable — [`evidence/`](evidence/)

**(a) The pre-approval build without the logo** (superseded by 7.1): baseline offline suite before Stage 2 — 53 files, 2196 passed, 1 skipped, exit 0 ([`baseline-offline.log`](evidence/baseline-offline.log)); `verify:b6` — offline 2226 passed / 1 skipped / 2 todo, B6 gate 456 passed / 2 todo, B5 236, B4 584 / 1 skipped, database gate FAIL (no MongoDB), exit 1 ([`verify-b6-stage2.log`](evidence/verify-b6-stage2.log)); T-07 mutations, control pass and three leaks caught ([`mutation-checks.log`](evidence/mutation-checks.log)); the rehearsal-assertion probe ([`rehearsal-assertion-probe.log`](evidence/rehearsal-assertion-probe.log)); `node --check` ([`node-check.log`](evidence/node-check.log)); set-up ([`npm-ci-backend.log`](evidence/npm-ci-backend.log), [`lock-before.txt`](evidence/lock-before.txt), [`environment.txt`](evidence/environment.txt)). Its fixtures and previews are in `fixtures/` and `previews/` under `superseded-no-logo-2026-10-26/`.

**(b) The logo patch in a throwaway scratch copy** (before approval): patch applied in `/home/claude/recovery/patch-validate`, offline suite 54 files, 2228 passed, 1 skipped, no `todo` ([`patch-validate-offline.log`](evidence/patch-validate-offline.log)); `git apply --check` against the then working copy, exit 0 ([`patch-apply-check.log`](evidence/patch-apply-check.log)); the scratch copy's code equal to working copy + patch ([`patch-scratch-vs-current.log`](evidence/patch-scratch-vs-current.log)). These runs showed the patch worked; they are **superseded** as evidence by I1–I3 on the deliverable itself.

### 7.3 Not run — the remaining gaps

| Gap | Why | Who / when |
| --- | --- | --- |
| **Database:** every real-database suite (`tests/db/**`): the B6 real-database gate, the live-procedure rehearsal with its changed assertion, the cleanup suite, B2–B5 database tests, `db:indexes:*` | No MongoDB in the sandbox (downloads blocked) | **Done by the owner's Windows run** (§7.4): 145 passed; indexes 6/6 |
| **Runtime provenance:** `verify:b6` to exit 2 on Node 24 outside the sandbox | Only a Playwright-bundled Node 24 was available here | **Done by the owner's Windows run** (§7.4): Node v24.21.0, exit 2; the installer's origin is the owner's and is not in the log |
| **Five tests skipped on Windows** (addendum §3): one Windows directory-symlink test never executed anywhere; three POSIX-only tests whose Windows junction or privileged variants are untested; one platform-inapplicable | Platform conditions; no Developer Mode or elevation on the owner's machine | Optional targeted run of the one Windows test; junction variants are B4 test additions, separately authorised |
| Lint | No lint tooling in the project; adding it is not permitted | A project decision |
| Live Titan smoke test, any real send | Not authorised | — |
| **Stage 3 email-client rendering:** Gmail web and mobile; Outlook Classic on Windows; Outlook Web; Apple Mail on macOS and iOS; light and dark modes; images on and off; 320, 390 and 600 px; long titles and identifiers; 200 % text; reading order; the plain-text part | Separately authorised. The Chromium previews show only how a browser renders the HTML — **not** how any mail client renders the message, handles the CID image, applies dark mode or lists inline images | **Every cell NOT RUN.** Plan: [`STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md`](../b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md). r4: owner-run offline Outlook classic inspection (EV-S3-OC1); **r5 correction:** that inspection was authorised (Outlook classic, offline only) and is partial evidence for cell A1-OC — not "preliminary"; the C2+P04 mockups were also seen in Outlook (EV-S3-OC2); findings F-01…F-04 OPEN |

### 7.4 Owner-run Windows evidence (2026-10-27) — EV-S2-W1 and EV-S2-W2

The owner ran `npm run verify:b6` on Windows on the integrated package; the log is preserved byte for byte ([`evidence/windows/verify-b6-stage2-logo-windows-20261027-050012.log`](evidence/windows/verify-b6-stage2-logo-windows-20261027-050012.log), SHA-256 `d0b3bc71d45e54c8c3259dd4ddb36cd4ce486765221861ddb73f50d9bc115cb5`) and registered in [`WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md`](WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md). The owner reports that GPT inspected it independently; Claude re-read it.

| Section | Result (from the log) |
| --- | --- |
| Runtime | Node v24.21.0, win32 x64, Windows_NT 10.0.26300 |
| Offline suite (complete) | 54 files; **2224 passed, 5 skipped** |
| B6 / B5 / B4 gates (re-runs of offline subsets) | 458 passed / 236 passed / 580 passed, 5 skipped |
| Real-database suite (complete) | MongoDB 8.0.9; 14 files; **145 passed** |
| B6 real-database gate; rehearsal and cleanup (re-runs of database subsets) | 16 passed; 17 passed |
| Required indexes | 6/6 after apply; 6/6 at the check |
| Provider | **PENDING** by design |
| Exit | `WINDOWS_EXIT_CODE=2` — every available gate passed |

**Distinct test cases:** 2229 offline + 145 database = 2374 defined, **2369 executed and passed, 5 skipped**; the gate figures are repeats and are not added. The log identifies the integrated build by its folder and tests (Stage 2 file: 32 tests, no `todo`; B6 gate 458); folder names and test counts alone do not prove which bytes were tested. **Package identity rests on EV-S2-W2**, the owner's separate PowerShell transcript ([`evidence/windows/owner-package-verification-transcript-20261027.txt`](evidence/windows/owner-package-verification-transcript-20261027.txt), SHA-256 `d083d6b18b950dc3a0b856afa697f225543d18144e4c1abf5a71b0d218b22856`, preserved byte for byte): ZIP `0797a7fd…b71b` and manifest `0d9ffad9…a8d3` hashes matched; a fresh clone at `ec15048` without line-ending conversion; the package expanded; **all 183 files matched** (a first pass stopped at the manifest's `#` header line before checking any file; the second pass skipped header lines and passed). Both records name the same folder; the transcript has no timestamps, and neither shows `npm ci` or the lockfile hash (addendum §1). No repeat run is requested. The five skips and the DEP0190 warning: §8, items 7 and 8.

## 8. Limitations and findings

1. **Database evidence comes only from the owner's Windows run** (§7.4): the sandbox ran no database suite. The changed rehearsal assertion passed there (rehearsal 6 tests within the 145).
2. **Node provenance** — the sandbox results come from a Node 24 binary without an official checksum (development evidence only); the owner's Windows run used Node v24.21.0 on the owner's installation.
3. **No lint** — §2.
4. **A mismatched logo asset fails closed, conservatively classified (I4).** Composition is refused before any connection; nothing is sent; both notifications are recorded `FAILED / PROVIDER_ERROR` (UNCERTAIN, diagnostic `COMPOSE_FAILED`, `phase: connect`). That mapping of composition failures is **r9 behaviour**, unchanged: UNCERTAIN codes are retried only by an operator, so the failure cannot cause a duplicate, but an operator sees a provider-type code for what is a packaging fault. Changing the classification would change retry rules, which Stage 2 must not do — recorded for review, not changed.
5. **Inline image presentation.** Some clients list inline images as attachments; the specification (§7.2) accepts that, provided the file is the approved logo. Not verified here — Stage 3.
6. **Fonts in previews.** Inter is installed in the sandbox and Space Grotesk is not; no web fonts are delivered, so most clients will show Segoe UI / Arial (see the fallback-font preview).
7. **Five tests skip on Windows** (addendum §3). `private-storage.test.js:113` and `:482` and `temp-upload-area.test.js:186` run only on POSIX (`it.runIf(isPosix)`); `private-storage.test.js:120` is platform-inapplicable (POSIX mode bits; the code skips that check on Windows by design); `storage-link-confinement.test.js:326` is Windows-only and skips itself when creating a directory symbolic link fails with `EPERM` (no Developer Mode or elevation) — it has never been executed anywhere. **Correction:** this report's earlier expectation that the Windows-only test would run on Windows was wrong.
8. **DEP0190 on Windows** (addendum §4). Raised by the `run()` helper of `verify-b6.mjs` (and the same helper in `verify-b2…b5`): `spawnSync` with `shell: true` (Windows only) and an argument array; printed at the first `await`, hence at the database section. All arguments are script literals; no input reaches the command line. Developer tooling only. Recommended disposition: accept for B6; follow-up **TOOL-DEP0190** (run Vitest and the index script through `process.execPath`, no shell), separately authorised. Nothing changed here.

## 9. Owner's Windows verification — the integrated version only

Run this on the **integrated** package; the superseded no-logo build needs no Windows run. Use a separate folder. Nothing below sends email. **Done by the owner on 2026-10-27 with `valida-B6-stage2-logo-cumulative.zip` (EV-S2-W1).** The owner's package checks are recorded separately as EV-S2-W2 (§7.4). For a fresh copy, `valida-B6-stage2-logo-r3-cumulative.zip` and its manifest can be used in steps 2–3 instead; its code files are identical (§10), so the run need not be repeated. The manifests begin with `#` header lines; step 3 below skips them (a check that does not skip them stops at the first line, as in EV-S2-W2's first pass).

```powershell
# 1. A clean copy of the GitHub baseline (no commit is made)
git clone https://github.com/SaEeDX4/valida.git valida-b6-stage2-logo
cd valida-b6-stage2-logo
git checkout --detach ec15048980c9e3e8134de4b3d7eeadc89b1aef96

# 2. Check the package hash against the value delivered with it, then expand it over the clone
(Get-FileHash -Algorithm SHA256 ..\valida-B6-stage2-logo-cumulative.zip).Hash
Expand-Archive -Path ..\valida-B6-stage2-logo-cumulative.zip -DestinationPath . -Force

# 3. Verify every file against the cumulative manifest (expect: mismatches 0)
$bad = 0; $n = 0
Get-Content -LiteralPath ..\valida-B6-stage2-logo-cumulative.manifest.sha256 | Where-Object { $_ -match '^[0-9a-f]{64}  ' } | ForEach-Object {
  $hash, $file = $_ -split '  ', 2; $n++
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower() -ne $hash) { "MISMATCH $file"; $bad++ }
}
"files: $n  mismatches: $bad"

# 4. The approved logo is the integrated asset (expect B8C541749D0869F2473CC3344E6DE5E8ECEA9813BB106FEB1FC3531602C8341A)
(Get-FileHash -Algorithm SHA256 .\backend\src\integrations\notifications\assets\valida-logo-email-316x72.png).Hash

# 5. Runtime and dependencies (Node must be 24.x; the lockfile does not change)
node -v; npm -v
node -p "'ICU ' + process.versions.icu + ' / Unicode ' + process.versions.unicode"
cd backend
npm ci
(Get-FileHash -Algorithm SHA256 .\package-lock.json).Hash   # expect C539A7E0EC19FB2E67822481A0E07C1C3120529180EF653F7610C5B4385930FA

# 6. The B6 gate with the local test database (MongoDB running locally, as for B5)
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b6 *> ..\verify-b6-stage2-logo-windows.log
"exit=$LASTEXITCODE"          # expected: exit=2 — every gate PASS, the provider gate PENDING
Get-Content ..\verify-b6-stage2-logo-windows.log -Tail 25
Remove-Item Env:MONGODB_TEST_URI
```

**Expected (corrected 2026-10-27):** Node 24 PASS; offline suite 54 files, **2224 passed, 5 skipped** on Windows without Developer Mode or elevation (the earlier text wrongly expected the Windows-only test to run — §8 item 7); B6 acceptance gate 14 files, 458 passed; B5 236; B4 580 passed, 5 skipped; **B6 real-database gate PASS** (including the rehearsal with its changed assertion); provider **PENDING**; `exit=2`. **The owner's run of 2026-10-27 matched these figures (§7.4, EV-S2-W1)**; it does not need repeating for this package. Any other result is a finding to report, not something to adjust.

## 10. Packages

| Package | Contents | Use |
| --- | --- | --- |
| `valida-B6-stage2-logo-r3-cumulative.zip` + `.manifest.sha256` (2026-10-27, r3) | Every file that differs from `ec15048`: r9, rev 4, rev 6, Stage 2 with the integrated logo, and the r2 / r3 documentation and evidence | Reconstruction from GitHub alone (§9 steps 1–3) — **primary** |
| `valida-B6-stage2-logo-r3-update.zip` + `.manifest.sha256` | Only the files added or changed since `valida-B6-stage2-logo-r2-cumulative.zip` — documentation and the preserved transcript; **no file under `backend/` or `frontend/`**, no script | Expand over an r2 tree |
| `valida-B6-stage2-logo-r3-delta.zip` + `.manifest.sha256` | Every Stage 2 file against r9 + rev 6, including [`STAGE2_DELTA_MANIFEST.sha256`](STAGE2_DELTA_MANIFEST.sha256) | Over an r9 + rev 6 copy with no earlier Stage 2 package in it |
| `valida-B6-stage2-logo-r3-reconstruction-check.log` | The sandbox check of the three routes: tree identity with the working copy; code identical to the package run on Windows | Delivered beside the packages |
| `valida-B6-stage2-logo-r2-*` (r2) | r2: as r3 without the r3 corrections; one QA diagnostic script added (`tools/dep0190_trigger_probe.mjs`), no `backend/` or `frontend/` file | Record; superseded by r3 |
| `valida-B6-stage2-logo-cumulative.zip` (04:45) | The integrated package the owner verified (EV-S2-W2) and ran on Windows (EV-S2-W1) | Record; its code is identical to r2 and r3 |
| Earlier: `valida-B6-stage2-cumulative.zip` / `-delta.zip` (04:26) and the interim checkpoint | The pre-approval build | Record only; superseded |

The r2 reconstruction log's first line calls r2 a "documentation-only update"; r2 also added the QA diagnostic script named above. That delivered log is left unchanged; this row is the correction.

All exclude `.git`, `node_modules`, `.env` files, logs outside `docs/qa/b6-stage2/evidence/`, runtime storage, database files and real personal data. A pattern scan of every packaged file found only synthetic test markers, the empty `SMTP_PASSWORD=` placeholder in `.env.example`, and the owner's test address already masked as `<owner test mailbox, masked>` in the historical evidence. The original ZIPs and the historical evidence (`docs/qa/evidence/`, `docs/qa/B6_EVIDENCE_ADDENDUM.md` with `PENDING_MANUAL`) are unchanged.
