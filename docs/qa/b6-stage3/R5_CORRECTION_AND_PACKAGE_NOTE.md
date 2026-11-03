# r5 — correction note for the r4 review package

| | |
| --- | --- |
| Date | 2026-11-01 |
| Scope | Corrections requested in the owner's instruction of 2026-11-01 (preserved as `evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/owner-instruction-2026-11-01.txt`). Documentation and preserved owner evidence only. |
| Preserved | Every r4 package, manifest and log is **unchanged** in the output folder; this note explains them rather than rewriting them. The r4 reconstruction log keeps SHA-256 `64fba1d98651b5f42669cdd929f977f27e5a24fa81c0f23d6245d902a2e60c4d`. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. |

## 1. Corrections to the r4 documents

| # | r4 said | Correct | Where corrected |
| --- | --- | --- | --- |
| 1 | The owner's Outlook classic work was "preliminary" / "pre-authorisation" and filled no Stage 3 cell | Stage 3 offline EML inspection in Outlook classic **only** had been explicitly authorised by the owner (the authorising message was not received here). Cell A1-OC is **PARTIAL** on `b6-2`; the matrix is **not** PASS; online access and live email stay unauthorised | [OR-2026-11-01-01](../../review/OWNER_RECORD_2026-11-01_B6_STAGE3_OUTLOOK_OFFLINE.md); addendum header and §6; findings; plan r4; checklist; decision package rev 12; Stage 2 report |
| 2 | C3 image hash abbreviated as `73adbe4c…d1cd` (findings §2.3) | Full hash `73adbe4c3d49697fefc52b7779ec2946898cf39be32b31baabd4f535edfbb95a` — it ends in **`b95a`**. `…d1cd` was a transcription error; `candidates.json`, the C3 file and findings §8 always carried the correct value | Findings §2.3 |
| 3 | F-02: the region "is never a template colour" and the template has no matching width, listed as evidence against a template effect | A colour or width absent from the source does **not** exclude an interaction between the template and the client or display. The cause stays **provisional** | Addendum §3.4; findings §1, §3 |
| 4 | F-03 remedy R-03-A applicable "if everything is reachable" | Reachability by horizontal scrolling does **not** close F-03; it only informs the choice of remedy. F-03 stays OPEN until a remedy is verified in Outlook or the owner records an explicit, bounded decision, and the narrow-window case is retested | Findings §1, §4 |
| 5 | The 200 % and About screenshots were "not received" | They were supplied to GPT; they were **not received here**. No complete repeat of those checks is requested | Addendum §1.2, §4; findings |
| 6 | Only the r4 ZIPs, `SHA256SUMS` and the log were sent to the owner | The three r4 manifests also exist and are now supplied: `valida-B6-stage2-logo-r4-cumulative.manifest.sha256` (`1be55ed9…fd19`), `…-r4-update.manifest.sha256` (`28fcea5e…c769`), `…-r4-delta.manifest.sha256` (`cf6ae8fb…4f9c`); their hashes are in `valida-B6-stage2-logo-r4-SHA256SUMS.txt` | Delivered with r5 |

## 2. The r4 delta ZIP: 197 entries against 196 manifest rows

| Item | Count / identity |
| --- | --- |
| Entries in `valida-B6-stage2-logo-r4-delta.zip` | **197** |
| Rows in `valida-B6-stage2-logo-r4-delta.manifest.sha256` | **196** — the line the r4 reconstruction log reports ("delta manifest files: 196") |
| The one entry not listed | `docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256` — **the delta manifest itself**, carried inside the ZIP at its repository path |
| Why it is not listed | By design: the manifest's header says "this manifest does not list itself" (a file cannot contain its own SHA-256) |
| Identity of that entry | SHA-256 `cf6ae8fb6bec42bd7cc3fe1a1e6ddeb67cf074a502c3e584a44b7d5527bd4f9c` — **byte-identical** to the separately supplied `valida-B6-stage2-logo-r4-delta.manifest.sha256` |
| Earlier packages | The same structure: r3 delta ZIP **132** entries, manifest **131** rows, the extra entry the same self-manifest (`ffcb5fe6…be63`) |
| Cumulative and update ZIPs | No such difference: cumulative 257 entries = 257 rows; update 72 = 72 (each manifest is shipped beside its ZIP, not inside it) |
| Conclusion | Not a packaging error. The r4 log's count is correct for what it counted (manifest rows) but did not say that the ZIP also carries the manifest. The r4 log is left as it is; the r5 reconstruction log states both counts. |

## 3. What r5 adds

- **EV-S3-OC2:** six owner screenshots of the C2+P04 review mockups, preserved, hashed, mapped to the exact mockup EMLs and measured (addendum Part II).
- **OR-2026-11-01-01:** the authorisation scope, the owner-reported checks and the C2 preference (not an approval).
- Updated status in the addendum, findings, plan (r4), checklist, decision package (rev 12), Stage 2 report pointer and feedback record (one note).
- One measurement script: `tools/measure_ev_s3_oc2.py` (reads the preserved originals only).
- No change to `backend/`, `frontend/`, any `package*.json`, tests, the deliverable's assets or verification scripts; no product suite re-run; no email; no online access.
