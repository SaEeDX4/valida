# B6 Stage 2 (integrated logo) — owner-run Windows evidence addendum

| | |
| --- | --- |
| Evidence IDs | **EV-S2-W1** — the test log. **EV-S2-W2** — the package-verification transcript. Two separate owner-run records, kept as two files and cross-referenced here (§1); neither file was altered. |
| EV-S2-W1 | [`evidence/windows/verify-b6-stage2-logo-windows-20261027-050012.log`](evidence/windows/verify-b6-stage2-logo-windows-20261027-050012.log) — preserved **byte for byte** (60,295 bytes; CRLF and ANSI colour codes as produced). SHA-256 `d0b3bc71d45e54c8c3259dd4ddb36cd4ce486765221861ddb73f50d9bc115cb5` — the value the owner gave; recomputed by Claude on the attachment and the preserved copy (`cmp`: identical). `npm run verify:b6` on the owner's Windows machine, received 2026-10-27 06:02 (America/Vancouver). The owner reports that GPT inspected it independently; Claude re-read it. |
| EV-S2-W2 | [`evidence/windows/owner-package-verification-transcript-20261027.txt`](evidence/windows/owner-package-verification-transcript-20261027.txt) — preserved **byte for byte** (6,301 bytes, CRLF; received as `c0aa501a-attachment.txt` on 2026-10-27 at 06:22). SHA-256 `d083d6b18b950dc3a0b856afa697f225543d18144e4c1abf5a71b0d218b22856`, recomputed by Claude on the attachment and the preserved copy (`cmp`: identical). An owner-run PowerShell session: tool versions, the package and manifest hash checks, the clone and checkout of `ec15048`, the expansion of the package and the file-by-file manifest verification. Its last line ("you mean this one ?") is the owner's note, kept as received. |
| Status kept | **B6 NOT ACCEPTED.** Provider gate **PENDING** by design. Stage 3 **NOT RUN**. G-SUP **CLOSED**. G-COPY **PROPOSED**. Body-discard issue **OPEN**. Vacancy **DRAFT**. |
| Personal data | The log contains the owner's local folder path (`<owner workstation path>`). It contains no credential, connection string, email address or candidate data; its B6 evidence block is the sanitised TEST-DOUBLE output. |

## 1. What was run, and on what

| Item | From the log |
| --- | --- |
| Command | `npm run verify:b6` (`node scripts/verify-b6.mjs`), run from `…/valida-b6-stage2-logo/backend` |
| Runtime | `node v24.21.0 (win32, x64)`, `Windows_NT 10.0.26300` |
| Database | test database `valida_test`, `engine: MongoDB 8.0.9` |
| Start | offline suite started 05:00:15; last section 05:05:04 (owner's local clock) |
| Final line | `WINDOWS_EXIT_CODE=2` — "every available gate passed; 1 gate(s) PENDING (real provider)" |

**Which package — established by EV-S2-W2, not by the test log.** A folder name and test counts do not prove which bytes were tested; they only show the build is not the pre-approval one (32 Stage 2 tests with no `todo`; B6 gate 458). The package identity rests on the transcript:

| Step in EV-S2-W2 | Recorded result |
| --- | --- |
| Tools | `node --version` v24.21.0; `npm --version` 11.19.0; `git version 2.48.1.windows.1`; Windows service `MongoDB` Running |
| Package hashes | `valida-B6-stage2-logo-cumulative.zip` against `0797a7fd4d5a20fd66c305b36f51065694633cffd9f26447c09455483369b71b` and its manifest against `0d9ffad9e88ea780e0a5c16649a689c781d0dd5692ac11997e92094427eca8d3` — "PASS: ZIP and manifest hashes match." Both values equal Claude's published hashes of that package. |
| Baseline | A fresh clone into `<owner workstation path>` (the script stops if the folder already exists), `core.autocrlf=false`, detached checkout of `ec15048980c9e3e8134de4b3d7eeadc89b1aef96`, `git rev-parse HEAD` compared — passed ("HEAD is now at ec15048 …") |
| Expansion | `Expand-Archive` of the package over that folder |
| First manifest pass | **Aborted at the manifest's first line** ("Invalid manifest line: # B6 cumulative: …"): the script did not skip the manifest's `#` header lines, so no file had been checked yet. Not a mismatch. |
| Second manifest pass | Header lines skipped; every listed file present and its SHA-256 equal — **"PASS: all 183 files match."** (183 = the package's file count) |

**What the two records establish together:** at verification time, the folder held the GitHub baseline `ec15048` (checked out without line-ending conversion) with exactly the 183 files of the integrated package over it, byte for byte. The test log ran `verify:b6` in `<owner workstation path>` — the same folder. **Limits:** the transcript has no timestamps, so nothing in the two files records the interval between verification and test run, or rules out a change in between (nothing indicates one); the manifest check does not look for extra files that are not in the manifest; `npm ci`, the asset hash (§9 step 4) and the lockfile hash are not in either record. No repeat run is requested for these limits.

## 2. Results — counted without double counting

`verify:b6` runs two complete suites and then **re-runs subsets** of them as named gates. The gate figures are repeat executions and are **not** added to the suite totals.

| Section | Config | Files | Result | Relation |
| --- | --- | --- | --- | --- |
| Offline suite | `vitest.config.js` | 54 | **2224 passed, 5 skipped** (2229 defined) | The complete offline suite |
| B6 acceptance gate | offline | 14 | 458 passed | Re-run of a subset of the offline suite |
| B5 acceptance gate | offline | 5 | 236 passed | Re-run of a subset |
| B4 acceptance gate | offline | 14 | 580 passed, 5 skipped | Re-run of a subset; its 5 skips are the same 5 tests as §3 |
| Real-database suite | `vitest.db.config.js` | 14 | **145 passed** | The complete database suite |
| B6 real-database gate | database | 1 | 16 passed | Re-run of `tests/db/b6-notifications.test.js`, part of the 145 |
| Rehearsal and cleanup | database | 2 | 17 passed (6 + 11) | Re-run of `b6-smoke-rehearsal` (with the assertion changed in Stage 2) and `b6-smoke-cleanup`, part of the 145 |
| Index apply / check | script | — | 6/6 and 6/6 required indexes | Script checks, not test cases |
| Provider acceptance / delivery | — | — | **PENDING** | By design; never sends email |

**Distinct test cases:** 2229 offline + 145 database = **2374 defined; 2369 executed and passed; 5 skipped (not executed)**. Not everything was executed: the 5 skips (§3), the live provider gate and Stage 3 remain.

**Against the sandbox run of the same package (report §7.1, I2):** offline 2228 passed / 1 skipped in the sandbox against 2224 / 5 here — the difference is exactly §3; B6 gate 458 = 458; B5 236 = 236; B4 584 / 1 against 580 / 5 (§3); database not run in the sandbox against 145 passed here.

## 3. The five skipped tests

Each file's skip count in the log matches the number of conditional tests in that file, so the mapping is exact. The default reporter prints counts, not skip reasons; for test 4 the reason is inferred from the code (it is the only way that test can skip on Windows).

| # | Test (file:line) | Skip condition | Linux sandbox | Windows (this log) | Classification |
| --- | --- | --- | --- | --- | --- |
| 1 | `tests/private-storage.test.js:113` — "fails when the root is a symbolic link" | `it.runIf(isPosix)`; `isPosix = process.platform !== 'win32'` | ran, passed | skipped | **Windows coverage gap (low).** The control applies on Windows: `#assertPrivateDirectory` refuses a root whose `lstat` reports a link, and Node's `lstat` is expected to report a Windows junction as a link (libuv behaviour the code relies on; not separately verified here). A junction as the root itself is not tested on Windows. The junction cases in `storage-link-confinement` (object directory, ancestors) ran and passed in this log. |
| 2 | `tests/private-storage.test.js:120` — "fails when other users can access the root (POSIX mode check)" | `it.runIf(isPosix)` | ran, passed | skipped | **Platform-inapplicable.** POSIX permission bits; on `win32` the code deliberately skips the mode / owner check (`localPrivateStorage.js`: `if (this.#platform === 'win32') return;`) because Windows mode bits express no access control. A simulated-Windows test of that rule runs on every OS. No Windows ACL check exists — a documented limitation (`backend/README.md`: choose a root inside your own profile), not a test gap. |
| 3 | `tests/private-storage.test.js:482` — "never follows a symbolic link planted at an object path" | `it.runIf(isPosix)` | ran, passed | skipped | **Residual Windows gap (privileged environments).** A file symbolic link on Windows needs Developer Mode or administrator rights, and a junction cannot point to a file. The refusal (`lstat().isFile()`) is OS-independent code, but it is not exercised on Windows. |
| 4 | `tests/storage-link-confinement.test.js:326` — "a Windows directory symbolic link as the object directory is refused like a junction" | `context.skip` when not `win32`; on `win32`, `context.skip` when `fs.symlinkSync(…, 'dir')` throws `EPERM` ("needs Developer Mode or administrator rights") | skipped (platform) — the sandbox's one skip | skipped (`EPERM`, inferred) | **Unresolved coverage gap.** This case has never been executed anywhere. It needs no code change: it runs where directory symbolic links can be created. |
| 5 | `tests/temp-upload-area.test.js:186` — "never follows a symbolic link that looks like an area" | `it.runIf(isPosix)` | ran, passed | skipped | **Windows coverage gap (low).** The start-up sweep skips any candidate whose `lstat` reports a link, which is expected to cover junctions (as in test 1); unprivileged users can create junctions, but the junction variant is not tested. |

**Correction of earlier expectations.** The integrated report's §9 (2026-10-27) expected "the Windows-only test now runs instead of being skipped"; the pre-approval report said the one skipped test was Windows-only. Both rested on the Linux run alone. Correct expectation for `verify:b6` on Windows **without** Developer Mode or elevation: offline **2224 passed, 5 skipped**; B4 gate **580 passed, 5 skipped**. With Developer Mode, test 4 is expected to run (not verified).

**Recommended disposition** (for the owner and GPT; nothing changed here):

- Test 4 — one **targeted** run closes it without code changes, because it is the only test of Windows directory symbolic links and has never run. In `backend/`, with Developer Mode on (Settings → System → For developers) or in an elevated PowerShell: `npx vitest run tests/storage-link-confinement.test.js -t "Windows directory symbolic link"` — expected `1 passed`. Not a full rerun. Optional for B6: it concerns B4 storage.
- Tests 1 and 5 — a Windows **junction** variant of each would close them; that is a test addition in B4 scope, to be separately authorised. Not needed for B6 acceptance unless the owner or GPT decide otherwise.
- Test 3 — the same, as a privileged-environment variant; low priority.
- Test 2 — no action: platform-inapplicable and documented.

## 4. The DEP0190 warning

The log shows, once, at the start of the database section:

```text
(node:13608) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
```

| Question | Finding |
| --- | --- |
| Which call | The `run()` helper of `backend/scripts/verify-b6.mjs` (line 135): `spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env })`. The same helper exists in `verify-b2.mjs`, `verify-b3.mjs`, `verify-b4.mjs` and `verify-b5.mjs`. `shell: true` is used on Windows only, because `npx` is a `.cmd` file there. |
| Why it appears at the database section | Node emits the warning at the first such call (the offline suite, `npx vitest run`) but **prints it when the event loop next runs** — in `verify-b6.mjs` that is the first `await` (`mongoose.connect` at the database gate). Reproduced in the sandbox: [`evidence/windows/dep0190-trigger-probe.log`](evidence/windows/dep0190-trigger-probe.log) ([`tools/dep0190_trigger_probe.mjs`](tools/dep0190_trigger_probe.mjs)): `shell: true` with an argument array prints DEP0190 after the synchronous part; one pre-built command string, or no shell, prints nothing. Not confirmed on Windows with `--trace-deprecation`. |
| Where the arguments come from | Every `command` and argument is a **literal in the script**: `npx` / `node`; `vitest`, `run`, `--config`, `vitest.db.config.js`; the constant test-file lists (`B6_ACCEPTANCE`, `B5_ACCEPTANCE`, `B4_ACCEPTANCE`, database file names); `scripts/db-indexes.mjs apply|check`. Values from the environment (`MONGODB_URI` from `MONGODB_TEST_URI`, `VALIDA_B6_EVIDENCE_FILE`) are passed through the `env` option, never on the command line. No user or network input reaches it. |
| Scope | Developer verification tooling only (`verify-b2…b6`). Not the server runtime, not the tests (no other `shell:` use in `src`, `tests` or other scripts), not Linux or macOS runs (no shell there; the sandbox logs show no DEP0190). |
| Risk | No exploitable injection in current use. The pattern is fragile: an argument added later containing spaces or `cmd.exe` metacharacters would be concatenated unescaped. Node may tighten this deprecation in a later major; the engine range is pinned to Node 24, so current verification is not affected. |
| Recommended disposition | **Accept for B6; no change in this task.** Record as tooling follow-up **TOOL-DEP0190**: run Vitest and the index script through `process.execPath` (the resolved Vitest CLI, `scripts/db-indexes.mjs`) so no shell is needed on any OS, in all five verify scripts — a separately authorised change, followed by a Windows re-run of the affected gates. Not a B6 acceptance blocker in Claude's assessment; the owner and GPT decide. |

## 5. What this evidence establishes — and what it does not

**Establishes** (for the integrated package `valida-B6-stage2-logo-cumulative.zip`, identified by EV-S2-W2 within the limits stated in §1): on Windows with Node v24.21.0 and MongoDB 8.0.9, every available gate of `verify:b6` passed — the offline suite with 5 documented skips, the B6 / B5 / B4 gates, the complete real-database suite including the rehearsal with the assertion changed in Stage 2, the B6 real-database gate, and the required indexes.

**Does not establish:** provider acceptance or delivery (PENDING; owner-run live test only); any email-client rendering (Stage 3, NOT RUN); the five skipped tests (§3); the origin of the owner's Node installation beyond what the records print; `npm ci`, the asset hash and the lockfile hash on Windows (in neither record); the interval between verification and test run (§1).

## 6. Files of this addendum

| File | SHA-256 |
| --- | --- |
| `evidence/windows/verify-b6-stage2-logo-windows-20261027-050012.log` (EV-S2-W1) | `d0b3bc71d45e54c8c3259dd4ddb36cd4ce486765221861ddb73f50d9bc115cb5` |
| `evidence/windows/owner-package-verification-transcript-20261027.txt` (EV-S2-W2) | `d083d6b18b950dc3a0b856afa697f225543d18144e4c1abf5a71b0d218b22856` |
| `evidence/windows/dep0190-trigger-probe.log`, `tools/dep0190_trigger_probe.mjs` (a QA diagnostic script added and executed in the sandbox — §4) | listed in [`STAGE2_DELTA_MANIFEST.sha256`](STAGE2_DELTA_MANIFEST.sha256) |

The original evidence addendum `docs/qa/B6_EVIDENCE_ADDENDUM.md` (with `PENDING_MANUAL`) and `docs/qa/evidence/` are unchanged; this is a separate addendum.
