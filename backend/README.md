# Valida backend

Node.js + Express REST API for the Valida platform.

| | |
| --- | --- |
| Milestone | **B3 — Job Provisioning & Public Jobs API** (on top of B1 — Backend Runtime & Configuration, and B2 — MongoDB Models & Indexes) |
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

There is still no application submission, upload or email.
`/api/v1/health/ready` correctly answers **503 "Service is not ready."**,
because resume storage (B4) and notifications (B6) are required and do not
exist yet. The Jobs API does not depend on them and serves while readiness is
503.

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
npm run db:indexes:apply
npm run db:indexes:check
npm run jobs:provision:plan  -- --file provisioning/jobs/cybersecurity-specialist.json
npm run jobs:provision:apply -- --file provisioning/jobs/cybersecurity-specialist.json
```

`npm test` deliberately excludes `tests/db`. Those tests need a real MongoDB;
a default command that silently skipped them could report green while
persistence and uniqueness were never exercised. Passing `npm test` is
therefore **not** B2 or B3 verification — `npm run verify:b3` (which also
runs every B2 database test) is.

The offline suite also runs the provisioning module and the unmodified
provisioning CLI over a **stand-in collection** (`tests/fixtures/fakeJobStore.js`,
preloaded into the CLI only by tests) to count the writes a run sends and to
inject failures at exact points — after an acknowledged insert, on
publication, on the read-back. That proves the outcome reporting, not
persistence.

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
| `MONGODB_TEST_URI` | tests only | — | Used only by `test:db` / `verify:b2` / `verify:b3`. Database must be named **`valida_test`** or **`valida_test_<suffix>`** and differ from `MONGODB_URI` — see "B2 verification" |

Configuration is validated once at startup with Zod. **Invalid or missing
production-critical configuration stops the process** rather than serving
traffic in a half-configured state. Error messages name the offending variable
and never print its value.

Variables recorded in `.env.example` as *future* — `RESUME_STORAGE_*`,
`TRANSACTIONAL_EMAIL_*`, `PUBLIC_SITE_URL` — are deliberately **not** read or
required. Requiring a variable nothing consumes would imply the capability
exists.

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
| `resumeStorage` | B4 | not implemented |
| `notifications` | B6 | not implemented |

So a B2 runtime, even with MongoDB connected, answers:

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
3. registered dependency hooks run — from B2, the MongoDB connection is
   closed (the `database` dependency is marked unavailable first) — together
   at most another 10 s. A close that fails or never settles is abandoned and
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
names a reachable MongoDB server."*; anything else prints only a fixed
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

## Scope and limitations (B1 + B2 + B3)

Implemented here — and nothing more:

- MongoDB connection, the `Job`/`Application` models and required indexes (B2);
  no data migration exists or is needed yet
- the public Jobs API and controlled Job provisioning (B3); the only real Job
  is a DRAFT whose content is AWAITING INPUT, so the public list is empty until
  approved content is provisioned and published
- no resume upload or private storage (B4)
- no application submission (B5)
- no transactional email (B6)
- no backend security, failure-handling or QA gate hardening (B7 — *Backend
  Security, Failure & QA Gate*; it is not the admin/authentication milestone)
- no Apply-specific rate limiter — it ships with the Apply endpoint in B5
- readiness reports 503 until B4 and B6 land, even with the database connected
- losing the database connection at runtime flips readiness back to 503; there
  is no in-memory fallback

The frontend is not yet connected to this API (Release C1). No admin
authentication or HTTP write surface for Jobs exists (Release E); provisioning
is an operator command only.
