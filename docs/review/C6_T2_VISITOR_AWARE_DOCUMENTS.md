# C6-T2 — Visitor-aware Job documents (implementation record)

| | |
| --- | --- |
| Task | **C6-T2**, the second task of C6 (plan revision 3, §§4.6.1, 4.6.3–4.6.5) |
| Source | The owner's instruction "Valida — C6-T2 authorized for local implementation" (2026-11-15), after the owner's acceptance of C6-T1 at `cdccfaec62bbc456fed1b9825ea58527f666c2e9` |
| Builds on | [OD-2026-11-15-01](OWNER_DECISION_2026-11-15-01_C6_T1_RECRUITMENT_MODE.md) — the recruitment mode. This record adds **no new owner decision** and uses no new decision identifier |
| Recorded against | **Doc 13** (security), **Doc 15** (deployment configuration), **Doc 09** (API), **Doc 16** (SEO: sitemap, caching) |
| Scope rule | Local implementation and testing only. No push, merge, deployment, provisioning, DNS change, live email or vacancy publication. Production candidate acknowledgements stay disabled; the genuine vacancy stays Draft |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed. **Not accepted**: acceptance belongs to the owner after Astra's review |

## 1. Why

In C6-T1 the API decides who may see Jobs from the client's address. The document server (`frontend/server/`) also reads Jobs — to choose each Careers, Job Detail and Apply page's status and head — and the API saw those reads as coming from the **document server's** address. On a host where that address is listed, every visitor's server-rendered page would show the tester view; where it is not, a listed tester's page would disagree with what their browser then loads. A per-visitor page could also be stored by a shared cache and served to someone else.

## 2. What was built

1. **One address rule, two services.** The document server establishes the visitor's address with the accepted T1 rule — the same `TRUST_PROXY` variable and the same functions (`parseTrustedHops`, `establishClientAddress`), imported from `backend/src/config/recruitmentAccess.js`. One case table (`backend/tests/fixtures/clientAddressCases.js`: 22 address cases, 16 `TRUST_PROXY` values) is run against both services.
2. **Delegated reads.** Every server-side Jobs read carries `X-Valida-Visitor-Address` (the address, or `unlisted` when it is unknown) and, when configured, `X-Valida-Internal-Key` (`INTERNAL_SERVICE_KEY`). The API remains the sole authority: it verifies the key in constant time and decides the read as that visitor's own direct request. A missing, wrong or unconfigured key, or a missing or malformed visitor, gets the **unlisted view** — even when the document server's own address is listed. A delegated method other than `GET`/`HEAD` gets **no Jobs access in any mode**: delegation grants no submission privilege. A request with neither header keeps exactly the T1 behaviour. The outcome table is in [`backend/README.md`](../../backend/README.md), "Delegated Jobs reads (C6-T2)".
3. **Visitor headers are never trusted from outside.** The document server builds the outgoing headers from scratch; any `X-Valida-*` header a visitor sends is discarded.
4. **The key stays on the API origin.** Reads go only to the configured API origin plus a fixed path, with `redirect: 'error'`: a redirect to any origin is not followed and the read is reported as unavailable (503), not as a missing Job. The key is read from the environment (not the command line), and is in no log, document, preload hint, error or evidence file.
5. **Pages agree with the API.** Initial HTTP status, robots directives, metadata, JobPosting and the C5 preload hint are decided from the delegated read; the client then loads the same data with its own direct request. In `closed` Careers is usable with no roles and Job Detail and Apply give the accepted 404. In `testers` only a listed visitor receives the tester view (`X-Valida-Audience: tester` on the document as well). A Jobs API failure stays a 503, distinct from an empty Careers list or a 404.
6. **Sitemap: the public view, whoever asks.** Its reads always name `unlisted`; a tester-only Job is never listed. Indexing-disabled behaviour (no sitemap) is unchanged.
7. **No shared or revalidated copies.** Careers, Job Detail and Apply — 200, 404 and 503 — are sent with `Cache-Control: private, no-store`, without `ETag` or `Last-Modified`, and the document server never answers `304`. The API drops conditional request headers on `/api/v1/jobs…` and strips `ETag`/`Last-Modified` (it previously sent weak ETags). Other documents keep `no-cache`; `/assets/` keeps its immutable caching.

## 3. Details settled in implementation — for the reviewer

| Detail | What was built | Why |
| --- | --- | --- |
| Configuration names | `TRUST_PROXY` for the document server (the accepted T1 name, instead of the plan's provisional `CLIENT_ADDRESS_HOPS`); `INTERNAL_SERVICE_KEY` for both services (the plan's name; T1 has no equivalent) | The instruction: "Use the accepted T1 configuration names where the plan uses provisional names" |
| The API's Jobs `Cache-Control` | **Kept `no-store`** (Doc 09 §58), not changed to `private, no-store`; validators removed | `no-store` already forbids every cache, private or shared. Changing the value would alter a documented API contract and its accepted assertions for no protective gain. **For Astra and the owner to confirm**; a one-line change if `private, no-store` is wanted on the API too |
| The sitemap's `Cache-Control` | Kept `no-cache` (accepted C4 behaviour) | Its content no longer depends on the requester |
| Key format | 32–512 visible ASCII characters, no spaces. An unusable key is treated as no key, and the document server still starts, with a warning | Fail closed without taking the site down, as T1 does for the mode |
| Logging | A rejected delegation logs `recruitment.delegation_rejected` with a fixed outcome code; the key header is redacted; addresses are never logged | Doc 13: no secrets or tester addresses in logs |
| Shared code | The document server imports the backend module by relative path | One rule, not two copies that can drift. **Deployment consequence:** a host that deploys `frontend/` alone, without `backend/src/config/`, will not start the document server. Added to the hosted checks as **H9** |
| Rate limiting | Unchanged: the API limiters key by `req.ip`, so all document-server reads share the document server's budget (as since C4) | Out of scope; recorded as a known limit for C6 hosting |

## 4. Canonical-document synchronisation still needed (Doc 00 §5)

Under Doc 00 §5 these are amended by the owner. Proposed entries:

| Document | Where | Proposed addition |
| --- | --- | --- |
| **Doc 15** | Environment variables; Review and Production tables; deployment checks | "`INTERNAL_SERVICE_KEY`: a random secret of 32–512 visible characters, the same for the API and the document server, distinct per environment, kept in the host's secret store. `TRUST_PROXY` applies to the document server with the backend's rule. The document server is deployed with `backend/src/config/` present (H9)." |
| **Doc 13** | Public-endpoint controls; service-to-service authentication | "The document server reads Jobs on a visitor's behalf with a server-only key verified in constant time. A failed delegation is treated as an unlisted visitor; delegation grants no write. Visitor-supplied delegation headers are discarded; the key is never sent to another origin, never logged. Recruitment-dependent pages are `private, no-store` without validators." |
| **Doc 16** | Sitemap rules; caching of Job pages | "The sitemap lists the public view only, whoever requests it. Careers, Job Detail and Apply responses are `Cache-Control: private, no-store`, without `ETag`/`Last-Modified`." |
| **Doc 09** | Jobs endpoints | "No validators (`ETag`, `Last-Modified`, `304`) on Jobs responses. Two internal request headers, `X-Valida-Visitor-Address` and `X-Valida-Internal-Key`, are accepted from the document server only; they are not part of the public contract." No public request, response, status or message changes |
| **Doc 00** | §30 Central Delivery Tracker; §5 change log | An entry naming this record and the four documents above: "implemented locally at C6-T2; hosted verification pending under G-ACCESS" |

**Status: NOT MADE from this environment** — the canonical collection is read-only here.

## 5. Still open — not claimed

- **G-ACCESS, per hostname, before any synthetic Job is provisioned there:** whether the host's proxies append the client address as `TRUST_PROXY` assumes (for the API **and** the document server), whether any shared cache or CDN in front honours `private, no-store`, and H9 (the document server starts with the backend module present). Locally the forwarding proxies are part of the test.
- Whole-site private Review access (`SITE_ACCESS`), providers, deployment, dependency upgrades.
- Safari on real macOS and iOS devices: **OPEN**, on the C6 review host, before C7 closes.

## 6. Implementation and tests

API: `backend/src/config/recruitmentAccess.js` (rules, delegation), `backend/src/middleware/recruitmentAccess.js` (gate), `backend/src/middleware/noValidators.js`, `backend/src/app.js`, `backend/src/config/env.js`. Document server: `frontend/server/visitorAddress.js`, `jobsClient.js`, `renderDocument.js`, `documentServer.js`, `serve.mjs`. Tests: `backend/tests/c6-delegation.test.js`, `frontend/server/visitorDelegation.test.js`, the stack check `e2e/c6/c6-t2-stack.mjs` (real API, real document servers, forwarding proxies, synthetic Jobs, disposable database, Chromium rendering).
