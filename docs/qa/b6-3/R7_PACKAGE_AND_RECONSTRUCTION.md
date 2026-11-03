# r7 packages — contents, reconstruction and verification

| | |
| --- | --- |
| Packages (in the output folder, not in the repository) | `valida-B6-stage2-logo-r7-cumulative.zip` + `…-cumulative.manifest.sha256`; `…-r7-update.zip` + `…-update.manifest.sha256`; `…-r7-delta.zip` + `…-delta.manifest.sha256`; `…-r7-reconstruction-check.log`; `…-r7-SHA256SUMS.txt` (hashes of all of these) |
| Baseline | GitHub `SaEeDX4/valida` @ `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| Previous checkpoint | r6 cumulative `valida-B6-stage2-logo-r6-cumulative.zip`, SHA-256 `cbcc2e3ecaa399206b823ff6d3c50c488759a4f4a5303678fb19dbde30c7c057` — the package the owner ran on Windows (EV-B6-3-W1) |
| What r7 changes | **Documentation, preserved owner evidence and QA tools only.** No file under `backend/` or `frontend/`, no `package*.json`, no test, no asset, no verification script. **No file deleted.** The runtime is byte-identical to r6, so EV-B6-3-W1 covers it |
| Excluded from every package | `.env`, secrets, `node_modules`, `.git`, database files, runtime storage, real personal data |
| Owner action needed with these packages | **None.** They carry the records for review. Owner check O-A uses the r6 fixtures, which are unchanged and are also sent separately |

## 1. What each package is

| Package | Contains | Use |
| --- | --- | --- |
| **cumulative** | Every file that differs from `ec15048` (r9 + rev4 + rev6 + Stage 2 + r1–r7) | A fresh clone of `ec15048` + this ZIP = the r7 working copy |
| **update** | Every file **added or changed** since r6 (none removed) | r6 tree → r7 tree |
| **delta** | Every file that differs from the r9 + rev4 + rev6 baseline, plus the delta manifest itself (which does not list itself — so the ZIP has one entry more than the manifest has rows) | Review of everything Stage 2 changed |

## 2. Verify on Windows (optional — only to have the r7 documents locally)

From an r6 folder (for example the one used for EV-B6-3-W1):

```powershell
Get-FileHash ..\valida-B6-stage2-logo-r7-update.zip -Algorithm SHA256   # compare with …-r7-SHA256SUMS.txt
Expand-Archive ..\valida-B6-stage2-logo-r7-update.zip -DestinationPath . -Force
$bad = 0; $rows = 0
Get-Content ..\valida-B6-stage2-logo-r7-update.manifest.sha256 | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $hash, $path = $_ -split '  ', 2; $rows++
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() -ne $hash) { $bad++; Write-Output "MISMATCH $path" }
}
"rows=$rows mismatches=$bad"
```

Or from a fresh clone of `ec15048`, expand the **cumulative** ZIP and check it against the cumulative manifest with the same loop. Not executed in the sandbox (no PowerShell there); the equivalent checks below were.

## 3. Sandbox results

The reconstruction checks of the r7 packages were run in the sandbox; the log is `valida-B6-stage2-logo-r7-reconstruction-check.log` (outside the repository, hashed in `…-r7-SHA256SUMS.txt`). It also records that every runtime file equals the r6 package the owner ran on Windows.
