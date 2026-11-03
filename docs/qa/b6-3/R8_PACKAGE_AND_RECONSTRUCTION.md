# r8 packages — contents and verification

| | |
| --- | --- |
| Packages (in the output folder, not in the repository) | `valida-B6-stage2-logo-r8-cumulative.zip` + `…-cumulative.manifest.sha256`; `…-r8-update.zip` + `…-update.manifest.sha256`; `…-r8-delta.zip` + `…-delta.manifest.sha256`; `…-r8-reconstruction-check.log`; `…-r8-SHA256SUMS.txt` (hashes of all of these) |
| Baseline | GitHub `SaEeDX4/valida` @ `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| Previous checkpoint | r7 cumulative `valida-B6-stage2-logo-r7-cumulative.zip`, SHA-256 `ec92983d197d58360a56ebb42422ecadf8253be46a7f7736dcc3d21bb8112b62` |
| What r8 changes | **Records and preserved owner evidence only** (the D-6 decision, the original 07:12 screenshots, the original Windows log, derived files and two QA tools). No file under `backend/` or `frontend/`, no `package*.json`, no test, no asset, no verification script; **no file deleted**. The runtime is byte-identical to r6, the package run on Windows (EV-B6-3-W1) |
| Owner action needed with these packages | **None** |

The three packages have the same meaning as in r7 ([`R7_PACKAGE_AND_RECONSTRUCTION.md`](R7_PACKAGE_AND_RECONSTRUCTION.md) §1): cumulative = every file that differs from `ec15048`; update = every file added or changed since r7; delta = every file that differs from the r9 + rev4 + rev6 baseline, plus the delta manifest (which does not list itself). The PowerShell check of r7 §2 applies unchanged with `r8` in the file names; it was not executed in the sandbox (no PowerShell). The sandbox checks are in `valida-B6-stage2-logo-r8-reconstruction-check.log`.
