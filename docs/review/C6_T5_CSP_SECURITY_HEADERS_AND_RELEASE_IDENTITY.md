# C6-T5 — enforced Content-Security-Policy, document security headers and release identity

| | |
| --- | --- |
| Milestone | Release C, C6 — Production Infrastructure & Deployment; plan revision 3, steps **2b** and **2d** |
| Authorisation | [Owner record 2026-11-17](OWNER_RECORD_2026-11-17_C6_T4_ACCEPTANCE_AND_C6_T5_AUTHORISATION.md): D-6 approved; the full T5 scope authorised, local only |
| Governing | Doc 13 §§31–36, 145–148, SEC-003, SEC-004, SEC-057; Doc 17 QA-040, §§142–143; Doc 18 §§173–179; C6 plan r3 §8.4, §7.1 rows R8 and R14 |
| Status | Implemented and tested locally on `c6-work`. **Not accepted.** That is the owner's decision, after Astra's review. Nothing is pushed |

## 1. What was inspected (C6-T5 step 1)

| Item | Finding |
| --- | --- |
| Document server routes | `/`, `/about`, `/careers`, `/careers/:slug`, `/careers/:slug/apply`, `/privacy`, `/legal`, 404; `/robots.txt`; `/sitemap.xml`; `/assets/*`, `/brand/*`, `/social/*`; `/healthz`; one-hop 301s to the canonical path form; 400/403/405/500/503 answers |
| Assets the build loads | One module script and one stylesheet under `/assets/` (`crossorigin`). Fonts self-hosted (`@fontsource`, `/assets/*.woff2`/`.woff`, referenced only from the stylesheet). Icons from `/brand/`. No inline script body, no `<style>`, no `style=` attribute, no `data:` URI, no `eval`/`new Function` in the bundle |
| API origin | The bundle calls `VITE_API_BASE_URL`, recorded in the build's `valida-seo.json` as `apiBaseUrl`. The Job preload hint (`<link rel="preload" as="fetch">`) uses the same base |
| Structured data | `<script type="application/ld+json">` JobPosting, in the initial HTML (renderDocument) and kept in step by PageMeta. It is a data block: browsers never execute it and CSP does not apply to it (verified in Chromium: no violation, B4) |
| Forms | The Apply form is submitted by script (`fetch`), never by navigation |
| Headers before (`16119a7`) | Document server: `nosniff` and cache/robots headers only — **no CSP**, no Referrer-Policy, no Permissions-Policy, no framing control. API: Helmet defaults, so a CSP merged with Helmet's default source list (`https:`, `data:`, style `'unsafe-inline'`, `upgrade-insecure-requests`), and **`Strict-Transport-Security: max-age=31536000; includeSubDomains`** on every response. Evidence: `before/headers-before-16119a7.txt` in the review package |

**A finding on HSTS:** the accepted API has sent a one-year `includeSubDomains` HSTS policy since B1, because it is Helmet's default. Over a hosted HTTPS API this would activate HSTS at first deployment, before the owner's P9 decision and with a longer policy than P9 plans. C6-T5 turns it off (§3).

## 2. The document server's policy

Enforced (`Content-Security-Policy`), on **every** response: documents, assets, redirects, robots.txt, the sitemap, liveness, 400/403/404/405/500/503.

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self';
connect-src 'self' <the build's API origin>; base-uri 'none'; form-action 'none';
frame-ancestors 'none'; object-src 'none'
```

- It contains no `'unsafe-inline'`, no `'unsafe-eval'`, no wildcard and no scheme source (Doc 13 §35).
- `connect-src` names exactly the API origin the bundle was built with. A build whose API base is neither empty nor a plain origin is **refused at start-up**, because the policy could not name it.
- `upgrade-insecure-requests` is not used. The API origin is named exactly, and production builds name an `https:` origin.

**Other headers, on every response:**

| Header | Value | Why |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Doc 13 §146 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Another origin, the API included, sees at most this site's origin, never a path (Doc 13 §147) |
| `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` | Capabilities the site does not use, disabled (Doc 13 §148). Only features Chromium recognises are listed, so none is reported as unknown |
| `X-Frame-Options` | `DENY` | The legacy companion of `frame-ancestors 'none'` (Doc 13 §33) |
| `X-Valida-Release` | the commit, when configured | §4 |
| `Strict-Transport-Security` | **not sent** | P9, owner decision |

Code: `frontend/server/securityHeaders.js`, applied first in `documentServer.js`, before site access and before any other decision.

**Unchanged:**
- every status, redirect and body;
- the C4 heads, the sitemap, robots.txt and `X-Robots-Tag`;
- the T2 cache rules: `private, no-store` on recruitment documents, `no-cache` on the others, one-year immutable assets, no validators on Jobs;
- the T3 private refusal: 403 `Forbidden` with `private, no-store`, liveness exempt.

## 3. The API's headers

- **CSP:** exactly `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (`useDefaults: false`). This is the policy the code always declared; Helmet's default list is no longer merged in. The API serves JSON only.
- **HSTS:** off (`strictTransportSecurity: false`). It is activated by the owner at P9. This change is deliberate and reversible, and it is recorded here and in `backend/README.md`, "Security". The accepted B1 assertion that HSTS is present is replaced by one that it is absent.
- **Unchanged:** `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, the Cross-Origin policies, CORS and the rate-limit headers.

## 4. Release identity (D-6; plan §8.4)

| | |
| --- | --- |
| Header | `X-Valida-Release: <the full 40-character commit SHA>` on every response of **both** services |
| Source | `RENDER_GIT_COMMIT`, from the process environment, read once at start-up (the host sets it at build and run time) |
| Absent or empty | Starts; no header; the start-up line reads `releaseState: unset`. This is an ordinary local run |
| Exactly 40 lowercase hex | Starts; every response carries it; the API logs `"release identity"` with it, and the document server's `READY` line states it |
| Anything else | **Refused before listening**, naming `RENDER_GIT_COMMIT` and never printing the value |
| Requests | Never consulted. An incoming `X-Valida-Release` is overwritten, or removed when none is configured |

The rule lives once, in `backend/src/config/releaseIdentity.js`, and the document server imports it, as it already does the site-access rule.

**Not decided here (owner option):** whether a hosted environment (`APP_ENV=review`/`production`) should *require* the variable. As implemented, an absent value gives no header, and the §8.4 release check then fails visibly. Render always sets it.

## 5. Proposed canonical entries (Doc 00 §5) — **not adopted**

| Document | Proposed entry |
| --- | --- |
| Doc 13 §146 | The exact headers and policy of §§2–3 for the document server and the API. HSTS: by the owner at P9 only |
| Doc 15 | Environment variable `RENDER_GIT_COMMIT` (both services; host-supplied; malformed refuses start-up). The release check reads `X-Valida-Release` |
| Doc 09 | Every API response may carry `X-Valida-Release`; no body changes |

## 6. Tests

| Suite | What |
| --- | --- |
| `backend/tests/c6-t5-release-identity.test.js` (new) | The configuration table, the header on every kind of API response, forged headers, start-up valid/absent/malformed |
| `backend/tests/security.test.js` | The exact API CSP; no HSTS |
| `frontend/server/securityHeaders.test.js` (new) | The policy, every kind of document-server response, the release header, start-up through `serve.mjs` (valid/absent/malformed; an API base the policy cannot name) |
| `e2e/c6/c6-t5-stack.mjs` (new) | The real HTTP entry points and Chromium, including the browser blocking what the policy disallows (see `e2e/README.md`) |

## 7. Open after this task

- **Hosted:** R8 (the policy with no violation on the host) and R14 (the release header equals the deployed SHA, both services), from the review host.
- **Safari:** S12 (no console error under the enforced policy) on real devices.
- **HSTS:** P9.
- **Owner option (§4):** require the release variable in hosted environments.
