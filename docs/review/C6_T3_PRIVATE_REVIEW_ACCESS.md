# C6-T3 — Whole-site private Review access (implementation record)

| | |
| --- | --- |
| Task | **C6-T3**, C6 plan revision 3, §4.6.2, with the Review rows of §§4.6.4–4.6.5 |
| Authorised by | [Owner record 2026-11-16](OWNER_RECORD_2026-11-16_C6_T2_ACCEPTANCE_AND_C6_T3_AUTHORISATION.md), §2 — local implementation only; the three private-Review choices and the whole-site cache rule approved |
| Builds on | C6-T1 ([OD-2026-11-15-01](OWNER_DECISION_2026-11-15-01_C6_T1_RECRUITMENT_MODE.md)) and C6-T2 ([record](C6_T2_VISITOR_AWARE_DOCUMENTS.md)), accepted at `faf4571` |
| Recorded against | **Doc 13** (access control, fail-safe configuration), **Doc 15** (environment configuration), **Doc 09** / **Doc 11** (error code), **Doc 16** (caching, Review indexing), **Doc 17** (evidence) |
| Status | Implemented and tested locally on `c6-work`; **correction 1** (production requires explicit `public`) applied. **Not accepted** — acceptance is the owner's, after Astra's review. Nothing pushed |

## 1. What was built

One module, `backend/src/config/siteAccess.js`, holds the configuration rule and the admission rule; the API (`middleware/siteAccess.js`) and the document server (`frontend/server/siteAccess.js`, `documentServer.js`, `serve.mjs`) both use it.

**Configuration — validated at start-up in both services, before listening.**

| `APP_ENV` | `SITE_ACCESS` absent | `public` | `private` |
| --- | --- | --- | --- |
| `local` | public | public | private (a valid `ACCESS_ALLOWLIST` required) |
| `review` | refused | refused | private (a valid list required) |
| `production` | **refused** (correction 1) | public | refused |

Any other value (wrong case, padding, a typo) is refused; `private` with an absent or invalid list (the T1 range policy) is refused; the document server also refuses `APP_ENV=review` with an indexable build. A refusal names the variable and a fixed rule, never the value. The local development workflow is unchanged: with nothing set, both services are public.

**Admission on a private site — first, before any other work.**

- Exempt: **GET and HEAD of exactly** `/api/v1/health` (API) and `/healthz` (document server, which answers 200 with an empty body in every mode). No query, no trailing slash, no other case. Readiness is protected.
- A direct request is admitted when its own address — the accepted T1 rule under `TRUST_PROXY` — is listed. An unknown address (incomplete chain, malformed entry) is not.
- **A delegated read (T2) is admitted only for its authenticated end visitor**: valid key, a listed visitor, GET/HEAD of the Jobs list or one Job. Any other request carrying a delegation header is denied, **whatever the calling peer's own address**. Delegation stays read-only and limited to those routes.
- The document server never reads delegation headers: its admission is its own visitor's, and its reads delegate that visitor as in T2.
- Denials: API — `403` with the canonical envelope, code `AUTHORIZATION_DENIED`, message "We couldn’t complete this request. Please try again." (Doc 06 §188); document server — `403`, `text/plain`, `Forbidden` (empty for HEAD). Before CORS (preflight included), redirects, `robots.txt`, the sitemap, static files, body parsing, rate limiting and routing. A denied request that may carry a body is answered without reading it and the connection is closed.
- Admission grants nothing else: an admitted visitor still meets CORS, the recruitment mode, validation, method rules and every route's permissions.

**Caching.** On a private site every response of either service — liveness, denials, assets, errors, redirects — carries `Cache-Control: private, no-store`, with no `ETag` or `Last-Modified`; conditional request headers are dropped, so nothing is answered `304`. It is enforced when the response head is written, so no later code can loosen it. A public site keeps the accepted T2 behaviour.

## 2. Details settled in implementation — for the reviewer

| Detail | What was built | Why |
| --- | --- | --- |
| `SITE_ACCESS` absent or empty in production | **Correction 1:** refused at start-up in both services, like `private` or an invalid value. Only the explicit literal `public` starts production. A local run keeps its public default; Review keeps requiring `private`; `RECRUITMENT_MODE` is independent | C6 plan r3 §4.6.2: "With `APP_ENV=production` both refuse to start with any other value". The original implementation (`5272c08`) defaulted an absent value to `public`; Astra/the owner returned it for this correction |
| The allowlist | The same `ACCESS_ALLOWLIST` as `testers` | Plan §4.6: one list per environment; Review uses `testers` with it |
| A Review document server without `INTERNAL_SERVICE_KEY` | Starts (as in T2); its Job-page reads are then rejected delegations, so the API denies them and Job Detail/Apply documents are 503 for listed testers | Consistent with "a rejected delegation is denied"; the start-up warning of T2 says so. Careers and static pages are unaffected |
| `/healthz` in public mode | Also 200, empty, `no-store` | The host's health check needs the same path in Review and Production |
| `/healthz/`, `/HEALTHZ` | Ordinary routing (one-hop redirect, or 404) — and on a private site, 403 like any other path | Only the exact target is exempt |
| Error code | `AUTHORIZATION_DENIED` (Doc 11 §239, §243) | Doc 09 §23 lists no 403 for the public API; §4 below proposes the amendment |
| Denied-request logging | The API's error handler logs the code and a fixed reason token (`SITE_CLIENT_NOT_LISTED`, `SITE_DELEGATION_REJECTED`, …); no address or header value | Doc 13 logging rules |

## 3. Verification

Unit and HTTP tests: `backend/tests/c6-site-access.test.js` (78), `frontend/server/siteAccess.test.js` (49). The actual local stack: `e2e/c6/c6-t3-stack.mjs` (`npm run test:c6t3:stack`) — the start-up matrix for both services, a private Review run (testers mode, review build), a local private run with real résumé storage, cache isolation in both visitor orders, Chromium rendering. Results and evidence: the C6-T3 handoff package.

## 4. Canonical-document synchronisation still needed (Doc 00 §5)

| Document | Where | Proposed addition |
| --- | --- | --- |
| **Doc 09** §23 (and §24) | Standard error codes; status policy | **The smallest amendment:** add `AUTHORIZATION_DENIED` to the Phase 1 families, and the row "Client not admitted to a private environment (`SITE_ACCESS=private`) → 403 `AUTHORIZATION_DENIED`, message as Doc 06 §188". No public response changes in Production |
| **Doc 11** §243 | Authorization denied status | Add: "and for any client not admitted to a private environment, before authentication" |
| **Doc 15** | Environment variables; Review and Production tables; health checks | `SITE_ACCESS` with the table of §1; `APP_ENV=review` requires `private`; production requires `public`; the document server's liveness path `/healthz`; the host's health checks use the liveness paths only |
| **Doc 13** | Access control; fail-safe configuration | "A Review environment is private as a whole: every route answers 403 to an unlisted client, before any other processing, except liveness. A delegated read is admitted only for its authenticated end visitor. A wrong site-access configuration stops the service" |
| **Doc 16** | Caching; Review indexing | "On a private environment every response is `private, no-store`, without validators. Review also refuses an indexable build" |
| **Doc 00** | §30; §5 change log | An entry naming this record and the documents above: "implemented locally at C6-T3; hosted verification pending under G-ACCESS" |

**Status: NOT MADE** — the canonical collection is read-only here.

## 5. Still open — not claimed

- **G-ACCESS**, per real hostname, before any synthetic Job is provisioned there: the host's forwarding chain (H1–H6), edge caching (H7, row 8), the health-check paths (H8), and the shared runtime module (H9).
- Delegated-read rate limiting (the API's limiters key by `req.ip`); the `mongoose` advisory; Safari on real devices (OPEN) — tracked separately.
