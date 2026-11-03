# B6 `b6-3` (r6 package) — owner-run Windows + MongoDB evidence (EV-B6-3-W1)

| | |
| --- | --- |
| Evidence ID | **EV-B6-3-W1** — the owner's `npm run verify:b6` run on Windows against the r6 cumulative package (`b6-3`), received 2026-11-02 with the owner's instruction (preserved as [`../b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/owner-instruction-2026-11-02-r6-windows-outlook.txt`](../b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/owner-instruction-2026-11-02-r6-windows-outlook.txt), SHA-256 `d437e4bb7d102f58620b3ce109768002060ae8cc2f96ce1d03b17b711bf858a2`) |
| **r8 — original now preserved** | The owner sent the original inside the ZIP `B6_D6_Decision_and_Original_Evidence.zip` (`39737f37…1b2d`). Extracted and checked: **130,070 bytes, SHA-256 `f1b4ee6622aea254f032d2ce65d43fa432fe603c30390ff4fe635634bc97e897`** — equal to the owner's and GPT's value. Preserved unchanged as [`evidence/windows/verify-b6-r6-windows.log`](evidence/windows/verify-b6-r6-windows.log), beside the received copy and the derived files (§7). The rows below are the r7 record, kept as written |
| **Original log — NOT received here byte for byte** (r7) | The owner and GPT give the original's SHA-256 as `f1b4ee6622aea254f032d2ce65d43fa432fe603c30390ff4fe635634bc97e897`: a 202-byte UTF-8 header (with a byte-order mark) followed by UTF-16LE from PowerShell 5.1 `Tee-Object`. **The file that reached this session is different**: 68,336 bytes, SHA-256 `646223480910f446a7c554aa376d8fa0e2867fa82a6e6a5cf9832ce8727437ea`, no byte-order mark, **no NUL byte at all** (UTF-16LE text would have one per ASCII character), and **1,371 U+FFFD replacement characters** where the original had non-ASCII characters (dashes, the test runner's tick glyphs). It is consistent with a conversion of the mixed-encoding file to UTF-8 text on the way here. It is therefore **not** the original, and `f1b4ee…e897` cannot be checked here. GPT inspected the original; Claude inspected this copy. |
| What is preserved | [`evidence/windows/verify-b6-r6-windows.RECEIVED-COPY.log`](evidence/windows/verify-b6-r6-windows.RECEIVED-COPY.log) — **the copy as received**, unchanged (`cmp` against the attachment: identical), named so that it cannot be taken for the original. [`evidence/windows/verify-b6-r6-windows.READING-COPY.DERIVED.txt`](evidence/windows/verify-b6-r6-windows.READING-COPY.DERIVED.txt) (`e0c2ca40…50a2`) — **derived**: a six-line header saying so, then the received copy with ANSI colour codes removed; nothing else changed |
| To complete preservation (r7; **done in r8**, §7) | The owner attaches the original log **inside a ZIP** (earlier ZIPs arrived byte for byte); Claude then adds it unchanged beside the received copy and checks `f1b4ee…e897`. This affects the record only, not any figure below — **not a reason to rerun anything** |
| Personal data | The log shows the owner's local folder (`<owner workstation path>`) and the test database name `valida_test_r6_review`. No credential, connection string, email address or candidate data; the B6 evidence block is the sanitised TEST-DOUBLE output |
| Status kept | **B6 NOT ACCEPTED.** Provider gate **PENDING** by design. G-SUP **CLOSED**. G-COPY **PROPOSED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. |

## 1. What was run, and on what

| Item | From the received copy (line numbers of that file) |
| --- | --- |
| Header printed by the owner's script (lines 1–4) | `Package SHA256: cbcc2e3ecaa399206b823ff6d3c50c488759a4f4a5303678fb19dbde30c7c057` (= the r6 cumulative ZIP); `Baseline HEAD: ec15048980c9e3e8134de4b3d7eeadc89b1aef96`; `Node: v24.21.0`; `Started: 2026-11-02T07:18:13.1911957-08:00` |
| `npm ci` (lines 6–23) | `added 168 packages … found 0 vulnerabilities`; `npm ci exit: 0`. The `NativeCommandError` records around npm's "new major version" notice are how PowerShell 5.1 shows anything a native command writes to stderr — not a failure |
| Runtime (lines 29–31) | `node v24.21.0 (win32, x64)`, `os Windows_NT 10.0.26300` |
| Database (lines 397–398) | approved test database `valida_test_r6_review`; `engine: MongoDB 8.0.9` |
| Final lines (834–835) | "B6 VERIFICATION INCOMPLETE — every available gate passed; 1 gate(s) PENDING (real provider …)"; `verify:b6 exit: 2` |

**Which package.** The package identity rests on the header line printed by the owner's script; the script itself is not in the log, and — unlike the `b6-2` run (EV-S2-W2) — **no manifest verification is recorded** in this log. Corroboration, not proof: `tests/b6-stage2-templates.test.js` ran **34** tests here against **32** in the `b6-2` Windows run (the difference is the two `b6-3` T-13 tests), and the B6 gate ran 460 against 458. No repeat is requested for this limit.

## 2. Results — counted without double counting

`verify:b6` runs two complete suites and then **re-runs subsets** as named gates; the gate figures are repeat executions and are **not** added to the suite totals.

| Section | Files | Result | Relation |
| --- | --- | --- | --- |
| Offline suite | 54 | **2226 passed, 5 skipped** (2231 defined) | The complete offline suite |
| B6 acceptance gate | 14 | 460 passed | Subset re-run |
| B5 acceptance gate | 5 | 236 passed | Subset re-run |
| B4 acceptance gate | 14 | 580 passed, 5 skipped | Subset re-run; the same 5 skips as §3 |
| Real-database suite | 14 | **145 passed** | The complete database suite |
| B6 real-database gate | 1 | 16 passed | Re-run of part of the 145 |
| Rehearsal and cleanup | 2 | 17 passed | Re-run of part of the 145 |
| Index apply / check | — | 6/6 and 6/6 required indexes | Script checks |
| Provider acceptance / delivery | — | **PENDING** | By design; never sends email |

**Distinct test cases:** 2231 offline + 145 database = **2376 defined; 2371 executed and passed; 5 skipped**.

**Against the sandbox run of the same build** (J2): offline 2230 passed / 1 skipped there against 2226 / 5 here — the difference is exactly the four POSIX-only tests of §3; B6 gate 460 = 460; B5 236 = 236; B4 584 / 1 against 580 / 5; database gates not runnable in the sandbox against 145 + 16 + 17 passed here.

## 3. The five skipped tests

The per-file skip counts are the same as in the `b6-2` Windows run: `private-storage.test.js` 3, `storage-link-confinement.test.js` 1, `temp-upload-area.test.js` 1. They are the five tests classified in [`../b6-stage2/WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md` §3](../b6-stage2/WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md); that classification and its recommended disposition are **unchanged** (one platform-inapplicable, three Windows variants untested, one never executed anywhere — an optional targeted run, not required for B6 in Claude's assessment).

## 4. The DEP0190 warning

Printed once at the start of the database section (lines 388–396, `node:22624`), exactly as in the `b6-2` run. Same cause and disposition: developer tooling, literal arguments only; follow-up **TOOL-DEP0190**, separately authorised. Nothing changed.

## 5. What this evidence establishes — and what it does not

**Establishes** (for the r6 cumulative package, identified as in §1): on Windows with Node v24.21.0 and MongoDB 8.0.9, every available gate of `verify:b6` passed for `b6-3` — the offline suite with the 5 documented skips, the B6 / B5 / B4 gates, the complete real-database suite, the B6 real-database gate, the rehearsal and cleanup, and the required indexes. **Checklist B6-7 is met for `b6-3`.**

**Carried forward to r7.** r7 changes no file under `backend/` or `frontend/` (the r7 update manifest lists none; every runtime row of the r6 cumulative manifest still matches the working copy). This run therefore covers the r7 runtime and test files unchanged; **no further Windows run is needed for r7**. A new Windows run would be needed only after a change to the runtime, the tests or the verification scripts.

**Does not establish:** provider acceptance or delivery (PENDING); any email-client rendering (Stage 3); the five skipped tests (§3); the byte identity of the original log (above).

## 6. Files

| File | SHA-256 |
| --- | --- |
| `evidence/windows/verify-b6-r6-windows.RECEIVED-COPY.log` (as received; not the original) | `646223480910f446a7c554aa376d8fa0e2867fa82a6e6a5cf9832ce8727437ea` |
| `evidence/windows/verify-b6-r6-windows.READING-COPY.DERIVED.txt` (derived) | `e0c2ca4094b64c344d9482463dae5ab57959cc529a6d9f9ba41415390a4750a2` |
| The original (not received here) | `f1b4ee6622aea254f032d2ce65d43fa432fe603c30390ff4fe635634bc97e897` — owner- and GPT-stated |

## 7. r8 — the original log, and how the two copies relate

| | |
| --- | --- |
| Original | `evidence/windows/verify-b6-r6-windows.log` — 130,070 bytes, SHA-256 `f1b4ee6622aea254f032d2ce65d43fa432fe603c30390ff4fe635634bc97e897`; bytes 0–201 UTF-8: a byte-order mark and the script's four header lines, bytes 202–130,069 UTF-16LE (64,473 NUL bytes) — as the owner described |
| Comparison | [`tools/compare_windows_log_copies.py`](tools/compare_windows_log_copies.py) → [`evidence/windows/received-vs-original-comparison.DERIVED.txt`](evidence/windows/received-vs-original-comparison.DERIVED.txt) (`4d7881fc…6fda`). Decoded, the original has **836 lines**, like the received copy; **449 lines are identical**; the other **387 differ only where the original has non-ASCII characters** (1,375 in all — for example `Γ£ô` and `ΓÇö`, themselves code-page artefacts already present in the original), which the received copy carries as U+FFFD runs, and in two lines as `,%V%`. **The ASCII text of every line is identical**, so every figure in §§1–4 reads the same in the original |
| Derived reading copy of the original | `evidence/windows/verify-b6-r6-windows.ORIGINAL-DECODED.DERIVED.txt` (`971c02d6…c00d`) — labelled derived: decoded, re-encoded as UTF-8, ANSI colour codes removed; line numbers = the original's + 7 |
| Kept unchanged | `…RECEIVED-COPY.log` (`646223…37ea`) and `…READING-COPY.DERIVED.txt` (`e0c2ca40…50a2`), as a separate record of what arrived without the ZIP |
| Effect | None on the results or on B6-7 (met). No test was rerun |

