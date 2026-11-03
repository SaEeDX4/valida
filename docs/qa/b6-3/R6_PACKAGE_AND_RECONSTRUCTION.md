# r6 packages — contents, reconstruction and verification (Windows PowerShell)

| | |
| --- | --- |
| Packages (in the output folder, not in the repository) | `valida-B6-stage2-logo-r6-cumulative.zip` + `…-cumulative.manifest.sha256`; `…-r6-update.zip` + `…-update.manifest.sha256`; `…-r6-delta.zip` + `…-delta.manifest.sha256`; `…-r6-reconstruction-check.log`; `…-r6-SHA256SUMS.txt` (hashes of all of these) |
| Baseline | GitHub `SaEeDX4/valida` @ `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| Previous checkpoint | r5 cumulative `valida-B6-stage2-logo-r5-cumulative.zip`, SHA-256 `1d83969a65d33689eb2ca2ce05c49d0e3c70a0162bb6e2e77ded94472072ad44` |
| Excluded from every package | `.env`, secrets, `node_modules`, `.git`, database files, runtime storage, real personal data |

## 1. What each package is

| Package | Contains | Use |
| --- | --- | --- |
| **cumulative** | Every file that differs from `ec15048` (r9 + rev4 + rev6 + Stage 2 + r1–r6) | **Recommended:** a fresh clone of `ec15048` + this ZIP = the r6 working copy |
| **update** | Every file **added or changed** since r5 — and a list of the **one file removed** since r5 | r5 tree → r6 tree |
| **delta** | Every file that differs from the r9 + rev4 + rev6 baseline, plus the delta manifest itself (which, by design, does not list itself — so the ZIP has one entry more than the manifest has rows) | Review of everything Stage 2 changed |

**Removed since r5 (the update ZIP cannot carry a deletion):** `backend/src/integrations/notifications/assets/valida-logo-email-316x72.png` — the b6-2 logo, no longer used by `b6-3`. Its approved bytes (`b8c54174…341a`) remain at `docs/qa/b6-stage2/logo/valida-logo-email-316x72.candidate.png`. The update manifest lists it on a `# D` line.

## 2. Reconstruct and verify on Windows (recommended route: cumulative)

```powershell
# In an empty folder
git clone https://github.com/SaEeDX4/valida.git valida-r6
cd valida-r6
git checkout ec15048980c9e3e8134de4b3d7eeadc89b1aef96
# Check the ZIP against the SHA256SUMS file first
Get-FileHash ..\valida-B6-stage2-logo-r6-cumulative.zip -Algorithm SHA256
Expand-Archive ..\valida-B6-stage2-logo-r6-cumulative.zip -DestinationPath . -Force
# Every manifest row must match (no output except the final count means success)
$bad = 0; $rows = 0
Get-Content ..\valida-B6-stage2-logo-r6-cumulative.manifest.sha256 | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $hash, $path = $_ -split '  ', 2; $rows++
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() -ne $hash) { $bad++; Write-Output "MISMATCH $path" }
}
"rows=$rows mismatches=$bad"
# The b6-2 logo must not be in the runtime folder
Test-Path backend\src\integrations\notifications\assets\valida-logo-email-316x72.png   # expected: False
```

The manifest loop must report the manifest's row count and `mismatches=0`.

**From an r5 tree instead (update route):** expand the update ZIP over the r5 tree, delete the one file listed under "Removed since r5", then check the update manifest the same way.

## 3. Owner check O-B (Windows + MongoDB) on that tree

```powershell
cd backend
npm ci
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b6 2>&1 | Tee-Object -FilePath ..\verify-b6-b6-3-windows.log
```

Send `verify-b6-b6-3-windows.log`. Expected by design: every offline and database gate PASS; the provider gate PENDING (no email is ever sent by this command).

## 4. Sandbox results

The reconstruction checks of the r6 packages were run in the sandbox; the log is `valida-B6-stage2-logo-r6-reconstruction-check.log` (outside the repository, hashed in `…-r6-SHA256SUMS.txt`).
