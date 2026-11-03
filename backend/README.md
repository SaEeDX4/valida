# Valida backend

Node.js + Express REST API for the Valida platform.

| | |
| --- | --- |
| Milestone | **B6 — Notification Integration** (submitted for review; on top of B1 — Backend Runtime & Configuration, B2 — MongoDB Models & Indexes, B3 — Job Provisioning & Public Jobs API, B4 — Private Resume Storage & Validation, and B5 — Application Submission Workflow) |
| Runtime | Node.js `>=24.0.0 <25.0.0`, ESM |
| API base path | `/api/v1` |
| Database | MongoDB via Mongoose `9.10.2` (driver `mongodb` 7.6.0 — MongoDB server 4.4 or newer) |

B1 delivered the production-oriented Express foundation: validated
configuration, security headers, CORS, request correlation, structured
logging, rate limiting, the canonical error model, health and readiness, and
graceful shutdown.

B2 adds the real MongoDB connection (startup, readiness, shutdown), the `Job`
and `Application` models of Doc 10, their lifecycle/validation helpers, the six
required indexes, and explicit commands to apply and check them.

B3 makes Careers data real and database-backed: the public Jobs API
(`GET /api/v1/jobs`, `GET /api/v1/jobs/:jobSlug`) reads MongoDB with
server-controlled publication and closing rules, and a controlled operator
command provisions Jobs from a validated definition file through the B2
services. The real initial role, *Cybersecurity Specialist*, is provisioned
only as a **DRAFT** — its employment type, final schedule wording, description,
responsibilities and requirements are **AWAITING INPUT**, so it is not public.

B4 builds the private resume foundation that the Apply workflow (B5)
uses: a private storage boundary with a real, development-only local adapter;
bounded multipart processing; and resume validation — extension, declared MIME
type and actual PDF/DOCX structure together, bounded DOCX (ZIP) inspection,
safe filename metadata, server-generated storage keys, SHA-256 checksums and
`NOT_SCANNED` scan state. See "Private resume storage & validation (B4)".

B5 adds the real Apply backend: `POST /api/v1/jobs/:jobSlug/applications`.
It validates the request against the Job's CURRENT configuration, enforces
the Job's effective state at the server clock (re-checked immediately before
the record is written), validates and privately stores the resume (B4),
persists the Application through the validated B2 save with immutable Job and
answer snapshots, and returns `201` only when BOTH the private object and the
MongoDB record exist. Idempotency (a hashed `Idempotency-Key`, a request
fingerprint and the unique index) makes retries, double submits and lost
responses safe. Storage and database failures never produce a success; a
stored object is deleted only on proof that no Application references it, and
one whose outcome is unknown is kept and logged for reconciliation. See
"Application submission (B5)". There is no way to download a stored file (E4).

B6 integrates notifications with the Apply workflow, provider-independently:
the `APPLICATION_RECEIVED_INTERNAL` and `APPLICATION_ACKNOWLEDGEMENT` events,
backend-controlled templates (plain text + HTML, escaped, no links, no
tracking, no resume, no candidate data in the internal email), configured
recipients, failure classification (transient / permanent / configuration /
uncertain), a conditional claim that prevents two processes from sending the
same notification, truthful recorded state, a bounded operator retry command
(`npm run ops:notifications:retry`, dry run by default) and truthful
readiness. **r4:** the SMTP adapter for the selected provider (Bluehost
Professional Email / Titan) — verified TLS, phase-aware outcomes, bounded and
cancellable — sends only when `TRANSACTIONAL_EMAIL_PROVIDER=smtp` is
configured; with the default `none` nothing is sent, the internal notification
stays `PENDING` for the retry command, and candidate acknowledgements stay
`NOT_REQUIRED`. Live Titan evidence comes only from the owner's opt-in test.
See "Notifications (B6)".

`/api/v1/health/ready` correctly answers **503 "Service is not ready."**,
because the required notifications dependency has no provider (AWAITING
INPUT) — even when MongoDB is connected and resume storage is ready. The Jobs
API and Apply do not depend on it and serve while readiness is 503.

---

## Install

```powershell
cd backend
npm install
```

Copy the example environment file and adjust it if needed:

```powershell
Copy-Item .env.example .env
```

From B2 the backend **needs a reachable MongoDB** to start. For local work,
install a currently supported MongoDB Community Server release on Windows
(it runs as the `MongoDB` service on `127.0.0.1:27017` by default), then set
`MONGODB_URI` in `.env`, for example `mongodb://127.0.0.1:27017/valida_dev`.
Credentials, if your server uses them, go only in `.env` — never in a
committed file, a ticket or a chat.

`.env` is git-ignored and must never be committed. The runtime loads it
natively through `--env-file-if-exists` (Node 24), so there is no `dotenv`
dependency.

## Run

```powershell
npm start     # start the server
npm run dev   # start with --watch for local development
```

Default: <http://localhost:4000>

```powershell
curl.exe http://localhost:4000/api/v1/health
curl.exe -i http://localhost:4000/api/v1/health/ready
curl.exe -i http://localhost:4000/api/v1/jobs
curl.exe -i http://localhost:4000/api/v1/jobs/cybersecurity-specialist
```

(`curl.exe` is the curl that ships with Windows 10 and 11; in Windows
PowerShell 5.1 plain `curl` is an alias for `Invoke-WebRequest`.)

## Test

```powershell
npm test               # offline suite (no database needed), single run
npm run test:watch
npm run verify:b1      # offline tests + npm audit
npm run test:db        # REAL-database suite — needs MONGODB_TEST_URI
npm run verify:b2      # full B2 gate — see "B2 verification" below
npm run verify:b3      # full B3 gate — see "B3 verification" below
npm run verify:b4      # full B4 gate — see "B4 verification" below
npm run verify:b5      # full B5 gate — see "B5 verification" below
npm run db:indexes:apply
npm run db:indexes:check
npm run jobs:provision:plan  -- --file provisioning/jobs/cybersecurity-specialist.json
npm run jobs:provision:apply -- --file provisioning/jobs/cybersecurity-specialist.json
```

`npm test` deliberately excludes `tests/db`. Those tests need a real MongoDB;
a default command that silently skipped them could report green while
persistence and uniqueness were never exercised. Passing `npm test` is
therefore **not** B2, B3, B4 or B5 verification — `npm run verify:b5` (which also
runs every B2, B3 and B4 database test) is.

The B4 storage tests in the offline suite are NOT mocks: they write real
bytes to real directories, in fresh roots under the OS temporary directory
(prefix `valida-b4-test-`), and delete only those roots. They prove the local
adapter's persistence; they cannot prove a production bucket's privacy
(Doc 17 section 389) — that is C6.

The offline suite also runs the provisioning module and the unmodified
provisioning CLI over a **stand-in collection** (`tests/fixtures/fakeJobStore.js`,
preloaded into the CLI only by tests) to count the writes a run sends and to
inject failures at exact points — after an acknowledged insert, on
publication, on the read-back. That proves the outcome reporting, not
persistence.

**Test tooling (B6 r7).** `vitest` 5.0.3 with `vite` **8.3.3**, pinned exactly
in `devDependencies` (vite was otherwise only vitest's peer). With vitest ≥ 5.0.4
the global-setup module's code reaches vite as a `Buffer`, and vite 8.3.5's
source-map lookup expects a string: with that pair the runner's own error
printer fails while printing the `test:db` guard's refusal, and the reason is
replaced by `TypeError: code.charCodeAt is not a function` (the run still
stops, but nobody can see why). `tests/test-database-guard.test.js` fails on
such a combination, and `tests/db/guard-refusal-no-mutation.test.js` repeats
the refusal against a reachable server and checks that nothing was created.
Change the pin only with both passing.

**Windows: local addresses and coloured output (B6 r8).** The first Windows
run of r7 (Node 24.21.0, npm 11.19.0) failed in two test files, both from the
tests, not the product:

- *Local SMTP addressing.* `localhost` may resolve to more than one loopback
  address (Windows: `::1` and `127.0.0.1`). A local test server listening on
  `'localhost'` binds the first answer of Node's `dns.lookup`, while a client
  that uses nodemailer's `SMTPConnection` directly (the contract tests) resolves
  the name with nodemailer's own resolver and connects to one of ITS answers —
  a different address, hence `ESOCKET` / `ECONNREFUSED` before any SMTP or TLS
  phase. The test servers now report the address they actually listen on;
  contract clients connect there and present `localhost` as the TLS server
  name, so the certificate chain and the host name are verified exactly as
  before (a test proves the NAME, not the address, is what is verified). Every
  certificate test first proves from the server's own record that the TLS
  phase was reached: a refused connection is never a certificate result. The
  SMTP adapter is unaffected — it opens its socket through Node, which tries
  every address of the name.
- *Coloured runner output.* `vitest` colours its output on Windows even when it
  is piped, so a literal match on the `test:db` guard's message failed. Tests
  that read a child's terminal output now judge it with the VT control
  sequences removed (`tests/fixtures/terminalOutput.js`, Node's
  `util.stripVTControlCharacters`) — the "must not contain" checks too — and
  the guard's refusal is checked with colours forced on and off.

To see which address each side uses on a machine (prints only loopback
addresses and error codes; contacts nothing but a local test server):

```powershell
node tests/diagnostics/localhost-addressing.mjs
```

---

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `APP_ENV` | no | `local` | `local` \| `review` \| `production` |
| `PORT` | no | `4000` | 1–65535. `0` is rejected: it would bind a random port |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace`, or `silent` |
| `CORS_ALLOWED_ORIGINS` | **yes in production** | localhost 5173 + 4173 | Comma-separated exact origins. `*` is rejected |
| `TRUST_PROXY` | no | `false` | `false`, or the number of trusted proxy hops (1–10) |
| `RATE_LIMIT_WINDOW_MS` | no | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX` | no | `120` | Requests allowed per window per client IP |
| `MONGODB_URI` | **yes** (B2) | — | Any connection string the MongoDB driver accepts — standalone, replica-set host list or `mongodb+srv://`. Validated by the driver's own parser; never logged or printed |
| `MONGODB_CONNECT_TIMEOUT_MS` | no | `10000` | 1000–120000. How long startup waits for MongoDB before failing |
| `MONGODB_QUERY_TIMEOUT_MS` | no | `5000` | 500–60000 (B3). Upper bound on one public Jobs read; also sent to MongoDB as `maxTimeMS`. A slower or unresponsive database gives `503`, never a hung request or an empty list |
| `MONGODB_TEST_URI` | tests only | — | Used only by `test:db` / `verify:b2` / `verify:b3` / `verify:b4` / `verify:b5` / `verify:b6`. Database must be named **`valida_test`** or **`valida_test_<suffix>`** and differ from `MONGODB_URI` — see "B2 verification" |
| `RESUME_STORAGE_DRIVER` | no (B4) | unset | `local` (development only) or unset. `local` is **refused at startup** unless `APP_ENV=local` and `NODE_ENV` is not `production`. Unset = no storage: the service starts, readiness reports it, no Application could be accepted. The production provider is selected at deployment (C6, AWAITING INPUT) |
| `RESUME_STORAGE_LOCAL_ROOT` | with `local` | — | Absolute path of the private local storage directory. Must be outside the repository (and not contain it), not inside a public/static/web-served directory, and not a drive/filesystem root. Never logged or printed |
| `APPLICATION_RATE_LIMIT_WINDOW_MS` | no (B5) | `900000` | 1000–86400000. Apply rate-limit window (Doc 09 section 34: 15 minutes) |
| `APPLICATION_RATE_LIMIT_MAX` | no (B5) | `10` | 1–100000. Apply **attempts** per window per client IP — counted separately from, and in addition to, the general limit |
| `NOTIFICATION_TIMEOUT_MS` | no (B5) | `5000`; with `smtp`: `10000` | 100–60000; **with `smtp` at least `10000`** (r4 review: one call covers connect, TLS, login, envelope and message; a smaller value is refused at startup). Bound on one provider call (Doc 09 section 136): when it expires the call is aborted, the Application is answered anyway; r4: the transport is given at most 1 s more to stop and report what it established (nothing submitted → transient; possibly submitted → `OUTCOME_UNKNOWN`; did not stop → `TIMEOUT`) |
| `TRANSACTIONAL_EMAIL_PROVIDER` | no (B6) | `none` | `none` or `smtp` (r4: the selected provider, Bluehost Professional Email / Titan, over SMTP — see "Notifications (B6)") |
| `TRANSACTIONAL_EMAIL_API_KEY` | API providers only | — | Secret; at most 512 characters. Refused with `none` and with `smtp`. Never logged, printed or serialised (`[redacted]`) |
| `SMTP_HOST` | with `smtp` | — | The relay's DNS name (never an IP literal). Titan: `smtp.titan.email`. Refused without `smtp` |
| `SMTP_SECURITY` | no | `implicit-tls` | `implicit-tls` (465) or `starttls` (587, STARTTLS required). No plaintext mode |
| `SMTP_PORT` | no | 465 / 587 | 1–65535; `587` with `implicit-tls` or `465` with `starttls` is refused as a mismatch |
| `SMTP_USERNAME` | with `smtp` | — | The sending mailbox (full address); `TRANSACTIONAL_FROM_ADDRESS` must equal it |
| `SMTP_PASSWORD` | with `smtp` | — | **Secret** — with Titan 2FA, the mailbox's **app password**. At most 512 characters, no control characters. Only in `backend/.env` (git-ignored) or the host's secret store; never logged, printed or serialised (`[redacted]`), never in the repository, a chat, a screenshot or a ZIP |
| `TRANSACTIONAL_FROM_ADDRESS` | with a provider | — | One plain address (no display name, list, whitespace or line break). The sending identity (Doc 14 sections 95-101); with `smtp`, the `SMTP_USERNAME` mailbox |
| `TRANSACTIONAL_FROM_NAME` | no | `Valida Careers` | 1–64 printable characters; no quotes, angle brackets, backslash or line break |
| `TRANSACTIONAL_REPLY_TO` | with acknowledgement | — | One plain address: where candidates' replies go (the careers mailbox, Doc 14 sections 100-101) |
| `RECRUITMENT_NOTIFICATION_RECIPIENT` | with a provider | — | One plain address: the internal new-application notification (Doc 09 section 129) |
| `APPLICATION_ACKNOWLEDGEMENT_ENABLED` | no | `false` | `true` \| `false`. `true` is refused unless a provider, the From address and the Reply-To are configured |
| `EMAIL_RECIPIENT_ALLOWLIST` | with a provider, outside production | — | Comma-separated exact addresses and/or `@domains` (1–50). Outside production a provider may only email these (Doc 14 sections 182-183); refused when `APP_ENV=production` |
| `NOTIFICATION_RETRY_MAX_ATTEMPTS` | no (B6) | `5` | 1–20. Attempts per notification before the retry command stops (`EXHAUSTED`) |
| `NOTIFICATION_RETRY_BASE_DELAY_MS` | no (B6) | `60000` | 1000–86400000. Backoff after a transient failure: doubles per attempt, at most 6 hours |

Configuration is validated once at startup with Zod. **Invalid or missing
production-critical configuration stops the process** rather than serving
traffic in a half-configured state. Error messages name the offending variable
and never print its value.

Variables recorded in `.env.example` as *future* — `PUBLIC_SITE_URL`,
production storage-provider settings — are deliberately
**not** read or required. Requiring a variable nothing consumes would imply the
capability exists.

The configuration object carries `MONGODB_URI` because the connection code
needs it, but serialising the object (`JSON.stringify`, `console.log`, a logger)
prints `[redacted]` in its place.

### `TRUST_PROXY` deserves care

It defaults to `false`. Trusting `X-Forwarded-For` when no proxy sets it lets
any client spoof its IP and bypass the rate limit completely. The correct
production value depends on how many proxies actually sit in front of the app
and must be confirmed per deployment.

---

## Endpoints

### `GET /api/v1/health` — liveness

Is the process alive and serving HTTP? No authentication, no database, no
dependency of any kind. Returns `200` while the process is running.

```json
{ "success": true, "data": { "status": "ok" }, "meta": { "requestId": "…" } }
```

A liveness probe must not depend on the database — one that did would restart a
healthy instance during a database blip.

### `GET /api/v1/health/ready` — readiness

Should this instance receive traffic? `200` only when **every** required
dependency is ready:

| Dependency | Owner | State at B1 |
| --- | --- | --- |
| `configuration` | B1 | ready |
| `database` | B2 | ready **only while the MongoDB connection is open** — set from the driver's real `connected` / `disconnected` / `error` events |
| `resumeStorage` | B4 | **ready** only after the configured storage wrote, read back and removed a probe object at startup; `unavailable` when no storage is configured locally; `not_implemented` on a deployed instance (production provider: C6) |
| `notifications` | B6 | `not_implemented` while no transport is configured (`TRANSACTIONAL_EMAIL_PROVIDER=none`); with a transport, **ready** only after its bounded `verify()` succeeded at startup (r4, SMTP: connection, TLS and login — **nothing sent; not evidence of relay acceptance or delivery**), otherwise `unavailable` with a fixed reason logged (a transport without `verify()` is `NOT_VERIFIABLE`, never ready). Later provider failures are recorded per notification; r4: a login the relay refuses later turns it `unavailable` at once |

So a B6 runtime without a configured transport (or whose relay login is refused), even with MongoDB connected and storage ready, answers:

```
HTTP/1.1 503 Service Unavailable
{ "success": false, "error": { "code": "SERVICE_UNAVAILABLE", "message": "Service is not ready." }, "meta": { … } }
```

That is correct, not a bug. The public body never says *which* dependency is
missing — that would tell an unauthenticated caller which part of the
infrastructure is down. The detail goes to the internal log.

---

### `GET /api/v1/jobs` — open Jobs (B3)

Public, no authentication (Doc 09 §§48-58). Returns only Jobs whose
**effective** application status is `OPEN` at the server's current time:

```
status == PUBLISHED  AND  publishedAt <= now  AND  (closesAt is null OR closesAt > now)
```

Draft, Closed, Archived, not-yet-published and expired Jobs never appear, and
no query parameter can widen the selection.

| Parameter | Default | Rule |
| --- | --- | --- |
| `page` | `1` | whole number ≥ 1 |
| `limit` | `20` | whole number 1–50 |

Any other parameter, a repeated parameter or a malformed value is
`422 VALIDATION_FAILED` with `fieldErrors` (`page` / `limit` / `query`); the
rejected value and unknown names are never echoed. Order is `publishedAt` DESC,
then `createdAt` DESC (`_id` DESC breaks exact ties so pages are stable).

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "title": "…", "slug": "…", "location": "…",
        "workArrangement": "FULLY_REMOTE", "employmentType": "…",
        "schedule": "…", "weeklyHours": 30,
        "compensation": { "currency": "CAD", "amount": 35, "unit": "HOUR", "gross": true },
        "publishedAt": "2026-10-01T11:00:00.000Z", "closesAt": null,
        "applicationStatus": "OPEN"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  },
  "meta": { "requestId": "…" }
}
```

- **Zero Jobs is `200`** with `items: []` and `total: 0, totalPages: 0` — never 404.
- **A database failure is `503 SERVICE_UNAVAILABLE`** — never an empty success
  the Careers page could mistake for "no open roles". Disconnected MongoDB is
  detected before querying (no command buffering); a query that exceeds
  `MONGODB_QUERY_TIMEOUT_MS` is abandoned and answered with 503.
- A page past the end is `200` with an empty `items` and the true totals.
- Every response on `/api/v1/jobs…`, success or error, carries
  **`Cache-Control: no-store`** (Doc 09 §58) — including a `400`/`413` from the
  JSON body parser, a `429` from the rate limiter and a `404` for an unrouted
  path below it, because the policy is applied before those middlewares
  (`src/middleware/noStore.js`, mounted in `app.js`). Other routes are
  unaffected.

### `GET /api/v1/jobs/:jobSlug` — one public Job (B3)

Doc 09 §§59-70. Returned when the Job is **OPEN**, or a **previously public**
Job that no longer accepts applications — `status CLOSED`, or `PUBLISHED` with
`closesAt <= now` — retained at its stable URL. The detail adds `description`,
`responsibilities`, `requirements`, `preferredQualifications` and
`applicationForm`:

| `applicationStatus` | `applicationForm` |
| --- | --- |
| `OPEN` | `{ phone: { enabled, required }, message: { enabled, required, maxLength }, resume: { required: true, maxBytes: 5242880, allowedExtensions: [".pdf", ".docx"] }, screeningQuestions: [{ id, type, prompt, required, options }] }` |
| `CLOSED` | `null` — the frontend cannot reconstruct an active form |

`resume` comes from the fixed Phase 1 server policy
(`src/config/resumePolicy.js`, Doc 10 §46), not from Job data. Screening
question `id`s are the Job's server-generated UUIDs; `SINGLE_SELECT` options are
`{ optionId, label }`, every other type has `options: []`.

An **unknown, malformed, Draft, Archived or not-yet-published** slug is the
same `404 JOB_NOT_FOUND "This role isn't available."` — the responses are
indistinguishable, and an invalid slug never reaches the database. Query
parameters are not accepted (`422`). A database failure is `503`.

**Never exposed** by either endpoint: MongoDB `_id` (or any embedded id),
`internalOccupationalReference`, `status`, `closedAt`, `archivedAt`,
`createdAt`, `updatedAt`, `__v`, `amountMinor`, the location codes, or any
field not listed above. DTOs are built field by field from an allowlist
(`src/modules/jobs/job.mapper.js`), and the repository's projections do not
even read internal fields.

**Money.** MongoDB stores exact integer minor units (`3500`); the DTO carries
`amount: 35`, converted with the currency's ISO 4217 exponent from an explicit
table (`src/modules/jobs/money.js`). Only **CAD** — the currency the documents
establish — is listed; any other currency is refused by provisioning and fails
closed (safe `500`) in the public API rather than publishing a wrong wage.

### `POST /api/v1/jobs/:jobSlug/applications` — Apply (B5)

No authentication (Phase 1). `multipart/form-data`. Header **`Idempotency-Key`**
required: one high-entropy key per logical submission (a UUID v4 is
preferred), reused for every retry of that submission.

| Part | Rules |
| --- | --- |
| `fullName` | required; trimmed; 2–120 characters; any script; no control characters |
| `email` | required; trimmed; syntactically valid; at most 254; stored as given **and** normalised (trim + lowercase only) |
| `phone` | only if the Job enables it (a non-empty value for a Job that does not is refused); required only if configured; 7–32 characters of digits and `+ - ( ) . /` and spaces, at least 7 digits |
| `message` | only if enabled; required only if configured; at most the Job's `maxLength` (≤ 5000); internal newlines kept |
| `screeningAnswers` | JSON `[{"questionId": "...", "answer": ...}]`, at most 20, each question once; `answer` is a string (text / the option id of a single-select), a boolean (yes/no) or `null` (not answered). Validated against the Job's current questions |
| `resume` | exactly one file; the B4 rules (PDF/DOCX, 5 MiB, structure) |
| anything else (`status`, `scanStatus`, `jobId`, `submittedAt`, …) | refused — `422`, never stored |

Success — `201` (first submission) or `200` (idempotent replay):

```json
{
  "success": true,
  "data": {
    "status": "RECEIVED",
    "job": { "title": "…", "slug": "…" },
    "submittedAt": "2026-10-05T12:00:00.000Z"
  },
  "meta": { "requestId": "…", "replayed": false }
}
```

Nothing the candidate sent, no filename, storage key, internal id or
notification state is ever returned. `Cache-Control: no-store` on every answer.

| Condition | Status | Code |
| --- | --- | --- |
| no / malformed `Idempotency-Key` | 400 | `IDEMPOTENCY_KEY_REQUIRED` / `INVALID_IDEMPOTENCY_KEY` |
| not multipart | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| field / answer / missing-resume errors | 422 | `VALIDATION_FAILED` with `fieldErrors` (`fullName`, `email`, `phone`, `message`, `resume`, `screeningAnswers`, `screeningAnswers.<questionId>`) |
| unknown, Draft, Archived or not-yet-published Job, invalid slug | 404 | `JOB_NOT_FOUND` ("This application isn't available.") |
| Closed Job, `closesAt` passed — also when it closes DURING the request | 409 | `JOB_NOT_ACCEPTING_APPLICATIONS` |
| same key, different submission (or another Job) | 409 | `IDEMPOTENCY_KEY_REUSED` |
| resume type / size / content | 415 / 413 / 422 | B4 codes |
| too many attempts | 429 | `RATE_LIMITED` |
| storage or database unavailable, outcome not confirmable, indexes missing | 503 | `SERVICE_UNAVAILABLE` ("We couldn't submit your application right now. Please try again.") |
| unexpected defect | 500 | `INTERNAL_ERROR` |

Answers given before the upload is read (400 key, the **Apply** limiter's 429,
503 storage not configured, and B4's 413/503) carry `Connection: close` and
close the connection in stages, so the client receives them and the upload is
never processed as another request. The general public limit's 429 (B1,
unchanged) is answered completely with the connection kept open; Node then
reads and discards the unread upload — nothing is parsed, stored or created,
and a request pipelined behind it is framed as its own request and is itself
subject to the limit. **Limitation (server-wide since B1, not B5) — OPEN,
tracked for B7, must be resolved before public deployment:** that discard is
not bounded by the B4 staged-close limits (8 MiB, 5 s) — only by Node's
default `requestTimeout` (300 s; `server.js` does not set it, and the 300 s
bound itself is not measured by a test) or the client; B1's 404 and B4's
non-multipart 415 behave the same. Measured in
`tests/apply-connection.test.js`. A reverse-proxy body limit configured later
does not by itself close this item; B7 must resolve and verify it.

## Response envelopes

Success:

```json
{ "success": true, "data": {}, "meta": { "requestId": "…" } }
```

Error:

```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Safe message." }, "meta": { "requestId": "…" } }
```

Field validation (Doc 09 §21) adds `fieldErrors`:

```json
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "Some information needs to be corrected.",
  "fieldErrors": [ { "field": "limit", "code": "INVALID_LIMIT", "message": "limit must be a whole number from 1 to 50." } ] },
  "meta": { "requestId": "…" } }
```

| Code | Status | When |
| --- | --- | --- |
| `API_ROUTE_NOT_FOUND` | 404 | Unknown route. Always JSON, never Express HTML |
| `MALFORMED_REQUEST` | 400 | Body is not valid JSON |
| `PAYLOAD_TOO_LARGE` | 413 | JSON body over 100 KB |
| `RATE_LIMITED` | 429 | General rate limit exceeded |
| `SERVICE_UNAVAILABLE` | 503 | Readiness dependencies not ready; from B3 also MongoDB unavailable for a Jobs read |
| `INTERNAL_ERROR` | 500 | Unexpected failure |
| `VALIDATION_FAILED` | 422 | B3: invalid or unsupported Jobs query parameters. Carries `fieldErrors` |
| `JOB_NOT_FOUND` | 404 | B3: unknown, invalid, Draft, Archived or not-yet-published Job — one indistinguishable answer |

A `500` never contains a stack, file path, environment variable, connection
string, credential or driver message — **and neither does the log**. Logs
record the requestId plus a bounded classification (error type, status,
canonical code) taken from fixed tables, never the error's own `message`,
`stack`, `cause`, `name` or `code`. The requestId appears in both the log and
the client's response, which is how a user's report is correlated.

## Request correlation

Every request gets a high-entropy id, returned as `X-Request-ID` and repeated
in `meta.requestId` and every log line. An inbound `X-Request-ID` is reused
only if it matches `^[A-Za-z0-9._-]{8,128}$` — otherwise a fresh UUID is
generated, so a caller cannot forge log entries with newlines or bloat logs
with a huge value.

## Logging

Structured Pino, JSON in production. Each request logs method, path, status,
duration and request id.

Bodies are **never** logged — a resume, a name and an email pass through them.
Query strings are stripped, so an accidental `?email=…` cannot reach a log
file. Authorization, cookie and API-key headers are redacted defensively.

Error text is never logged either. `message`, `stack` and `cause` carry
connection strings, credentials, filesystem paths and request-body fragments,
and `name`/`code` are ordinary writable properties that a library could set to
anything — so every logged value comes from a fixed table instead of from the
error object. Startup failures follow the same rule: a configuration error is
printed in full because its text is built only from a value-free rule table,
while any other startup exception prints its classification only.

## Security

- `X-Powered-By` disabled
- Helmet: CSP `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`,
  `no-referrer`, HSTS, same-origin resource policy
- CORS from an explicit allowlist; no wildcard, no credentials
- 100 KB JSON body limit
- General rate limit: 120 requests / 60 s / client IP, configurable

The health endpoints are **exempt from rate limiting** on purpose. A platform
probe polling every second would consume the budget, start receiving 429s, be
read as unhealthy and trigger a restart loop — a self-inflicted outage. Those
endpoints touch no database and return no data.

## Middleware order

Order is the design, not a preference:

1. trust proxy — before anything reads `req.ip`
2. request id — so every later log line and error can be correlated
3. request logging — early, so even a rejected request is recorded
4. security headers — before any response body exists; for `/api/v1/jobs…`
   also `Cache-Control: no-store` (B3), so it covers responses that parsing or
   rate limiting end early
5. CORS — before the body is read, so preflight stays cheap
6. JSON body parsing (100 KB limit)
7. general rate limiting — after identity, before route work
8. API routes
9. API 404 — only reached when nothing matched
10. central error handler — last

## Graceful shutdown

On `SIGINT`/`SIGTERM`:

1. readiness is marked unavailable, so a load balancer stops sending new work
   **before** the socket closes;
2. the HTTP server stops accepting connections and lets in-flight requests
   finish — at most 10 s, after which remaining connections are closed;
3. registered dependency hooks run, in order — from B4 the temporary upload
   area (its remaining files and its directory are removed) and the resume
   storage, from B2 the MongoDB connection (the `database` dependency is
   marked unavailable first) — together at most another 10 s. A close that fails or never settles is abandoned and
   reported (`dependency failed to close` / `dependency close timed out`),
   never reported as closed;
4. the process exits **0 only if every step finished cleanly**, otherwise 1
   (`shutdown finished with incomplete cleanup`). A second signal during
   shutdown forces exit code 1 immediately.

The same bound applies to the cleanup that runs when startup fails after the
database has connected (for example, the port is already in use): the
original startup error is reported and the process still exits with code 1.

The deadline timers are deliberately kept referenced until the outcome is
reported: a close that never settles holds no event-loop handle of its own, so
an unreferenced deadline would let the process drain and exit 0 before the
timeout was logged. They are cleared as soon as each step finishes.

`startServer()` returns handles rather than calling `process.exit`, so tests
can start and stop a real server without terminating the runner. Signal wiring
lives in `installSignalHandlers()` and is not invoked on import. Shutdown hooks
belong to each server instance, and if the socket cannot be bound (a port
already in use) the database connection opened just before is closed and
startup is refused.

`startServer({ database })` accepts a connector with the shape
`{ connect, disconnect }` so the offline tests can exercise the HTTP lifecycle
without a MongoDB server. `npm start` never passes one: production always uses
the real Mongoose connector (`mongoDatabase` in `src/db/mongoose.js`).

Startup failures print one bounded line: configuration errors name the
variable and rule (never the value); an unreachable database prints
*"the database connection could not be established. Check that MONGODB_URI
names a reachable MongoDB server."*; storage that cannot be initialised prints
*"the private resume storage could not be initialised (<REASON>)"* with a fixed
reason token such as `PERMISSIONS_TOO_OPEN` (never the path) — and is checked
BEFORE the database is contacted; anything else prints only a fixed
classification such as `Error (EADDRINUSE)`. Driver messages, hosts, URIs and
stacks are never printed.

---

## Database (B2)

Governed by 10_DATA_MODEL.md. Phase 1 creates only two collections.

| Model | Collection | Source |
| --- | --- | --- |
| `Job` | `jobs` | `src/models/Job.js` |
| `Application` | `applications` | `src/models/Application.js` |

No `candidates`, `resumes`, `notifications`, `admins`, `auditEvents`,
`employees`, `payStatements` or `contactSubmissions` collection exists.

**Job** — Draft Jobs may be incomplete (Doc 10 §65); publication requires the
§64 readiness fields (plus `applicationConfig.resumeRequired === true`, §43).
Lifecycle: `DRAFT → PUBLISHED | ARCHIVED`, `PUBLISHED → CLOSED`,
`CLOSED → PUBLISHED | ARCHIVED`, `ARCHIVED` terminal. `publishedAt` records the
first publication and is never changed or erased; the slug is immutable once
published. Money is stored as integer minor units (`3500` = CAD 35.00). The
effective application status (`OPEN`/`CLOSED`) is computed, never stored.
Helpers: `src/modules/jobs/job.service.js` (`publishJob`, `closeJob`,
`archiveJob`, `applyJobEdit`, `effectiveApplicationStatus`) and the shared
pure rules in `job.rules.js`.

**Application** — `jobId` + an immutable `jobSnapshot`, the embedded
candidate (email normalised by trim + lowercase only), screening-answer
snapshots, resume metadata (`scanStatus` defaults to `NOT_SCANNED`, never
`CLEAN`), `status` `RECEIVED`, idempotency **hashes** (key and §114 request
fingerprint — never the raw key or a copy of the payload), notification state
(`PENDING` / `NOT_REQUIRED`, never `SENT` by default), server-side
`submittedAt`, and `retention` left `null` (no invented period, no TTL index).
Builder: `src/modules/applications/application.service.js`.

**Screening identifiers.** Every `questionId` and `optionId` is a UUID
(generated when not supplied), question IDs are unique within a Job, option IDs
are unique within a question, and an identifier loaded from the database can
never be rewritten in place — ordinary edits keep it. Application answers
reference those UUIDs, one answer per question.

**The only supported write path is a fully validated document save** —
`new Model(...).save()`, `Model.create(...)` or `doc.save()`, normally through
the services — where schema validation and every model rule run (Job
lifecycle and publish readiness, slug and first-publication immutability,
Application submission history). Everything that would write *without* those
rules is rejected before it reaches the database (`src/models/writeGuards.js`):
query updates and replacements (`updateOne`, `updateMany`, `findOneAndUpdate`,
`findByIdAndUpdate`, `replaceOne`, `findOneAndReplace`, `doc.updateOne()`),
`bulkWrite` / `bulkSave`, `insertMany`, saves that pass `pathsToSave` at all,
or that pass `validateBeforeSave` / `validateModifiedOnly` / `timestamps` with
anything other than exactly `true` / `false` / `true` (judged by property
presence, as Mongoose judges it — so `validateBeforeSave: undefined`, `0`, `''`
or `null` cannot switch validation off), and aggregations with `$out` /
`$merge`. Reads
and deletes are unaffected. The raw driver (`Model.collection.*`) is not a
supported write path. A later milestone that needs an atomic update must add a
narrowly scoped, validated helper rather than re-open query updates.

### Indexes

The single source of truth is `src/db/indexes.js`. `autoIndex` and
`autoCreate` are off: nothing is built implicitly on first use.

| Collection | Name | Keys | Options |
| --- | --- | --- | --- |
| `jobs` | `slug_unique` | `{ slug: 1 }` | unique |
| `jobs` | `public_listing` | `{ status: 1, publishedAt: -1, closesAt: 1, createdAt: -1 }` | — |
| `applications` | `job_submittedAt` | `{ jobId: 1, submittedAt: -1 }` | — |
| `applications` | `candidateEmail_job_submittedAt` | `{ "candidate.emailNormalized": 1, jobId: 1, submittedAt: -1 }` | **not** unique |
| `applications` | `idempotency_keyHash_unique` | `{ "idempotency.keyHash": 1 }` | unique |
| `applications` | `resume_storageKey_unique` | `{ "resume.storageKey": 1 }` | unique |

```powershell
npm run db:indexes:apply   # creates only what is missing; safe to re-run
npm run db:indexes:check   # exit 0 only if all six exist with the right keys/options
```

Both commands act on the database named by `MONGODB_URI`, read from `.env`
like `npm start`. A value set in the shell takes precedence over `.env`, so an
operator can point a single run at another database by setting
`$env:MONGODB_URI` for that run (clear it afterwards with
`Remove-Item Env:MONGODB_URI`). `verify:b2` runs them against the approved test
database itself.

`apply` compares first and creates only missing indexes. It **never** drops or
rebuilds an index, deletes a record or resets a database: an incompatible index
(right keys, wrong options) is reported as `CONFLICT … not modified` and the
command exits non-zero so a person resolves it deliberately. `check` compares
key order, direction and the significant options (`unique`, `sparse`,
`partialFilterExpression`, `expireAfterSeconds`, `collation`) against what the
database actually reports. Neither prints the connection string.

### B2 verification

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b2
```

`verify:b2` runs, and reports PASS/FAIL for each gate:

1. Node.js 24 runtime (engines `>=24 <25`);
2. the offline suite;
3. real-database prerequisites — `MONGODB_TEST_URI` set, accepted by the
   safety guard below, and reachable;
4. `db:indexes:apply` against that test database;
5. the real-database suite (`tests/db`): persistence across a **process
   restart**, unique-index rejection, concurrent duplicate idempotency keys,
   lifecycle and history rules, index-command repeatability and conflict
   reporting, and server startup/shutdown against MongoDB;
6. `db:indexes:check` against that test database.

**The database gate cannot be skipped.** Without `MONGODB_TEST_URI`, or with an
unreachable database, `verify:b2` exits non-zero.

**Destructive-test safety guard** (`scripts/test-database.mjs`). The database
checks delete records and drop indexes, so they run only against an explicitly
disposable target, judged on the environment the command was launched with:

- `MONGODB_TEST_URI` is a valid MongoDB connection string that names its
  database explicitly;
- the database is named exactly `valida_test` or `valida_test_<suffix>`
  (lowercase letters, digits, underscores — e.g. `valida_test_ci`). A name that
  merely *contains* "test", such as `valida_latest`, is refused, as is any name
  with a `prod`, `production`, `live`, `staging` or `main` segment;
- the launching environment is not production (`APP_ENV` / `NODE_ENV` not
  `production`);
- it is a different database from `MONGODB_URI` in the environment **and** in
  `backend/.env`. A genuinely missing `backend/.env` is fine — the file is not
  found **and** its containing directory is confirmed to be a directory. If it
  is not a readable file (a directory, a path through a file, a missing or
  uninspectable parent, a permission or I/O error), or either value cannot be
  parsed, the run is refused.

`verify:b2` checks this first and, if refused, exits 1 before running or
contacting anything. `test:db` checks it in its global setup (aborting before
any test file loads) and again in every test file; the restart-persistence
child process checks it itself and connects only to the approved test URI.
Before each destructive step the tests also confirm the live connection is to
the approved database by name. Tests may still start the server in production
mode, but only against that isolated test database.

---

## Job provisioning (B3)

Until the protected Recruitment Admin exists (Release E), Jobs are created and
maintained with a **controlled operator command** (Doc 12 §§46-47, Doc 15
§§171-175). It is not an HTTP endpoint, and changing a wage, status, closing
date or content never requires editing frontend code.

A Job is described by a **definition file** — JSON holding the complete desired
state of one Job — and identified by its `slug`:

| Key | Meaning |
| --- | --- |
| `slug` | the Job's identity and canonical URL segment (`/careers/{slug}`) |
| `status` | the desired lifecycle state after this run: `DRAFT`, `PUBLISHED`, `CLOSED` or `ARCHIVED` |
| `awaitingInput` | content still waiting for approval. **While it is non-empty the Job cannot be published** |
| `notes` | provenance notes for humans; never stored, never published |
| `title` … `closesAt` | every content field of Doc 10 §19, all present (use `null` / `""` / `[]` for empty). Money is `compensation.amountMinor` in integer minor units (`3500` = CAD 35.00); `closesAt` is an ISO 8601 time with an offset, or `null` |

The committed definition of the **real initial role** is
`provisioning/jobs/cybersecurity-specialist.json`. It contains only the
source-established planning data — *Cybersecurity Specialist*, internal
reference `NOC 21220` (never public), *British Columbia, Canada*,
`FULLY_REMOTE`, 30 hours/week, CAD 35.00 gross per hour — and declares
**AWAITING INPUT** for the employment type, final schedule wording,
description, responsibilities, requirements, preferred qualifications,
screening questions and closing date. Its status is `DRAFT`. Nothing may be
invented to make it publishable (Doc 12 §45); the illustrative values in the
Doc 09 API examples are not approval.

### Commands (Windows PowerShell, from `backend/`)

```powershell
# 1. See exactly what would change. Writes nothing.
npm run jobs:provision:plan -- --file provisioning/jobs/cybersecurity-specialist.json

# 2. Make that change.
npm run jobs:provision:apply -- --file provisioning/jobs/cybersecurity-specialist.json
```

Both act on the database named by `MONGODB_URI` (from `.env`, or the shell for
one run) and never print the connection string. Run `npm run db:indexes:apply`
once first: `apply` refuses to write unless the `jobs` indexes exist, because
slug uniqueness must be enforced by the database, not by a lookup.

`plan` prints the action (`create` / `update` / `unchanged`), the fields that
would change, any lifecycle transition, the **public effect** (what the public
sees before → after: `OPEN`, `CLOSED`, not public), whether
`--confirm-lifecycle` is required, publish readiness, the `awaitingInput` list
and any refusal.

`apply` ends with exactly one of these results — and says "nothing was
written" only where that is established:

| Result | Meaning | Exit |
| --- | --- | --- |
| `CREATED` / `UPDATED` | every write acknowledged and the stored Job read back | 0 |
| `UNCHANGED` | the stored Job already matches; nothing was written | 0 |
| `REFUSED — nothing was written` | refused before any write, or its only write was certainly rejected (e.g. `DUPLICATE_SLUG`) | 1 |
| `INCOMPLETE` | some writes were acknowledged (listed under `written`) and a later step was certainly not applied — e.g. created as DRAFT, publication rejected | 1 |
| `NOT CONFIRMED` | the database did not confirm whether a step was applied, or the result could not be read back; nothing is assumed either way | 1 |

Nothing is ever rolled back or deleted. After `INCOMPLETE` or `NOT CONFIRMED`,
run the same `plan` command to see what is stored, then re-run `apply` — it
writes only what still differs. A failure before any write (configuration,
connection, reading the stored Job) prints "Nothing was written"; a failure
after the result was printed (closing the connection) says the result stands.
Exit codes: `0` success, `1` refused / incomplete / not confirmed / invalid /
failed, `2` usage error. Driver messages, stack traces and the connection
string are never printed.

### Guarantees

- **Validated first.** The definition is checked against a strict schema
  before any database access: unknown keys (including `publishedAt`,
  `closedAt`, `_id`), wrong types, out-of-range values, a currency without a
  verified exponent, inconsistent phone/message toggles, duplicate screening
  prompts or option labels are refused.
- **Safe to re-run.** `apply` writes only what differs; re-applying the same
  file reports `UNCHANGED` and writes nothing (`updatedAt` untouched). One slug
  is one Job; a concurrent duplicate create is refused by the unique index as
  `DUPLICATE_SLUG`, never stored twice. A different slug is a different Job —
  a Job is never renamed by provisioning, so a published slug cannot change.
- **The approved B2 write path only.** New Jobs are created with a validated
  save as `DRAFT`; edits go through `applyJobEdit`; lifecycle changes go
  through `publishJob` / `closeJob` / `archiveJob`. The Job model then enforces
  its own rules on every save. No write guard is bypassed.
- **Intentional lifecycle changes.** Publish, close, reopen and archive happen
  only with `--confirm-lifecycle`, only as one documented transition per run
  (`DRAFT→PUBLISHED|ARCHIVED`, `PUBLISHED→CLOSED`, `CLOSED→PUBLISHED|ARCHIVED`).
  Publishing additionally requires an empty `awaitingInput`, complete
  publish-ready content, no placeholder text (`AWAITING INPUT`,
  `[DEV FIXTURE]`, `lorem ipsum`) and a `closesAt` that is `null` or in the
  future. `publishedAt` is set once and kept through close and reopen.
  `ARCHIVED` is terminal: an archived Job is never modified.
- **Effective opening and closing need the same confirmation.** Editing
  `closesAt` can close or reopen a PUBLISHED Job without any status change: a
  closing time at or before now closes an open Job; removing a passed closing
  time, or moving it into the future, reopens an expired one. Any run that
  changes what the public sees (`OPEN` ↔ `CLOSED` ↔ not public) is applied
  only with `--confirm-lifecycle`, and is refused before any write otherwise.
  Setting a future closing time on an open Job only schedules the close and
  needs no confirmation. A Job that expired on schedule and is re-applied
  unchanged is `UNCHANGED`: the passage of time is not an operator action.
- **No silent material change.** Once Applications exist for a Job, changing
  its compensation, weekly hours, work arrangement, location, employment type,
  responsibilities or requirements also needs `--confirm-material-change`
  (Doc 12 §§41-42 prefer closing the Job and creating a new one).
- **Stable screening identifiers.** Question and option UUIDs are generated by
  the server once and kept on every later run: a question keeps the identifier
  of the stored question it names by `questionId`, or — when it gives none — of
  the stored question with the same type and prompt; options likewise by
  `optionId` or label. Unmatched questions/options are new and get fresh UUIDs.
  A definition can never invent an identifier: an unknown `questionId` or
  `optionId` is refused. `apply` prints the resulting identifiers.

### Publishing the real role later

Only when Saeed has approved the missing content: fill in those fields in the
definition, remove them from `awaitingInput`, set `"status": "PUBLISHED"`, run
`plan`, then `apply … --confirm-lifecycle`.

---

## B3 verification

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b3
```

`verify:b3` applies the same fail-closed test-database guard as `verify:b2`
(refusing before running anything), then reports PASS/FAIL for:

1. Node.js 24 runtime (the OS is printed too);
2. the complete offline suite — B1, B2 and B3;
3. real-database prerequisites (`MONGODB_TEST_URI` set, accepted by the guard,
   reachable);
4. `db:indexes:apply` against the test database;
5. the complete real-database suite — every B2 test plus the B3 suites
   `tests/db/jobs-api.test.js` (the public API over real MongoDB and HTTP:
   open-only selection, exact `publishedAt`/`closesAt` boundaries, sort and
   pagination, DTO privacy, the `public_listing` query plan, 503 on a lost
   connection, and `node src/server.js` serving Jobs from MongoDB) and
   `tests/db/job-provisioning.test.js` (create, re-run, update, lifecycle,
   first-publication preservation, effective closing/reopening through
   `closesAt` and its exact boundaries, unchanged re-application of an expired
   Job, duplicate slugs under concurrency, missing index refusal,
   material-change confirmation, screening identifiers, and the provisioning
   CLI itself);
6. `db:indexes:check` against the test database.

**The database gate cannot be skipped.** Without `MONGODB_TEST_URI`, or with an
unreachable database, `verify:b3` exits non-zero and says so. Passing
`npm test` alone is not B3 verification.

---

## Private resume storage & validation (B4)

Governed by 09_BACKEND_API_SPEC.md sections 94-108 and 137-145,
10_DATA_MODEL.md sections 94-108 and 206-209,
13_SECURITY_PRIVACY_THREAT_MODEL.md sections 57-79 and 255-256,
17_QA_TEST_PLAN.md sections 115-127, 18_IMPLEMENTATION_ROADMAP.md sections
113-121.

B4 provides the pieces the Apply route (B5) composes, in the canonical order
(Doc 09 section 118): parse -> validate -> store -> *(B5: persist the
Application, compensate on failure)*. **No public route uses them yet**; the
tests drive them through a test-only route (`tests/fixtures/uploadHarness.js`)
mounted via `createApp`'s test hook, which `server.js` never passes.

| Piece | Where |
| --- | --- |
| Bounded multipart parsing, owned temporary files | `src/lib/multipart/multipart.js`, `tempUploadArea.js` |
| Resume validation (the layers below) | `src/modules/applications/resume/resumeValidation.js` |
| PDF / DOCX / ZIP structure checks | `pdfInspector.js`, `docxInspector.js` (+ `packageXml.js`), `zipInspector.js` (same folder) |
| Filename normalisation | `filename.js` |
| Store -> `Application.resume` metadata, compensation | `resumeStorage.js` |
| Storage boundary, local adapter | `src/integrations/storage/` |
| The policy (one module for B3's advertised and B4's enforced values) | `src/config/resumePolicy.js` |

### Validation — every layer must agree

| Check | Refused with |
| --- | --- |
| request is `multipart/form-data` with a boundary | `415 UNSUPPORTED_MEDIA_TYPE` / `400 MALFORMED_REQUEST` |
| declared or streamed body within the file limit + the caller's text-field limits + 64 KiB | `413 PAYLOAD_TOO_LARGE` before the body is processed; connection closed in stages (below) |
| exactly one file, in the field `resume` | `422 VALIDATION_FAILED` — `resume: RESUME_REQUIRED` or `SINGLE_FILE_REQUIRED` |
| only the allowed text fields, once each, within their byte limits | `422 VALIDATION_FAILED` — `form: UNSUPPORTED_FIELD` / `TOO_MANY_FIELDS`, `<field>: DUPLICATE_FIELD` / `TOO_LONG` (an unknown field name is never echoed) |
| extension `.pdf` or `.docx` (legacy `.doc`, `.docm`, `.dotx`, `.exe`, none… refused) | `415 UNSUPPORTED_MEDIA_TYPE`, `resume: UNSUPPORTED_FILE_TYPE` |
| declared MIME type allowed **and** the one matching the extension | `415 UNSUPPORTED_MEDIA_TYPE` |
| size 1 … 5,242,880 bytes | empty: `422 INVALID_RESUME_FILE`; over: `413 FILE_TOO_LARGE` |
| content is really that format (below) | `422 INVALID_RESUME_FILE` |
| storage accepted the object durably | otherwise `503 SERVICE_UNAVAILABLE` — never success |
| the server could hold the upload (temporary file reserved and written) | otherwise `503 SERVICE_UNAVAILABLE` **at once**, connection closed in stages — never a 400, never a hang |

Client-facing wording comes from Doc 06 (126 type, 127 too large, 128
processing, 139 required). The log records a fixed reason token and the
detected real format (`"reason":"PDF_HEADER_MISSING","detected":"PE_EXECUTABLE"`)
— never the filename, content, path or storage key.

**PDF** (`pdfInspector.js`): `%PDF-x.y` at byte 0 (no prefix — polyglots), an
`%%EOF` in the last 4 KiB followed only by whitespace (nothing appended), and
`startxref` pointing inside the file at a **real cross-reference section**:
either an `xref` table — subsection headers and well-formed fixed-width
entries (20 bytes; the common 19- and 21-byte variants are accepted, one width
per subsection), then `trailer` and a dictionary with `/Size` and `/Root` — or
a cross-reference **stream** (`/Type /XRef`, `/Size`, `/W`, `/Root`, a direct
`/Length` ending at `endstream`; FlateDecode with PNG predictors decoded
within a hard output limit). The `/Root` reference is then followed through
the sections (latest first, a hybrid file's `/XRefStm`, then `/Prev`) and must
be an in-use `n g obj` holding a complete `/Type /Catalog` dictionary and
`endobj` — or, for a compressed catalog, an in-use `/Type /ObjStm` object. A
hybrid section whose table and stream disagree about an object, or a
dictionary repeating a key the check reads (`/Root`, `/Size`, `/Prev`,
`/Type`, …), is refused as ambiguous. Every read is a bounded window;
sections (32), subsections (10,000 per file), tokens, nesting and
decompressed bytes (4 MiB per stream, 8 MiB per file) are capped. Page content is never parsed, decompressed or
rendered. (Review r1 finding 4: r1 checked only the first token at the
offset, so `%PDF-1.7 xref NOT_A_PDF startxref 9 %%EOF` passed.)

**DOCX** (`docxInspector.js` over `zipInspector.js`): nothing is ever
extracted to disk. The ZIP directory is read and checked strictly (end record
at end of file, no prepended/appended/hidden data, contiguous non-overlapping
entries, local headers agreeing with the directory, no encryption, ZIP64,
multi-disk or unusual compression, safe unique entry names) and bounded
before anything is decompressed: at most 1000 entries (Apache POI's default),
at most 100 MiB declared in total, at most 100:1 compression per entry above
100 KiB (POI's ratio and grace size). Then only `[Content_Types].xml` and
`_rels/.rels` are inflated in memory, each capped at 256 KiB via zlib's
`maxOutputLength`, verified by size and CRC-32, and parsed as XML
**structure** by a small, bounded, namespace-aware reader (`packageXml.js`; no
XML library, linear time, a tag over 8 KiB, more than 4096 elements or depth 8
is refused): comments and processing instructions are skipped and can never
declare anything, CDATA and character data are refused, elements must nest
and there must be exactly one root, and elements are identified by namespace
URI, never by prefix. The roots, children and attributes must be exactly the
OPC schema's, and a package that declares something twice — two Defaults for
one extension, two Overrides for one part name (compared as OPC compares
them — escapes decoded, ASCII case-insensitive — and, to leave no room for
readers that fold case more widely, also Unicode case-insensitive), two
relationships with one Id — is refused as ambiguous instead of "last one
wins"; so is a declaration that only a Unicode-case-insensitive reader would
apply to the main part. (Review r1 finding 1: r1's
tag scanner read an `<Override>` inside a comment and let it overwrite the
real one, so a `.docm` passed as a `.docx`.) The package must name
exactly one internal main document whose content type is exactly the
WordprocessingML document type — macro-enabled, template and non-Word
(spreadsheet, presentation, ODF) packages are refused, and so is any VBA part.
A DTD in either part is refused rather than processed.

Tested against real authoring tools' output (LibreOffice, pandoc,
python-docx, Chromium print-to-PDF, ReportLab, qpdf) in
`tests/fixtures/resumes/` — all synthetic.

**Structural validity is not a malware verdict.** Every stored resume is
recorded `scanStatus: NOT_SCANNED`, `scanCheckedAt: null`: the metadata
builder ignores any scan value it is given, so nothing can record `CLEAN`.
(A client field named `scanStatus` is also refused, because the parser
rejects every field outside the caller's allowlist — B5 must not add one.) The malware scanner is
AWAITING INPUT; resume review (E4) stays blocked until it exists (Doc 11
sections 172-174).

### Filenames

The original name is metadata only (Doc 10 section 98): Unicode NFC; only
the last path segment (`/` and `\`); control characters, bidirectional
overrides and invisible characters removed (the zero-width joiner and
non-joiner are kept — Persian and emoji need them); Windows-forbidden
characters (`< > : " | ? *`) replaced; Windows device names prefixed; cut to
255 characters keeping the extension and whole graphemes. It never names
anything on disk.

### Storage

`RESUME_STORAGE_DRIVER=local` (development only) writes to
`RESUME_STORAGE_LOCAL_ROOT`:

```
<root>/resumes/<32 hex>/<32 hex>     the object (0600), one directory (0700) per object
```

The key `resumes/<id>/<fileKey>` is 2 x 128 bits from the CSPRNG in lowercase
hex (case-insensitive filesystems cannot merge two keys). It is generated by
the storage boundary, never derived from the filename, and never sent to a
client (Doc 11 section 168). A write goes to an exclusively created
`.partial-*` file, is hashed and counted while written, flushed, checked
against the validated size and SHA-256, then renamed into place and the
directory synced; any failure removes it and rejects. Directories are never
reused: a key collision is detected, never overwritten.

**Real locations, not written paths** (review r1 finding 2). The root is
checked as written AND where it really leads: configuration and `init()`
resolve it through every symbolic link and Windows junction
(`fs.realpath.native`) and refuse a location inside a public/static/served
directory or the repository before creating anything; `init()` then pins the
root's real path and checks it again. Before every store, stat, delete and
cleanup the adapter proves the directory it is about to use is a real
directory (not a link or junction) that resolves to exactly its expected
place under the pinned root — so a linked object directory, or a linked
ancestor, makes the operation fail with `PATH_ESCAPES_STORAGE` and nothing
outside storage is written or deleted. Links in the path *above* a root are
allowed when they lead somewhere allowed (macOS `/var`, a redirected profile).
Node has no `openat`/`O_NOFOLLOW` for directories, so a process swapping
directories inside the private root in the instant between check and use is
not excluded; such a process already has write access to the root.

`deletePrivateObject(key)` accepts only a valid resume key, never follows a
link — at the object or in any parent — and removes exactly one object. `discardStoredResume()` is the B5
compensation step: it never throws, reports `DELETED` / `ABSENT` /
`ORPHANED`, and logs an orphan with its one-way object reference — never the
storage key or a path (changed in B5, see "Logs and reconciliation (B5)") — for
reconciliation. There is **no read, list or URL operation**: Phase 1 has no
resume retrieval (Doc 09 section 170) and no public file URL.

On POSIX the root must not be accessible to other users (the backend creates
it `0700`; an existing looser directory is refused). On **Windows** the mode
bits do not express access control — choose a root inside your own profile,
e.g. `C:\Users\<you>\AppData\Local\valida-dev-private-resumes`.

### Temporary files

Each process has one temporary upload directory (`mkdtemp`, owner-only, in
the OS temporary directory) holding an `.owner` marker with its process id:
one randomly named file per upload, removed before the response is sent, on
every failure path, and at shutdown. The area deletes only files it created.
At startup it removes upload files left by a **crashed** process: only in
its own-named directories, only when older than 24 hours AND the recorded
owner process is no longer running — an idle but running process's area is
never touched. If something outside the backend (an OS temp cleaner such as
Windows Storage Sense) deletes the directory, the next upload recreates it.

The area remembers its directory's identity (device + inode / file index): if
the path is later a link, junction, file or different directory, nothing is
reserved or deleted through it. A temporary-storage failure — the area cannot
reserve a file (replaced, or removed with its parent) or the writer fails
(disk full, permissions) — answers the upload **immediately** with `503
SERVICE_UNAVAILABLE` and `Connection: close`, removes the file where possible,
and logs a fixed reason (`UPLOAD_TEMP_RESERVE_FAILED` /
`UPLOAD_TEMP_WRITE_FAILED`). A file that cannot be removed is logged as
`upload_temp_cleanup_incomplete` with an errno code only (never a path) and
retried at shutdown. (Review r1 finding 3: r1 waited for the parser's
`finish`, which a failed write prevents, so the request hung.)

### Closing a connection whose upload was not read (r3)

A `413` or `503` sent before the request body was read carries `Connection:
close`, and nothing that follows on that connection is processed as another
request: Node's parser still dispatches a request pipelined behind the
refused body, so the HTTP server's request listener
(`serveUnlessConnectionClosing`, around the app in `src/server.js`) keeps it
out of the app, never answers it, and drains its body like the rest; the
close then waits for the client's own close (or a bound). The Express
middleware order is unchanged. Not covered, as in r2 (ordinary Node
pipelining): a request dispatched before the refused request's error has
been handled.
The close is done in stages, as RFC 9112 section 9.6 prescribes
(`src/lib/http/stagedClose.js`): the response, then a half-close (FIN), then
the rest of *that* request is read and discarded, then the socket closes —
when the body is complete, when the client closes its side, or at the latest
after 8 MiB more, 2 s without data, or 5 s in all. Closing a socket with
unread data makes the TCP stack send a reset, and a reset can erase a
response the client has not read yet: r2 closed at once, Linux's
`TCPAbortOnClose` counter rose once per such response, and the Windows run of
r2 never received the 503s. `tests/upload-temp-failure.test.js` and
`tests/staged-close.test.js` check, on every OS, that the server has read
every byte the client sent before it closes.

To see what a client receives in these cases on any machine (synthetic data;
prints no paths): `node tests/diagnostics/upload-early-response.mjs`.

### Multipart parser selection

`@fastify/busboy` **3.2.2** (added 2026-09-28; Node 24 compatible, zero
dependencies, maintained by the Fastify team; 3.2.2 is the current security
release, fixing CRLF header injection — CVE-2026-74866 — and 3.2.1 the
prototype-name crash and boundary CPU loop). The original `busboy` (used by
multer) has had no release since 2022. DOCX inspection needs no dependency:
Node's `zlib` (`inflateRaw` with `maxOutputLength`, `crc32`).

## Application submission (B5)

| Piece | Where |
| --- | --- |
| Route, Apply rate limit | `src/modules/applications/application.routes.js`, `src/middleware/rateLimit.js` |
| HTTP: key header, bounded parse, temp-file release, response | `src/modules/applications/application.controller.js` |
| Field, answer and key rules; the replay fingerprint | `src/modules/applications/application.validation.js` |
| The workflow | `src/modules/applications/application.submission.js` |
| Bounded, classified persistence (validated B2 saves) | `src/modules/applications/application.repository.js` |
| Job reads for Apply (same visibility rule) | `src/modules/jobs/job.repository.js` |
| Notification boundary (B6: see "Notifications (B6)") | `src/integrations/notifications/notificationService.js`, `src/modules/applications/application.notifications.js` |

### The sequence

1. candidate fields and the shape of `screeningAnswers` — `422`;
2. **an Application already created with this key?** the file must still pass
   the B4 validator, and the record must be confirmed by a read with read
   concern `majority` (otherwise `503`, nothing stored); then same
   fingerprint -> the original result, `200 replayed`; different -> `409`;
3. the Job by slug and its effective state at the server clock — `404` / `409`;
4. phone, message and answers against the Job's current configuration — `422`;
5. the resume (B4) — `415` / `413` / `422`;
6. the unique Application indexes are present (fail closed) — `503`;
7. the resume is stored privately (B4) — `503` on failure;
8. **the Job's state is read again**, then the server clock is read: the
   state is evaluated at that fresh instant, which becomes `submittedAt` — if
   the Job has closed (also exactly at `closesAt`), the stored object is
   removed and the answer is `409`;
9. the Application is inserted through the validated B2 save, under the
   write-durability policy (below);
10. the notification step — B6: claim, send, record (bounded; never affects acceptance);
11. `201`.

Step 2 comes before the Job checks deliberately: Doc 09 section 121 requires a
retry after a lost response to return the original success even when the Job
has closed since. For a key with no Application the order is exactly Doc 09
section 109. Step 8 makes the closing-time race (Doc 09 section 115) exact:
the eligibility state is evaluated at a server time taken AFTER the read (r2 —
a time taken before it would be stale by the read's duration), and that same
instant is `submittedAt`; so every Application is recorded with a
`submittedAt` before its Job's `closesAt`. An administrative close that
commits during that read is not seen (there is no cross-collection
transaction); because such a close stamps its `closedAt` before its save
commits, the Application's `submittedAt` can then be later than the Job's
`closedAt` by at most the read's duration plus the close's save time.

### Write durability (r2)

Success requires the Application "persisted successfully" (Doc 09 section
117), so every Application write — the insert and the notification-state
update — is sent with an explicit write concern `{ w: "majority", j: true,
wtimeout: MONGODB_QUERY_TIMEOUT_MS }` (`APPLICATION_WRITE_CONCERN`,
`application.repository.js`): acknowledged by a majority (on a single server,
that server) and journaled. It is set on the operation, which the driver
uses INSTEAD of the connection default, so an unsafe `MONGODB_URI` (`w=0`,
`journal=false`) cannot weaken it (`tests/db/b5-apply.test.js` connects with
`w=0` and observes the insert command). The acknowledgement is verified, not
assumed: an insert counts as created only when the driver's result says
`acknowledged: true`; anything else is an unknown outcome (`UNACKNOWLEDGED`)
— the write may still land — and a `wtimeout` is a write-concern error, also
unknown. Neither is ever treated as "not persisted".

- On a **single server** (the local Windows development and verification
  target) "majority" is that server, so majority reads are ordinary reads; the
  failover protection is real on a **replica set** (production topology is
  C6). The journal requirement (`j: true`) applies on both.
- On a host **without journaling** (an in-memory storage engine, or an old
  server started with `--nojournal`) the server refuses `j: true`: every
  Apply is then answered `503` and its resume kept — fail closed.
- If the URI sets `timeoutMS` (client-side operation timeouts), the driver
  drops `wtimeout` and that timeout bounds the write instead.
- The policy protects Application writes. A `w=0` `MONGODB_URI` is not
  refused at startup, so other writes (B3 Job provisioning) would follow it.

### Idempotency

The key itself is never stored or logged: the record keeps
`sha256("idempotency:" + key)` and a fingerprint hash of the canonical
submission (Job, normalised name and email, enabled fields, normalised answers,
resume SHA-256 — Doc 10 section 114). Same key + same fingerprint = replay
(nothing stored, nothing notified); different fingerprint = `409`. Concurrent
requests with one key all reach MongoDB, the **unique index** admits one, and
each loser removes its own stored object and answers with the winner's result
— once that result is majority-confirmed (on a replica set a loser that
arrives before the winner's write is majority-committed gets `503` and replays
on retry; on a single server it replays at once).
A different key with the same email is a new Application (Doc 09 section 81).

A replay — and a `409` for a conflicting reuse — is answered only from a
record confirmed by a read with read concern `majority` (r2): in the early
lookup and on every race path that answers with the winner. A record visible to
an ordinary read but not (yet) majority-confirmed is answered `503`
(`application_replay_unconfirmed`), with nothing stored for the request; the
same key replays once the record is confirmed.

### Failures — what happens to the stored object

An object is deleted only on **proof** that no Application references it.

| Insert outcome | Object | Answer |
| --- | --- | --- |
| persisted | kept (referenced) | `201` |
| refused by the key-hash unique index | the key's Application is read FIRST: another object -> ours removed (the server refused it), the winner replayed once majority-confirmed (else `503`); ours (a retried insert whose first attempt was applied), confirmed by a `majority` read -> `201`; unreadable or unconfirmed -> **kept**, `application_persistence_ambiguous` | replay / `409` / `201` / `503` |
| **proven** not persisted — the connection was down so nothing was sent, or the error carries the server's `NoWritesPerformed` label | removed — if removal fails it stays private and `resume_compensation ORPHANED` names its object reference | `503` |
| **unknown** — timeout, network failure, write-concern error (incl. `wtimeout`), an **unacknowledged** result, **any other server error, a failed server selection**, or an unrecognised error | read back by key hash with read concern `majority`: ours found -> `201`; another found -> removed + replay; otherwise **kept** — it may belong to a persisted Application — and `application_persistence_ambiguous` names its object reference; a timed-out insert is followed to its end and its real outcome logged (removed only if then proven not persisted, or if another Application is read back for its key) | `503` — neither success nor failure is claimed |
| refused by a unique index the server did not name | removed only if an Application with this key exists with another object and nothing references ours; otherwise kept | replay / `409` / `503` |
| refused before sending (schema validation — a defect) | removed | `500` |

Why a server error or a failed server selection is "unknown": with retryable
writes (the default on a replica set) the driver retries a failed insert once
and, if the retry fails too, reports the retry's error — while the first
attempt may already have been applied.

A client that retries after a `503` with the same key either gets the replay
(the record existed after all) or creates the Application then; an unknown
outcome's object that no record references is an orphan for the conservative
reconciliation of Doc 10 sections 207-209 (the command is deferred, see Scope).
The follow-up of a timed-out insert lives in process memory: it is not awaited
at shutdown, and one still pending when the process stops is dropped — safely,
since its object is then kept and already named.

### Logs and reconciliation (B5)

A storage key is private: it is never in a response (Doc 09 section 22; Doc 13
sections 237 and 279), "not public metadata" (SEC-026), not "exposed in
ordinary application data" (Doc 13 section 81), and not among the fields Doc 09
section 150 lists for Application logs. **No log carries a storage key, a key segment or a storage
path.** Where an event must point at ONE object — `resume_compensation
ORPHANED`, `private_storage_cleanup_incomplete`,
`application_persistence_ambiguous`, `application_storage_key_conflict`,
`application_persistence_resolved` (`UNKNOWN`) — it carries `objectRef`: the
first 128 bits of SHA-256 over the domain-separated key — exactly
`sha256("valida:storage-object-ref:v1:" + storageKey)` as lowercase hex, first
32 characters (`storageObjectRef()`, `src/integrations/storage/storageContract.js`).
It is one-way (the key has 256 random bits) and grants nothing. On the local
adapter a failed write can leave `<key>.partial-<random>`; its key is the name
without that suffix.

Reconciliation (Doc 10 sections 207-209; Doc 15 sections 200-204; the
`ops:storage:reconcile` command is deferred to B7/C6) needs no log to work: it
lists private storage, looks each key up in `Application.resume.storageKey`,
and treats an unreferenced object older than the safety window as a possible
orphan — dry-run by default, deletion only on an explicit operator action. The
log's `objectRef` lets an operator connect an incident (request id, reason) to
the one object concerned: reconciliation computes `storageObjectRef()` for each
key it lists. Until that command exists (B7/C6), an operator with access to the
private store computes the same value for the keys listed there. The key itself stays only where it is already protected — in
private storage and in MongoDB (`tests/db/b5-apply.test.js` performs exactly
this resolution against the real database).

This changes two approved B4 log events (`resume_compensation ORPHANED`,
`private_storage_cleanup_incomplete`), which logged the key: B5 is the first
public path that can reach them. Their B4 tests now assert the reference is
logged and the key is not.

### Notification boundary

*As approved in B5; B6 replaced this with the claim / send / record cycle
described in "Notifications (B6)". Kept for the record:* after the record
exists — never on a replay — the workflow calls
`notifyApplicationReceived()` with the internal id, the Job title/slug and the
time only (no candidate data, no resume). B5 has **no transport**: the outcome
is `NOT_ATTEMPTED / NOT_CONFIGURED`, and the record keeps
`notifications.internal = PENDING, attemptCount 0`. With a transport (B6;
tests use doubles) a provider acceptance records `SENT` (handed to the
provider — not delivery), a failure records `FAILED` with a fixed code, and a
call that exceeds `NOTIFICATION_TIMEOUT_MS` is aborted and recorded
`FAILED / TIMEOUT`. In every case the Application stays accepted. Readiness
keeps answering `503` until B6.

### Pipelined requests

The B4 server wrapper (`serveUnlessConnectionClosing`, `src/server.js`)
refuses any request that arrives on a connection after a refusal armed its
staged close. A request pipelined so closely that Node dispatches it BEFORE
the refusal is decided is an ordinary pipelined request: measured (Linux),
it is processed and accepted, but its response is not delivered because the
connection closes after the earlier refusal — the lost-response case. Its
retry with the same key replays it: never a duplicate, never an orphan
(`tests/apply-connection.test.js`, `tests/db/b5-apply-server.test.js`).
Browsers do not pipeline.

---

## Notifications (B6)

| Piece | Where |
| --- | --- |
| Events, recipient safeguards, the bound, classification, the transport contract | `src/integrations/notifications/notificationService.js` |
| Templates (backend-controlled) | `src/integrations/notifications/templates.js` |
| Transport selection | `src/integrations/notifications/transport.js` |
| SMTP adapter (r4: Bluehost Professional Email / Titan) | `src/integrations/notifications/smtpTransport.js` |
| Claim / send / record, retry policy, retry run | `src/modules/applications/application.notifications.js` |
| Conditional notification-state writes, retry scan, state summary | `src/modules/applications/application.repository.js` |
| Operator retry command | `scripts/notifications-retry.mjs` (`npm run ops:notifications:retry`) |
| Opt-in LIVE smoke test (owner-run) | `scripts/notifications-smoke.mjs` (`npm run ops:notifications:smoke`); its message budget `scripts/smoke-ledger.mjs`; r5: its lifecycle — truthful result, run-scoped cleanup, bounce classification — `scripts/smoke-lifecycle.mjs`; r6: cleanup only after the run's ownership (record + database target + marker) is proven |
| Configuration rules | `src/config/env.js` (`checkNotificationSettings`) |

**Startup (r2).** The transport is created after storage, the upload area and
the database connection are open, inside the startup cleanup protection: if
creating it (or building the app) fails, every registered dependency is
closed once, within the same cleanup deadline, and the original error is
reported (its message withheld).

**Provider (r4).** The owner selected Bluehost Professional Email Plus,
powered by Titan, for business email and for B6 sending. Its only
programmatic interface is authenticated SMTP submission, so
`TRANSACTIONAL_EMAIL_PROVIDER=smtp` selects the SMTP adapter (below);
`none` (the default) still means no transport: nothing is sent or claimed
sent. The adapter is tested against a **local SMTP test server**
(`smtp-server`, localhost, an in-memory test certificate) — protocol
evidence only, never evidence about Titan, delivery or DNS. Titan evidence
comes only from the owner's opt-in live test ("B6 live Titan test" below).

### SMTP adapter (r4)

| Aspect | Behaviour |
| --- | --- |
| Library | nodemailer 10.1.4 (exact pin — r7: from 10.1.2, for three addressparser advisories; MIT-0, no dependencies, npm provenance): its SMTP client (`SMTPConnection`) and MIME composer (`MailComposer`). No SMTP or TLS code of our own. See "What the adapter relies on in nodemailer" below. |
| Encryption | `SMTP_SECURITY=implicit-tls` (default, port 465 — Titan's documented setting) or `starttls` (587) with STARTTLS **required**. TLS 1.2+, certificate chain **and** host name verified. No plaintext mode, no opportunistic fallback, no login before encryption. A host must be a DNS name, never an IP. |
| Identity | From = `SMTP_USERNAME` (the authenticated mailbox) — enforced by configuration and again per message; envelope sender the same mailbox. Reply-To `TRANSACTIONAL_REPLY_TO`. One recipient per message. |
| Headers | `Message-ID: <sha256("<event>/<applicationId>")[0..32].b6@<sender domain>>` — the same for every attempt of one logical message: a correlation aid (search a mailbox for it), **not** exactly-once. `Auto-Submitted: auto-generated` (RFC 3834). No `X-Mailer`, no tracking, no attachments — the one exception (B6 Stage 2, OD-2026-10-27-01) is the approved logo as a single inline CID part, added only when the HTML references it (see "Logo" below). Where the server offers DSN: failure/delay reports with headers only (`RET=HDRS`) and `ENVID` = the same token. |
| What `SENT` means | the relay answered **250** to the end of the message: it **accepted** it. Not delivery — a later bounce goes to the sending mailbox. Nothing from the reply (queue id, text) is kept. |
| Bounded | every network step times out at `NOTIFICATION_TIMEOUT_MS` (with `smtp` at least 10 s); the service aborts the call at that bound and **waits** (≤ 1 s) for it to stop: the socket is destroyed, never abandoned mid-send, and no timer or socket is left behind (a process can exit at once). |
| Outcome by phase | **before the message body** (connect, TLS, greeting, login, MAIL FROM, RCPT TO, DATA): nothing was submitted — a definitive code (table below). **After the body began**: only the server's final reply is definitive (2xx sent, 4xx transient, 5xx rejected); a lost connection, timeout or abort without it is `OUTCOME_UNKNOWN` — never retried automatically. |
| Logins | one SMTP session per message, each with its own login; **logins run one at a time** (r4 review), so sessions opened together never send several AUTH commands at once. |
| Login refused | `PROVIDER_AUTH_FAILED`, and **no further login until restart** (Titan blocks an IP after repeated failures) — not even by sessions already waiting for their turn: one wrong password costs one failed login at the relay. Readiness turns `unavailable` at once. A temporary `454` is transient and does not latch. |
| Startup | `verify()` = connect + TLS + login, then QUIT; **nothing is sent**. `ready` means exactly that — not that a message can be relayed or delivered. The startup check runs before the server listens (at most the timeout + 1 s). |
| Readiness re-check (r4 review) | if the startup check failed for a **transient** reason (unreachable, timeout, `4xx`, an unexpected error), the server re-checks in the background — after 30 s, 1, 2, 5, 10 and then every 15 min — and turns `ready` when a check succeeds (each check is one login; nothing is sent). A refused login (latched), `TLS_FAILED` or `SENDER_NOT_VERIFIED` is never re-checked: it needs the operator and a restart. |
| Diagnostics | logged with each failure: `phase`, numeric `replyCode`, `enhancedStatus` (e.g. `5.7.8`), a constant `errorCode` (e.g. `ECONNREFUSED`, `CERT_HAS_EXPIRED`). Never the reply text (it can name recipients), the password, an address or content. Not stored. |

| SMTP situation | Stored code | Class |
| --- | --- | --- |
| before the body: connection refused / reset / unreachable, DNS failure, a local socket error (e.g. `EACCES`), a timeout or abort, a refusing greeting, a connection closed during the TLS upgrade; `421`; any `4xx` — including STARTTLS `454`, login `454` and the `DATA` command `4xx` | `PROVIDER_UNAVAILABLE` | transient |
| a certificate that fails verification (chain, host name, expiry — Node's TLS error codes), TLS older than 1.2, STARTTLS refused with `5xx` or not supported, a connection that is not encrypted | `TLS_FAILED` (new in r4) | configuration |
| login `5xx` (e.g. `535 5.7.8`), or no usable AUTH | `PROVIDER_AUTH_FAILED` | configuration |
| `MAIL FROM` `5xx` (sender not permitted — or a sending policy such as a quota) | `SENDER_NOT_VERIFIED` | configuration |
| `RCPT TO` `5xx` (`5.1.x` and others) / `5.7.x` policy | `INVALID_RECIPIENT` / `PROVIDER_REJECTED` | permanent |
| the `DATA` command refused `5xx` (before the body), message over `SIZE`, final reply `5xx` | `PROVIDER_REJECTED` | permanent |
| final reply `4xx` (after the body) | `PROVIDER_UNAVAILABLE` | transient |
| no final reply after the body (drop, timeout, abort) | `OUTCOME_UNKNOWN` | uncertain |
| our own defect, found before the relay sees a message: a message the adapter cannot shape or compose, nodemailer's own envelope check | `PROVIDER_ERROR` | uncertain (an operator looks first) |

**Internal-channel relay refusals (r4 review R3 — a decision for review).**
A permanent refusal of the *internal* notification (`INVALID_RECIPIENT` /
`PROVIDER_REJECTED`, e.g. the `hr@` mailbox mistyped or a relay policy) is
classified like any permanent refusal: never retried, not even with an
operator flag, although its cause is our own configuration. This is the
approved B5/B6 behaviour (and its tests); changing it is proposed, not done —
see the B6 r4 review.

**What the adapter relies on in nodemailer (r4 review).** Two documented
nodemailer modules, imported by their documented paths, which nodemailer's
`package.json` `exports` map lists: `nodemailer/lib/smtp-connection`
([SMTP Connection](https://nodemailer.com/extras/smtp-connection)) and
`nodemailer/lib/mail-composer`
([MailComposer](https://nodemailer.com/extras/mailcomposer)). The adapter uses
their documented options, methods, events and the documented `secure`
property, and the documented error fields `code`, `responseCode`, `command`,
`response`, `originalCode` ([Errors](https://nodemailer.com/errors)). Those
pages give no stability guarantee for error fields, and that the message
stream is read only after the server's answer to `DATA` is observed behaviour,
not documented — so `tests/b6-nodemailer-contract.test.js` pins every one of
these behaviours on the wire against the exact pinned version (sequential and
PIPELINING dialogues, a scripted local server): an upgrade that changes any of
them fails that file before it can change a classification. No other
nodemailer path is imported (the same test checks the source). The test
fixtures (not the application) use internals of the `smtp-server` dev
dependency to drop a connection; that is test-only.

**Provider limits (documented by Titan / Bluehost, Plus plan, per mailbox):**
300 external messages / hour and 1,000 / day; more within the domain; lower
for new domains; over the limit, mail is not sent or bounces. Each Application
sends at most 2 messages. Bounces arrive as messages in the sending mailbox —
there is no webhook or delivery API, so the backend cannot record `DELIVERED`
or `BOUNCED`; monitoring is manual (live-test step 7). Whether Titan keeps a
Sent copy of SMTP-submitted mail is **not documented**; Titan's own script
samples append a copy by IMAP, which suggests it does not (live-test step 8).

### Events and messages

| Event | Channel (`notifications.*`) | When | To | Content |
| --- | --- | --- | --- | --- |
| `APPLICATION_RECEIVED_INTERNAL` | `internal` | every accepted Application | `RECRUITMENT_NOTIFICATION_RECIPIENT` | Job title and slug, submission time (UTC), internal Application reference — **no candidate name, email, phone, message, answers, filename, resume or link** |
| `APPLICATION_ACKNOWLEDGEMENT` | `candidateAcknowledgement` | only while `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` with a provider (otherwise the channel is created `NOT_REQUIRED`) | the candidate's address, Reply-To `TRANSACTIONAL_REPLY_TO` | receipt only — the approved email copy (OD-2026-10-26-02; an email variant of Doc 06 §§148–150); no interview, selection or timing promise |

**Template version `b6-3` — Concept A, Graphite Letter (B6 Stage 2,
OD-2026-10-26-03; C2 masthead and P-04 colours, OD-2026-11-02-01).** The
subjects, preheaders, labels and wording are the copy the owner approved
(OD-2026-10-26-02), less the header label `CAREERS` (OD-2026-11-02-01):

| | Candidate acknowledgement | Internal notification |
| --- | --- | --- |
| Subject | `Application received — {job.title} \| Valida` | `New application — {job.title} \| Valida` |
| Preheader | `Thank you for applying. Your application has been received.` | `A new application is recorded in Valida. Candidate details remain private.` |
| Body | Thank you for applying. / We’ve received your application for {job.title}. / If we need more information or decide to move forward, we’ll contact you using the details in your application. / Valida Careers | A new application has arrived. / The application is recorded in Valida. / Role, Role identifier, Received (UTC), Application reference / the privacy note / Valida · Recruitment operations |

Every message has a plain-text part and an HTML part with the same
information (the eyebrow is presentational).
Dynamic values are made well-formed, reduced to one line without control or
bidirectional-formatting characters, and HTML-escaped. In a subject only the
job-title segment is limited: at most **120 grapheme clusters, the ellipsis
`…` included**; the prefix and the ` | Valida` suffix are never shortened, and
no accent or emoji is ever split. The time is absolute UTC,
`Received (UTC): YYYY-MM-DD HH:MM:SS`, whatever the process time zone. The HTML
uses presentation tables, inline styles, explicit colours and a media query
for narrow screens; it has no links, scripts, remote resources, web fonts or
tracking, and open and click tracking are requested off. The service message
has no attachment field.

**Masthead (b6-3, OD-2026-11-02-01).** The header is ONE inline CID related
part (`src/integrations/notifications/emailLogo.js`): the approved C2 masthead
image (the official transparent lockup on the canvas colour, 1200 × 216),
shown at 600 × 108 and narrowing with the column on small screens, alt text
`Valida`; its bytes are pinned by SHA-256 (`assets/SHA256SUMS.txt`) — a
mismatched asset fails composition and is never replaced. File name and
Content-ID are constants (unchanged from b6-2); nothing is fetched from
anywhere. Only an HTML part that references the image gets it; nothing else is
ever attached. b6-3 also removed the header label `CAREERS` and set metadata
labels and footers to `#B6C0CC` and the eyebrow to `#83C6FF`. (b6-2 used the
dark 316 × 72 logo approved in OD-2026-10-27-01; its bytes are kept in
`docs/qa/b6-stage2/logo/`.)

Tests: `tests/b6-stage2-templates.test.js` (T-01…T-13; part of `verify:b6`).
Review fixtures and browser previews (not email-client evidence):
`docs/qa/b6-3/` (b6-3) and `docs/qa/b6-stage2/` (b6-2, historical).

### One cycle for every attempt

The first attempt (right after the Application is durably accepted, never on
a replay) and every retry run the same cycle:

1. **Claim** — a validated document save, *conditional* on the channel state
   that was read (`doc.$where`): `PENDING`, `attemptCount + 1`,
   `lastAttemptAt`, `lastErrorCode = ATTEMPT_IN_PROGRESS`. If the stored
   state changed (another process claimed it), the save matches nothing:
   `LOST`, nothing is sent. If the claim's outcome is unknown, nothing is sent.
2. **Send** — every claimed channel in parallel, each bounded by
   `NOTIFICATION_TIMEOUT_MS`: aborted at the bound, and (r4) awaited until the
   transport has stopped — at most 1 s more — so what it established is
   recorded (a transport that does not stop is recorded `TIMEOUT`, uncertain).
3. **Record** — only by the claimant that **acquired** the attempt (r3),
   conditional on that attempt still being in progress: `SENT` (the provider
   *accepted* it — not delivery) with `sentAt`, or `FAILED` with a fixed code.
   If recording fails, the claim stays `ATTEMPT_IN_PROGRESS`, which reads as
   *uncertain* and is never re-sent automatically.

**Claim ownership (r3).** The authoritative Windows / MongoDB 8.0.9 run of r2
found that a claimant that LOST the race could still record an outcome: its
claim had already advanced its local copy to the attempt it tried to take,
and that attempt number matched the winner's stored state. Now the repository
keeps, privately and per repository instance, a record of the attempts it
**acquired** — created only after a claim's conditional save was acknowledged
and matched, naming the exact channels, attempt numbers and claim time.
Recording requires that record for exactly those channels; anything else (a
lost, failed or unconfirmed claim, another channel, a claim already used) is
answered `LOST` with **nothing written**. The record write targets the
acquired attempt (not whatever the copy holds) and stays conditional, so an
old claimant can never overwrite a newer attempt. A document is used for one
claim only: after any claim through it, its copy may no longer match what was
read, so a second claim through it is `LOST` without a write (load a fresh
document). Across processes nothing more is needed: MongoDB lets only one
conditional claim of an attempt match, so only one process can hold it. No
timestamps are relied on; no schema change.

Both writes go through the validated save (B2 history protection and schema
limits apply) under the Application write-durability policy, and touch only
the notification paths. MongoDB applies a single-document update with a
filter atomically, so of two concurrent claims exactly one matches ("update
if current", MongoDB Manual — Atomicity and Transactions); this is proven
against the database by `tests/db/b6-notifications.test.js`, which first
probes the engine itself with the raw driver. A MongoDB-compatible stand-in
may not provide it: measured here, FerretDB 1.24 (SQLite backend) applied
BOTH of two concurrent conditional updates in 19 of 20 rounds — it is not
MongoDB evidence.

`attemptCount` counts **claimed** attempts. That includes an attempt refused
before the provider is called (an unusable recipient, a template defect) and
a claim that was applied although its acknowledgement was lost (a timeout):
that one is stored `ATTEMPT_IN_PROGRESS` with nothing sent and, once stale,
reads as uncertain — so it is retried only with `--include-uncertain`. The
channels claimed together are recorded together: if an operator re-claims
one of them while the original attempt's record is still pending (possible
only with `--include-uncertain`, after the stale threshold), that record is
LOST for both and the other channel stays uncertain.

### Failure classes and retries

| Class | Codes | Retried by `ops:notifications:retry` |
| --- | --- | --- |
| transient | `PROVIDER_UNAVAILABLE`, `RATE_LIMITED` | yes — after `NOTIFICATION_RETRY_BASE_DELAY_MS × 2^(attempts−1)` (max 6 h), up to `NOTIFICATION_RETRY_MAX_ATTEMPTS` |
| permanent | `INVALID_RECIPIENT`, `SUPPRESSED`, `PROVIDER_REJECTED`, `RECIPIENT_NOT_ALLOWED` | never |
| configuration | `PROVIDER_AUTH_FAILED`, `SENDER_NOT_VERIFIED`, `TLS_FAILED` (r4), `TEMPLATE_ERROR`, `SENDER_NOT_CONFIGURED`, `RECIPIENT_NOT_CONFIGURED` (the internal recipient missing, malformed or not allowlisted) | only with `--include-configuration` (after fixing it) |
| uncertain | `TIMEOUT`, `OUTCOME_UNKNOWN`, `PROVIDER_ERROR`, `INTERNAL_ERROR`, a stale `ATTEMPT_IN_PROGRESS`, and any unrecognised or missing code | only with `--include-uncertain` — the provider may already have accepted it, so a retry can duplicate the email |

Raw provider errors, status codes and bodies are never stored or logged —
only the fixed code. A candidate address is handed to the provider only if it
is one plain ASCII mailbox (stricter than the Apply validator: no display
name, list, quote, angle bracket, whitespace or control character, and no
internationalised local part or domain — whether those can be sent depends on
the provider, AWAITING INPUT); otherwise the acknowledgement is
`INVALID_RECIPIENT`. The Application itself is unaffected. An acknowledgement is retried only
while acknowledgements are enabled; an Application accepted while they were
disabled never gets one later.

The scan selects only channels that are **due now** (the same rule as the
per-channel decision, expressed as a MongoDB filter), oldest first, so rows
waiting out a backoff or never retried cannot fill `--limit` and hide due
ones. The state summary shows every channel's status and code, and how many
reached the attempt limit. States this code never writes but the schema
allows — an unrecognised (legacy) code, including one named like a built-in
JavaScript property, `FAILED` without a code, a `PENDING` channel attempted
without the in-progress marker — are classified *uncertain*, like any
unknown outcome: never retried automatically, selected only with
`--include-uncertain`. States outside the schema (reachable only by a raw
write: no channel state, an unknown status, a negative or fractional attempt
count, a non-date time where the time decides) are `UNSUPPORTED`: never
selected, never sent, reported for inspection. r2: the scan filter and the
per-channel decision are checked against each other over every combination
of status, attempt count, code, attempt time and submission time used in the
offline property test (> 200,000 cases, including those outside the schema),
and three of the unwritten states against the database. Not modelled:
array-valued or Decimal128 fields (raw writes only) — the scan may select
such a row, but it is never found due, so nothing is sent; it only takes a
`--limit` slot.

```powershell
npm run ops:notifications:retry                     # dry run: state counts and what is due; writes and sends nothing
npm run ops:notifications:retry -- --limit 100      # scan more (1-500, default 50), oldest first
npm run ops:notifications:retry -- --send           # attempt what is due (needs TRANSACTIONAL_EMAIL_PROVIDER=smtp; verifies the relay first)
```

There is no queue or scheduler (Doc 14 section 121 does not require one); the
command is run by an operator, or later by a scheduled job (deployment, C6).
It prints internal ids, channel names, counts and fixed codes only. Exit `0`
completed; `1` refused, failed, or an attempt that could not be claimed,
loaded or recorded; `2` usage error.

### Logs

`notification_attempted` (channel, event, attempt number, outcome, fixed code
and class, r4: the value-free `diagnostic` tokens, the adapter's fixed
provider token), `notification_claim_lost`, `notification_claim_failed`,
`notification_state_unrecorded`, `notification_not_attempted`, r4:
`notification_authentication_rejected` — with the request id and internal
Application id. Never an address, candidate data, a subject or body, a
provider response, the API key, the SMTP password, the Idempotency-Key or a
storage key.

**No provider-returned identifier is kept or logged (r2).** Whatever a
provider returns for an accepted message — a message id or a response body —
is discarded by the Notification Service: a provider chooses that value, and
no format check can establish that it contains no personal data (an
address-shaped id passes any "token" pattern; hashing it would still be
personal data, only pseudonymised). Correlation uses Valida's identifiers —
request id, internal Application id, channel/event and attempt number. With
SMTP (r4) the Message-ID is Valida's own, derived from the event and the
internal Application id (a one-way hash — the id itself is not shown to a
candidate), so a message can be found in a mailbox without logging anything
the provider chose.

### B6 live Titan test (owner-run, opt-in)

**This sends REAL email.** Only the owner runs it, on their own Windows
machine, with synthetic data, against the dedicated test database. Nothing in
`npm test`, `npm run test:db` or `npm run verify:b6` sends email or uses the
owner's credentials.

**Before you start (in Bluehost / Titan, for `notifications@cybervalida.com`):**
2FA on and an app password created (done); **"Enable Titan on other apps" /
third-party access ON** (check it). Recommended (Doc 14 section 185): create a
*separate* app password just for this local test and revoke it afterwards;
production gets its own. Local MongoDB running, as for `verify:b6`. One
external test inbox you control (e.g. your Gmail).

**0 — configure `backend/.env` (git-ignored; never commit, paste or screenshot it):**

```powershell
cd C:\path\to\valida\backend
git check-ignore .env        # must print ".env" — if it prints nothing, STOP
notepad .env
```

Add these lines — the app password goes **only into this file**:

```text
TRANSACTIONAL_EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.titan.email
SMTP_SECURITY=implicit-tls
SMTP_PORT=465
SMTP_USERNAME=notifications@cybervalida.com
SMTP_PASSWORD=<the app password>
TRANSACTIONAL_FROM_ADDRESS=notifications@cybervalida.com
TRANSACTIONAL_FROM_NAME=Valida Careers
TRANSACTIONAL_REPLY_TO=careers@cybervalida.com
RECRUITMENT_NOTIFICATION_RECIPIENT=hr@cybervalida.com
EMAIL_RECIPIENT_ALLOWLIST=@cybervalida.com,<your-test-inbox>,@bounce-test.invalid
NOTIFICATION_TIMEOUT_MS=10000
```

While these lines are in `.env`, `npm start` / `npm run dev` **also send real
email** for every Application (to allowlisted recipients only). Step 6 removes
them.

**1 — authentication only (sends nothing, uses no database):**

```powershell
npm run ops:notifications:smoke -- --verify-only
echo "exit=$LASTEXITCODE"
```

Expected: `verify (connect + TLS + login, nothing sent): OK`, exit `0`. This
is *authentication* evidence only. If it fails:
`PROVIDER_AUTH_FAILED` — do **not** repeat (Titan blocks an IP after repeated
failures); check the username (full address), the app password and third-party
access. `TLS_FAILED` — stop and report it; do not work around it.
`PROVIDER_UNAVAILABLE` with `ECONNREFUSED` / `ETIMEDOUT` — your network may
block port 465: try `SMTP_SECURITY=starttls` and `SMTP_PORT=587`.

**2 — the plan (sends nothing, but LOGS IN once):**

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run ops:notifications:smoke -- --candidate-recipient <your-test-inbox> --bounce-recipient qa-bounce@bounce-test.invalid
```

This step verifies the relay first (connect + TLS + **login**, as in step 1),
so a wrong password here is a failed login at Titan too — run it only after
step 1 passed. Exit `2` and the plan: 2 internal notifications to `hr@`, 1
acknowledgement to your inbox, 1 acknowledgement to the bounce address
(`.invalid` can never receive mail — RFC 6761 — so no third party is
contacted), and the **hard limit**: at most 4 messages (2 without the bounce
test). The live run refuses any submission beyond that limit before it reaches
the relay and reports FAIL.

**3 — the live run:**

```powershell
npm run ops:notifications:smoke -- --candidate-recipient <your-test-inbox> --bounce-recipient qa-bounce@bounce-test.invalid --confirm-live-email --evidence "$env:TEMP\valida-b6-live-smoke.json"
echo "exit=$LASTEXITCODE"
```

It verifies the relay (a login), starts the real server against `valida_test`
— **listening on `127.0.0.1` only** (r5; checked from the server's actual
address) — (its startup check is another login; each message is its own SMTP
session with its own login — about 6 successful logins in all, one at a time),
prints its **run id**, creates one synthetic job `QA SMOKE TEST ROLE - NOT A
REAL VACANCY <run id>` (the real vacancy stays DRAFT and is not touched),
checks `/health/ready`, submits one synthetic Application through the real
Apply API, **replays it** (nothing more may be sent), submits the bounce
test, runs the retry policy as a **dry run only** (never `--send`), shuts
down, and then cleans up (below). Expected: every line `PASS` — including the
LIFECYCLE lines — `AUTOMATED RESULT: PASS`, exit `0`, and the list of
submitted Message-IDs.

**PASS means every required step was confirmed (r5).** The result is `FAIL`
(exit `1`) when any check fails, the server's shutdown is not clean (or
throws), the record cleanup fails, is refused or cannot be confirmed, or the
resume files cannot be removed; each failure is listed under the result and
recorded in the evidence (`lifecycle.failures`), beside — never instead of — an
earlier failure of the run (`error`). A thrown shutdown never stops the later
steps or the evidence file. `PASS` is the **automated part only** (r6: the
script prints this under the result line, and the evidence says so in
`automatedResultScope`): it is **not** mailbox delivery, bounce verification or
B6 acceptance — those are the manual checks below and the review.

**Ownership (r6).** Before the run touches the database it writes an
**ownership record** — `$env:TEMP\valida-smoke-run-<run id>.json` — that holds
no credential: the run id, the test database's **name and servers** (`host:port`
as parsed from `MONGODB_TEST_URI`; never a user name or password), a random
nonce, the Job id chosen in advance, the Application ids as they are captured,
and the name of the run's one resume-file directory. It then inserts a
**marker** `{ _id: <run id>, nonce, jobId, storageDirectory }` into the collection
`valida_smoke_runs` of the **test** database, before it creates the job (one
small document per run, released by a successful cleanup; the application
database is never touched).

**Cleanup (r6).** After shutdown — and in `--cleanup-run` — **nothing is
deleted until the run's ownership is proven**: the record is intact and
consistent, it names the **same database name and servers** the command is now
pointed at (the same name on another server is a different database), and that
database holds the run's marker with the **same nonce, Job id and storage
directory**. Only then
are the run's records found — the job by its recorded id, slug and synthetic
title; the Applications by the **recorded Job id** and the synthetic candidate
name, so they are found when the job itself is gone and when the run never
captured their ids — removed, and **re-counted**: the evidence shows the
database's own deletion counts and what remains, never the intended counts.
Only when nothing of the run remains is its resume-file directory — the one the
record names, `valida-smoke-storage-<run id>-…`, no other — removed; then
(r7) the record is marked `RELEASING` — durable evidence that the records and
files were confirmed removed — and only then is the marker released and the
record marked `CLEANED` (it is kept as the receipt). If the release or the
receipt is interrupted, `--cleanup-run` finishes it from the `RELEASING`
record; an `ACTIVE` record whose marker is gone is still refused (an absent
marker alone never proves a cleanup). If ownership cannot be proven, or the record cleanup failed or could
not be confirmed, the files are **kept** with the records that may still
reference them, and the script says so. (r5 treated "no job found" as "nothing
remains": pointed at another test database, or after the job was deleted, it
reported success and removed the files of records that still existed.)

**The bounce exercise (r5)** is reported as what was *established* — from the
recorded channel state and whether / how the relay answered:

| Reported | Meaning | Bounce |
| --- | --- | --- |
| `ACCEPTED_BY_RELAY` | the relay answered 250 | should arrive — check it (step 4.6) |
| `REJECTED_BY_RELAY` | the relay answered 5xx during submission | none from this attempt; bounce path not exercised |
| `DEFERRED_BY_RELAY` | the relay answered 4xx; never retried by the run | none from this attempt; not exercised |
| `CONFIGURATION_FAILURE` | authentication, TLS, sender or configuration failure | none; not exercised — investigate |
| `NOT_SUBMITTED` | refused or failed before anything was submitted | none; not exercised |
| `UNKNOWN` | `OUTCOME_UNKNOWN`, `TIMEOUT`, `PROVIDER_ERROR`, an attempt still in progress, or evidence that does not agree | **may** arrive — record whether it did; the exercise is **INCONCLUSIVE**; never retried automatically |

Only `ACCEPTED_BY_RELAY` followed by a received bounce verifies the bounce
path; anything else is reported as not exercised or inconclusive.

**Keeping the records (`--keep-records`, r5).** The run's records **and**
their resume files are kept together, with an active ownership record and
marker. Remove them later — and reconcile any run whose cleanup was not
confirmed — with:

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"   # the SAME database and server the run used
npm run ops:notifications:smoke -- --cleanup-run <run id>
echo "exit=$LASTEXITCODE"
```

It needs only `MONGODB_TEST_URI` (no relay settings) and sends nothing. It
proves the run's ownership as above, removes only that run's synthetic records,
confirms none remain, and only then removes the one resume-file directory the
record names. It reports one of:

| Printed | Exit | Meaning |
| --- | --- | --- |
| `CLEANUP COMPLETE (confirmed)` | `0` | ownership proven; records removed and confirmed gone; files removed; record `RELEASING`; marker released; record `CLEANED` — or (`…an interrupted release was finished`) a `RELEASING` record completed: only the marker (if still there) was deleted, after a read-only re-count found nothing of the run |
| `ALREADY CLEANED` | `0` | an earlier cleanup of this run completed (its record says so); the database is not used and nothing is changed — running it again is harmless |
| `REFUSED (<code>)` | `1` | ownership **not** proven — **nothing was deleted; every file was kept**: `OWNERSHIP_RECORD_MISSING` (no record — every run made before r6; see below), `OWNERSHIP_RECORD_INVALID` / `OWNERSHIP_RECORD_INCONSISTENT` (damaged, another run's, or contradicting the folder — e.g. it names a directory that is gone while another directory of the run exists), `TARGET_MISMATCH` (pointed at another database name or other servers — set `MONGODB_TEST_URI` to the one the run used), `OWNERSHIP_MARKER_ABSENT` / `OWNERSHIP_MARKER_MISMATCH` (this database does not hold this run's marker) |
| `FAILED` | `1` | the test database could not be used; nothing more was attempted and every file was kept — run it again when it is reachable |
| `INCOMPLETE (<code>)` | `1` | ownership proven, but: `RECORDS_REMAIN` — something linked to the run is **not** positively the run's (reported as `NOT TOUCHED`; it is never deleted) or could not be removed, so the files were **kept**; inspect it — or the records are gone but a later step failed, and running the command again finishes it: `FILES_NOT_REMOVED`; `RECORD_NOT_UPDATED` (the `RELEASING` record could not be written, so the marker was **kept**); `MARKER_NOT_RELEASED` or `RECEIPT_NOT_WRITTEN` (r7: the record says `RELEASING`) |

Other directories named `valida-smoke-storage-<run id>-…` that the record does
not name are reported as `NOT TOUCHED` and left alone.

**An incomplete cleanup that does not finish (r7).** Every `INCOMPLETE` code
above is finished by running `--cleanup-run` again once its cause is gone. If
`RECORD_NOT_UPDATED` or `RECEIPT_NOT_WRITTEN` repeats, the temporary folder
cannot be written (free space, permissions, a lock held by another program):
fix that and run it again — nothing more is deleted. To look before acting:

1. Read the record (it holds no credential):
   `Get-Content "$env:TEMP\valida-smoke-run-<run id>.json"` — note `state`,
   `jobId`, `storageDirectory` and `database.nonce`.
2. `RELEASING`: the run's records and files were confirmed removed before that
   state was written; only the marker (and the receipt) can be left.
   `--cleanup-run` deletes nothing else from this state.
3. `ACTIVE` with `REFUSED (OWNERSHIP_MARKER_ABSENT)` against the right database
   (for example a run that hit this in r6): the script will not assume the
   cleanup happened. In `mongosh`, connected to that database, **look first**:
   `db.applications.countDocuments({ jobId: ObjectId("<jobId>") })`,
   `db.jobs.countDocuments({ _id: ObjectId("<jobId>") })` and
   `db.valida_smoke_runs.find({ _id: "<run id>" })`; and
   `Test-Path "$env:TEMP\<storageDirectory>"`. Only if all of them show nothing
   is the run fully cleaned — then the record file may be deleted by hand.
   Anything that remains is reconciled as for a run without an ownership
   record (below), by exact `_id`.

**Runs without an ownership record (made before r6).** `--cleanup-run`
refuses them (`REFUSED (OWNERSHIP_RECORD_MISSING)`) and deletes nothing: an r5
run recorded only its database **name**, not its servers, so the script cannot
prove which database holds its records, and it does not guess. If you made a
live run with r5 and its records or files remain, reconcile it **by hand**,
deliberately, or leave it (everything in it is synthetic and in the test
database or your temporary folder):

1. Its evidence file (`valida-b6-live-smoke-<run id>.json`) names the database
   (`database`); you must also know which MongoDB server you pointed it at.
2. In `mongosh`, connected to exactly that server and database, **look first**:
   `db.jobs.find({ slug: "qa-smoke-<run id>" }, { _id: 1, title: 1 })`, then
   `db.applications.find({ jobId: ObjectId("<that job's _id>") }, { _id: 1, "candidate.fullName": 1 })`.
   Every Application must show `QA Smoke Candidate (synthetic)` — if one does
   not, stop. If the job is not there, the run's Applications cannot be
   identified from the run's own data: keep the files and raise it in the
   review rather than deleting anything by name.
3. Delete only what you identified, by `_id`
   (`db.applications.deleteOne({ _id: ObjectId("…") })`, then the job), and
   repeat the two queries: both must return nothing.
4. Only then list `Get-ChildItem $env:TEMP -Directory -Filter "valida-smoke-storage-<run id>-*"`
   and remove that run's directory.

**4 — manual checks (the script prints this checklist):**

1. `hr@` received the internal notification(s); your inbox received the
   acknowledgement — note **Inbox or Spam** (Doc 14 section 133).
2. Each message arrived **once**.
3. In Gmail open the acknowledgement → ⋮ → **Show original**: `SPF: PASS`,
   `DKIM: PASS`, `DMARC: PASS`; `From: Valida Careers <notifications@cybervalida.com>`;
   `Reply-To: careers@cybervalida.com`; the Message-ID matches the one printed.
4. **Reply** to the acknowledgement from your inbox: the reply must arrive at
   `careers@` → forwarded to `hr@`.
5. The internal notification contains no candidate name, email or resume.
6. Bounce: only if the bounce exercise is `ACCEPTED_BY_RELAY`, a
   delivery-failure message must arrive in the **`notifications@` Inbox** (it
   can take minutes). That mailbox is the bounce channel — there is no API;
   the backend has recorded `SENT` (accepted), which is exactly why "accepted"
   ≠ "delivered". If it is `UNKNOWN`, record whether a bounce arrived — the
   exercise stays inconclusive either way. Any other outcome: the bounce path
   was not exercised.
7. **Archival:** in `notifications@` webmail, open **Sent** and search for
   `QA SMOKE TEST ROLE`. Record whether the automated messages are there.

**5 — evidence to return (redact before sharing):** the console output; the
evidence JSON (already masked: no password, no full address); a screenshot of
"Show original" with the addresses blacked out; yes/no for the Sent folder;
the bounce message (redacted) or the reported bounce-exercise outcome; Inbox vs Spam.

**6 — afterwards:** if the run printed `KEPT` or `RETAINED`, run the
`--cleanup-run <run id>` command above, against the same test database, until
it reports `CLEANUP COMPLETE` (or `ALREADY CLEANED`); a `REFUSED` or
`INCOMPLETE` result kept the files — read its reason first. The ownership
record `valida-smoke-run-<run id>.json` in `$env:TEMP` may be deleted once it
says `CLEANED`.
Then delete the `SMTP_*` lines and `TRANSACTIONAL_EMAIL_PROVIDER`
(or set it to `none` and remove every `SMTP_*` line — SMTP settings without the
provider are refused at startup), revoke the test app password if you made
one, and `Remove-Item Env:MONGODB_TEST_URI`.

What this does **not** prove: universal deliverability; behaviour at Titan's
sending limits; long-term bounce rates; an email archive (the seven-year archive request was superseded on 2026-10-25 by a monthly
offline backup: `docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`); production deployment (C6/C7).
The results of the owner's runs of 2026-10-25 are recorded in
`docs/qa/B6_EVIDENCE_ADDENDUM.md`.

---

## B4 verification

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b4
echo "exit=$LASTEXITCODE"
```

Windows-safe (plain Node). It applies the same fail-closed test-database
guard as `verify:b3`, **clears `RESUME_STORAGE_DRIVER` /
`RESUME_STORAGE_LOCAL_ROOT` for every child run** (tests use their own
temporary roots — your configured storage is never touched), then reports
PASS/FAIL for:

1. Node.js 24 runtime (the OS is printed too);
2. the complete offline suite — B1, B2, B3 and B4;
3. the B4 acceptance gate on its own: the Doc 17 file matrix through HTTP
   into real local storage, archive bounds and zip bombs, aborted and
   over-limit uploads over raw sockets, storage failures and cleanup,
   persisted bytes and SHA-256, distinct keys, persistence across a new
   adapter and a new process, storage privacy, configuration and
   startup/readiness/shutdown — plus the review r1 regressions
   (`docx-xml-structure`, `storage-link-confinement`, `upload-temp-failure`,
   `pdf-xref-structure`) and the r3 `staged-close` tests. On Windows the confinement tests create
   **junctions** (no administrator right needed); one extra test needs a
   directory symbolic link and reports itself skipped unless Developer Mode
   or administrator rights allow creating one;
4. real-database prerequisites;
5. `db:indexes:apply` against the test database;
6. the complete real-database suite — B2, B3, and B4
   (`tests/db/b4-resume-persistence.test.js`: resume metadata persisted by
   MongoDB still matches the stored bytes after a reconnect, the unique
   storage-key index, the compensation shape;
   `tests/db/b4-storage-lifecycle.test.js`: the backend with storage over real
   MongoDB — startup, readiness, graceful shutdown, `node src/server.js`);
7. `db:indexes:check`.

**The database gate cannot be skipped.** Passing `npm test` alone is not B4
verification.

## B5 verification

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b5
echo "exit=$LASTEXITCODE"
```

Same guard, isolation and fail-closed database gate as `verify:b4`. PASS/FAIL
for: Node.js 24; the complete offline suite (B1–B5); the **B5 acceptance
gate** (`apply-http`, `apply-validation-http`, `apply-failures`,
`apply-units`, `apply-connection`); the B4 acceptance gate carried forward;
real-database prerequisites; `db:indexes:apply`; the complete real-database
suite (B2–B5); the **B5 real-database gate** (`tests/db/b5-apply.test.js`,
`tests/db/b5-apply-server.test.js`) followed by its sanitised evidence; and
`db:indexes:check`.

What the B5 real-database gate exercises against MongoDB, and what is
injected:

| Real | Injected (the rest is real) |
| --- | --- |
| the full chain request -> response -> MongoDB record -> private object (PDF and DOCX) | — |
| replay and key conflict; 8 concurrent requests with one key resolved by the real unique index | an insert gate holds the 8 inserts until all are in flight |
| closed, archived, Draft, expired and unknown Jobs refused; a Job closed during Apply; snapshot immutability after a Job edit | the close during Apply is made by a real `closeJob` inside the storage call, after the object is written |
| loss of the connection after storage: the real repository's disconnected check, compensation | the disconnect is triggered at that moment |
| the real repository's bound expiring before a real insert completes; its `settled` follow-up; the `majority` read-back; the late commit; the retry replay (from a majority-confirmed record) | the START of the save is delayed past the bound |
| an unknown outcome where nothing was written: the real read-back finds nothing; the object is kept and unreferenced | the insert reports a network failure |
| missing unique index -> fail closed; restored -> accepted | the index is dropped |
| the write-durability policy on an UNSAFE connection: the URI sets `w=0`, and the observed insert command still carries `{ w: "majority", j: true, wtimeout }`; the record is read back with read concern `majority` (r2) | the unsafe URI option (that is the point) |
| the notification-state update observed with the same write concern (r2) | a transport double |
| expiry DURING the real eligibility read: `409`, no record, object compensated (r2) | the read's return is delayed past `closesAt` |
| notification FAILED persisted through the validated save; no re-notification on replay | a transport double (no provider exists — B6) |
| the production server composition (`startServer`), pipelining after the refusal, the documented pre-arming limit, and persistence across a backend **process** restart | — |

The repository's classification of driver errors (server error, server
selection, the `NoWritesPerformed` label, write concern, network) is covered by unit
tests with constructed driver errors; reproducing them against a live server
would need a replica set with failure injection (`failCommand`), which this
gate does not assume.

**The database gate cannot be skipped.** Passing `npm test` alone is not B5
verification.

## B6 verification

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b6
echo "exit=$LASTEXITCODE"
```

Same guard and isolation as `verify:b5` (the transactional-email variables —
r4: every `SMTP_*` setting and the password included — are cleared for every
child run too). PASS / FAIL / PENDING for: Node.js 24; the complete offline
suite (B1–B6); the **B6 acceptance gate** (`b6-config`,
`b6-notification-service`, `b6-notifier`, `b6-apply-notifications`,
`b6-readiness`, `b6-retry-command`, `b6-claim-ownership`, r4:
`b6-service-abort`, `b6-smtp-transport`, `b6-smtp-integration`,
`b6-nodemailer-contract`, `b6-smoke-script`, r5: `b6-smoke-lifecycle`); the B5 and
B4 acceptance gates carried forward; real-database prerequisites; **the
database engine is MongoDB** (a compatible stand-in fails this gate);
`db:indexes:apply`; the complete real-database suite (B2–B6, r4: including the
rehearsal of the live smoke script against a local SMTP test server); the
**B6 real-database gate** (`tests/db/b6-notifications.test.js`) followed by its
sanitised evidence; r4: the **live-procedure rehearsal**
(`tests/db/b6-smoke-rehearsal.test.js` — the owner's smoke procedure end to
end on the test database, against a local SMTP test server: no real email;
r5: with `tests/db/b6-smoke-cleanup.test.js`, the run-scoped cleanup; r6: both
prove the ownership checks — another database, the same name on another
server, a missing marker or record, a missing parent job; r7: and that an
interrupted release finishes from a `RELEASING` record; r9: their fixture
Applications are complete synthetic records with their own `idempotency.keyHash`
and `resume.storageKey` — `tests/db/fixtures/syntheticApplication.js`, saved
through the validated model — and the cleanup suite applies and verifies the
required indexes itself, so it cannot pass on a database without them); r7: the complete
real-database suite also includes `tests/db/guard-refusal-no-mutation.test.js`;
`db:indexes:check`; and **real provider acceptance /
delivery — PENDING**: the gate never sends email; the live Titan evidence
comes from "B6 live Titan test" above and is reviewed outside the command.

It ends with the evidence classes kept apart: offline tests and injected
faults; real MongoDB (with the engine and version); real provider acceptance /
delivery; Windows + Node 24 (yes/no for this run).

Exit codes: `1` any gate failed or the run was refused; **`2` every available
gate passed but the provider gate is PENDING** — the expected result for this
build, which is not full B6 verification; `0` every gate passed (not reachable
in this build: the live provider evidence is reviewed outside the command).

What the B6 real-database gate exercises against MongoDB (the transport is
always a TEST DOUBLE — no email is sent):

| Real | Injected (the rest is real) |
| --- | --- |
| both events persisted `SENT`, one attempt each; partial failure (`SENT` + `FAILED / SUPPRESSED`); `NOT_REQUIRED` when disabled; a replay changes nothing | transport outcomes |
| the engine applies a conditional single-document update at most once under concurrency (raw-driver probe) | — |
| two concurrent claims from independently loaded copies: exactly one `CLAIMED` (5 rounds); the LOSER recording first is refused (`LOST`) and the winner records (r3 fix of the defect the Windows run found); two concurrent retry cycles reach the provider boundary once | — |
| on the wire: claim and outcome are conditional `update` commands of the notification paths only, under `{ w: "majority", j: true, wtimeout }` — also over a `w=0` connection | the unsafe URI option |
| B2 history protection: a copy with an altered submission cannot claim; query updates stay refused | the altered field |
| an outcome that cannot be recorded stays `ATTEMPT_IN_PROGRESS` and is not re-sent a day later | the record step fails |
| the retry run: dry run writes nothing; `--send` attempts only unattempted and transient-due notifications; permanent, uncertain and configuration failures untouched; a second run finds nothing; two concurrent runs send each once; the state summary | transport outcomes; the run's clock (+1 day) |
| due-filter dates on the database: a row inside its backoff / grace period is not scanned, then is (r1 re-review) | — |
| states this code never writes (a legacy code, `FAILED` without a code, `PENDING` attempted without the marker) are selected only with `--include-uncertain` (r2) | the stored state, written through the validated save |
| `ops:notifications:retry` as a process (dry run) against the test database | — |

**The database gate cannot be skipped.** Passing `npm test` alone is not B6
verification.

---

## Scope and limitations (B1 + B2 + B3 + B4 + B5 + B6)

Implemented here — and nothing more:

- MongoDB connection, the `Job`/`Application` models and required indexes (B2);
  no data migration exists or is needed yet
- the public Jobs API and controlled Job provisioning (B3); the only real Job
  is a DRAFT whose content is AWAITING INPUT, so the public list is empty until
  approved content is provisioned and published
- private resume storage and validation (B4) — the development-only local
  adapter; **the production storage provider is AWAITING INPUT (C6)**, so a
  deployed instance reports storage `not_implemented`; **no malware scanner**
  (AWAITING INPUT — files stay `NOT_SCANNED`)
- application submission (B5) — the real Apply endpoint
- notification integration (B6) — r4: the SMTP adapter for the selected
  provider (Bluehost Professional Email / Titan), proven against a local SMTP
  test server; **live Titan evidence: the owner's runs of 2026-10-25**, recorded in
  `docs/qa/B6_EVIDENCE_ADDENDUM.md`.
  With `TRANSACTIONAL_EMAIL_PROVIDER=none` (the default) nothing is sent. The
  backend records relay **acceptance** only: Titan offers no webhook or
  delivery API, so bounces are monitored manually in the sending mailbox (draft procedure,
  not approved: `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`); no
  suppression list, no complaint processing, no scheduler; no notification
  index (the retry scan is bounded by `--limit` and `maxTimeMS`). **No
  Sent copy of automated messages is kept** (Titan stores none for SMTP; a copy design is
  proposed, not implemented: `docs/architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md`); the
  application database deliberately stores
  no email bodies
- no orphan reconciliation command yet (Doc 15 section 200,
  `ops:storage:reconcile`, deferred to B7/C6): unknown-outcome and
  failed-compensation objects are KEPT, and the logs name them by a one-way
  object reference (never the key)
- the Apply rate limit counts in process memory: with several backend
  instances each counts separately (Doc 13 section 54; deployment design, C6)
- an early answer given before a request body has arrived (the general 429,
  B1's 404, B4's non-multipart 415) lets Node read and discard the rest of the
  body, bounded only by Node's default `requestTimeout` (300 s) or the client,
  not by the B4 staged-close limits — a server-wide property since B1, measured in
  `tests/apply-connection.test.js`. **OPEN — tracked for B7 and to be resolved
  before public deployment**; a reverse-proxy body limit configured later does
  not by itself close it
- no backend security, failure-handling or QA gate hardening (B7 — *Backend
  Security, Failure & QA Gate*; it is not the admin/authentication milestone)
- readiness reports 503 while no email provider is configured (or its login is
  refused), even with the database connected and storage ready; `ready` for
  notifications means connection + TLS + login verified, not delivery
- losing the database connection at runtime flips readiness back to 503; there
  is no in-memory fallback

The frontend is not yet connected to this API (Release C1). No admin
authentication, HTTP write surface for Jobs, or resume download exists
(Release E); provisioning is an operator command only.
