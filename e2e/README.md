# Valida — critical browser E2E (C3)

This suite covers Doc 17 sections 197–213 and Doc 18 section 161. It runs a real browser against:

- the **production build** of the frontend, served by `vite preview`;
- the **real Express backend**, started with `node backend/src/server.js`;
- a **disposable MongoDB** database;
- **private local storage**;
- a **local SMTP test server**.

It starts and stops all of these itself. It changes nothing in `frontend/` or `backend/`, and it never reads `backend/.env`.

## What a run proves, and what it does not

| Proven | Not proven |
| --- | --- |
| Form → multipart → server validation → Job eligibility → private storage → MongoDB → notification → response → UI state | Production hosting, MongoDB, storage or e-mail (C6/C7) |
| The Application and its private file exist; their checksums match; no public URL serves the file | The Titan/Bluehost relay, DNS, SPF/DKIM/DMARC, deliverability (D3/D4) |
| The backend's **real SMTP adapter** completed TLS (chain and host name verified against a local test CA), logged in, and submitted each message, which the local test server accepted or refused | That any mail reached a real mailbox — nothing leaves the machine |
| Idempotency under a double-click, a same-key race, a network failure and a lost response | Load, real devices, browsers other than Chromium |
| Acknowledgements go through the existing B7 suppression gate, with a synthetic key | Production acknowledgements: these stay **refused at start-up** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`); the suite runs with `APP_ENV=local` |

Acknowledgements are switched on **only inside this local run**:
- the synthetic suppression key is registered through the real `ops:notifications:suppression key-register` CLI;
- every recipient is on `*.example.test`, enforced by `EMAIL_RECIPIENT_ALLOWLIST`.

## The cases (`tests/apply.e2e.js`)

| Case | Doc 17 | How it is observed |
| --- | --- | --- |
| C3-01 Home → Careers → Job → Apply → resume → submit → success, with database, storage and mail evidence | 198–207 (QA-P1-E2E-001..004) | REAL |
| C3-02 Rapid double submission (browser), and a same-key race (API) | 108, 211 | HOLD (the request is delayed 1.5 s, then sent unchanged) / REAL |
| C3-03 Network failure: no false success; Try Again reuses the key | 209 | FAULT INJECTION (the browser goes offline) |
| C3-04 Lost response: the retry replays; one Application, no second notification | 106 (and Doc 09 §§121, 200) | FAULT INJECTION (the real 201 is reset before the page sees it) |
| C3-05 Server validation shown in the form | 210 | REAL |
| C3-06 Apply open → the Job closes in the backend → submit → controlled rejection | 96, 208 | REAL (the Job is closed by the provisioning CLI) |
| C3-07 Acknowledgement refused by the mail server: the Application stays accepted | 110 | REAL (the test server refuses one synthetic recipient) |
| C3-08 That refusal recorded as a suppression; the next acknowledgement is suppressed with no SMTP | B7 gate | REAL (operator step by the suppression CLI) |
| C3-09 The backend log holds no candidate data, key, storage key or secret | 406 | REAL |

## Run it (Windows, PowerShell)

**Prerequisites:**
- Node 24;
- `npm ci` already run in `frontend/` and `backend/`;
- a local MongoDB (for example the MongoDB 8 service on `127.0.0.1:27017`).

One-time setup:

```powershell
cd e2e
npm ci
npx playwright install chromium
```

Each run:

```powershell
cd e2e
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test_e2e"
npm run test:e2e
Remove-Item Env:MONGODB_TEST_URI
```

**Database guard.** The suite refuses to start unless `MONGODB_TEST_URI` names a database called `valida_test` or `valida_test_<suffix>`. It uses the backend's own guard, `backend/scripts/test-database.mjs`, and it also refuses the database named in `backend/.env`. It then **drops that database** and starts clean.

**Ports.** It uses 4100 for the backend and 4183 for the preview. Change them with `E2E_BACKEND_PORT` and `E2E_FRONTEND_PORT`. The SMTP test server picks a free port.

## Where the output goes

Everything a run creates goes into **one directory outside the repository**: `%TEMP%\valida-e2e\<run id>` on Windows, or `$TMPDIR/valida-e2e/<run id>`. The path is printed at the start of the run. You can choose a directory with `E2E_RUN_DIR`, but it must be outside the repository: the backend refuses a private storage root inside it.

| Path | Contents |
| --- | --- |
| `output/cases/*.json` | Evidence record of each case (storage keys only as one-way references; Idempotency-Keys only as short hashes) |
| `output/screenshots/*.png` | The Doc 18 section 162 states, and others |
| `output/report.json` | Playwright's result |
| `smtp/*.eml`, `*.json` | Every message the SMTP test server received or refused; `rcpt.json`; `auth.json` |
| `logs/` | Set-up steps, build, backend, preview, SMTP and CLI output |
| `private-storage/` | The stored synthetic resumes |
| `run.json` | The run's facts: HEAD, ports, database name, Jobs. It holds no secret |

All data is synthetic. Even so, treat the directory as **private review evidence**: never commit it, and delete it when it is no longer needed.

The two per-run secrets, the SMTP test password and the suppression HMAC key, are generated in memory and passed through the environment. They are never written to disk.
