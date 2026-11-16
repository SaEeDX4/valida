# Owner record 2026-11-16 — C6-T2 accepted; C6-T3 authorised

| | |
| --- | --- |
| Date | 2026-11-16 |
| Decided by | Saeed (owner), after Astra's review of the C6-T2 handoff |
| Source | The owner's instruction "Message for Claude — Valida C6-T3" (2026-11-16) |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |
| Governing | Doc 00 §5 (change control); Doc 18, C6 (§§173–182); C6 plan revision 3, §§4.6.2–4.6.5 |
| Not an owner-decision identifier | This record states acceptance and an authorisation. It allocates **no** new `OD-` identifier and is not usable as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. C6-T2 — accepted

| | |
| --- | --- |
| Accepted commit | **`faf45716c0026805957f8cd9eaf80f1e975adcbf`**, tree **`0ebeedc0a9af1acb6f99b2b28cd21c425a86227f`** (local `c6-work`) |
| Record | [`C6_T2_VISITOR_AWARE_DOCUMENTS.md`](C6_T2_VISITOR_AWARE_DOCUMENTS.md) |
| Evidence | The C6-T2 handoff package (outside the repository), unchanged |

Approved with it:

1. **The C4 sitemap test adjustment.** C4-02 and C4-09 assert the public-view sitemap in the `testers` stack (static routes only, while the listed requester still receives the tester view of a Job page); the public-mode half of SEO-012 is checked by the C6-T2 stack check, E6 (commit `9161766`).
2. **Cache decision 1.** The Jobs API keeps `Cache-Control: no-store` (Doc 09 §58), with no `ETag`, `Last-Modified` or `304`.
3. **Cache decision 2.** Careers, Job Detail and Apply HTML carry `Cache-Control: private, no-store` in every recruitment mode, `public` included, because the document server does not know the mode. This replaces plan §4.6.4's "in `public` mode the accepted headers return" for those three documents.

## 2. C6-T3 — authorised (local only)

**Scope:** whole-site private Review access (`SITE_ACCESS`), plan §4.6.2, with the Review rows of §§4.6.4–4.6.5, in the API and the document server; focused tests, documentation and evidence. Authority ends at local C6-T3.

The three private-Review choices of the C6-T2 planning note, and the whole-site cache rule, are **approved**:

| Choice | Decision |
| --- | --- |
| a. Reachable without admission | Only **GET and HEAD of exactly `/api/v1/health`** (API) and **`/healthz`** (document server). Readiness stays protected |
| b. Document-server health path | A dedicated **`/healthz`**: 200, empty body |
| c. Denial body | API: the **canonical 403 error envelope** with approved generic wording. Document server: **403, plain text `Forbidden`**, an empty body for HEAD |
| Whole-site cache rule | On a private site, **every** response of both services — liveness, denials, assets, errors and redirects included — carries `Cache-Control: private, no-store`, no `ETag`, no `Last-Modified`, never `304`. A public site keeps the accepted T2 behaviour |

Configuration rule: Review requires `private` with a valid, non-empty allowlist; Production requires `public`; invalid or unsafe combinations are refused before listening, in both services.

**Unchanged and still required:** production candidate acknowledgements disabled; the genuine vacancy Draft through the Release E gates, including E6; no GitHub write, merge, settings change, purchase, provisioning, DNS change, deployment, live email, real vacancy publication, change to `C:\ME\Valida`, or later-stage work.

## 3. Canonical edits still awaiting synchronisation

None of these has been made; the canonical collection is read-only from this environment.

| From | Documents | Where proposed |
| --- | --- | --- |
| C6-T1 (OD-2026-11-15-01) | Docs 15, 13, 00 | the T1 decision record, §4 |
| C6-T2 | Docs 15, 13, 16, 09, 00 — now including cache decision 2 above | the T2 record, §4 |
| C6-T3 | Docs 09/11 (a 403 entry for the public API), 15, 13, 16, 00 | the T3 record, §4 (`C6_T3_PRIVATE_REVIEW_ACCESS.md`) |

## 4. Still open, tracked separately

- **G-ACCESS** for each real hostname before any synthetic Job is provisioned there (local runs cannot show the host's proxy chain or edge cache).
- **H9** — the shared runtime module: the document server imports `backend/src/config/`; a host must deploy both directories from one commit.
- **Delegated-read rate limiting** — the API's limiters key by `req.ip`.
- **The `mongoose` advisory** — a separate dependency task.
- **Safari** on real macOS and iOS devices — OPEN, on the C6 review host, before C7 closes.
