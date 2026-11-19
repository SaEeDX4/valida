# Owner record 2026-11-18 — `mongo:8.0` digest pin; a 30-day audit exception for GHSA-fc5q-39xc-vjpf

| | |
| --- | --- |
| Date | 2026-11-17 22:31 America/Vancouver = **2026-11-18T05:31:00Z** |
| Decided by | Saeed (owner) |
| Source | The owner's instruction "Valida — final consolidated C6-T6 local CI correction and hosting handoff", continuing from `edd286eb7cda7c4ff0e4908b3da4dfd334ef45ab` on `c6-work` |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |
| Governing | Doc 00 §5 (change control); Doc 13 §136 (dependency scanning in CI), §137 (a high-risk dependency issue is release-blocking until mitigated, upgraded or **explicitly risk-accepted**), §310 (risk acceptance: reason, risk, assets, mitigating control, owner, expiry), SEC-100; Doc 15 (CI); Doc 18 C6 §178 |
| Not an owner-decision identifier | No `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. Decision A — pin the CI MongoDB service image

Both workflow service images (`.github/workflows/ci.yml`, `.github/workflows/e2e.yml`) are pinned to:

```
mongo:8.0@sha256:bdc216e9d5a6ec2cfdac789b5832fdab64cd32055f59885cae918a92de63c361
```

**Provenance, stated exactly:**
- **Astra retrieved this digest directly from Docker Registry.**
- Claude did not verify it against the registry: from Claude's environment every Docker registry host was refused (HTTP 403 to CONNECT; see the C6-T6 task record §2).
- The same value had earlier been read from a secondary source (`docker-library/repo-info`), which Claude recorded as unverified.

The pin fixes the bytes CI runs; a later `mongo:8.0` re-tag has no effect until the pin is changed deliberately.

## 2. Decision B — a temporary, narrowly scoped audit exception

| Element (Doc 13 §310) | Content |
| --- | --- |
| **Advisory** | **GHSA-fc5q-39xc-vjpf** (CVE-2026-112366): `picomatch` `<=4.0.7`, ReDoS via repeated single-branch extglobs; high |
| **Reason** | No patched `picomatch` release exists. npm's suggested "fix" is a semver-major *downgrade* of vite/vitest, which is not a remediation |
| **Risk** | A crafted glob pattern could block the event loop of the process that evaluates it |
| **Affected assets** | Development and build tooling only: `vite`, `vitest`, `tinyglobby`, `fdir`, `@vitest/coverage-v8` (backend), `@vitejs/plugin-react` (frontend). Not in the API runtime; not in the browser bundle |
| **Mitigating controls** | The patterns are the repository's own configuration, never request input. The production dependency audit is clean. The gate fails if any part of this changes (below) |
| **Owner** | Saeed |
| **Period** | **Start `2026-11-18T05:31:00Z`; expiry `2026-12-18T05:31:00Z`** — exactly 30 days, recorded once, here and in `ops/ci/audit-policy.json`. **Never extended automatically.** At the expiry the gate fails |
| **Exact scope** | Package `picomatch` at `node_modules/picomatch`, version **4.0.7** only, advisory range `<=4.0.7` as reviewed. The dependent packages, node paths and versions listed per package in `ops/ci/audit-policy.json` (backend: vite 8.3.3, vitest 5.0.3, @vitest/coverage-v8 5.0.3, tinyglobby 0.2.17, fdir 6.5.0; frontend: vite 8.2.4, vitest 5.0.3, @vitejs/plugin-react 6.1.1, tinyglobby 0.2.17, fdir 6.5.0), each a development dependency in the lock file |
| **Mechanism** | `ops/ci/audit-gate.mjs` with `ops/ci/audit-policy.json`, in the `backend` and `frontend` CI jobs. It runs `npm audit --json` over **all** dependencies (no `--omit=dev`), keeps the raw report and npm's exit code as a CI artifact, and reports **PASS WITH APPROVED EXCEPTION**, naming the advisory and the period, on every run |
| **It fails on** | any other finding at high or above (the existing `--audit-level=high` policy); the advisory outside the reviewed versions, node paths or dependent packages; production exposure; a changed advisory range; **a patched `picomatch` release appearing** (remediation is then required); audit, registry or network errors; malformed or unsupported reports or lock files; before the start; at or after the expiry |
| **Not used** | `--omit=dev`, `continue-on-error`, unconditional success, a blanket ignore list |

### Removal procedure

When a patched `picomatch` release appears, the gate fails on its own (`REMEDIATION AVAILABLE`). On that failure, or on the expiry, whichever comes first:

1. Update within the existing ranges, e.g. `npm update picomatch` in `backend/` and `frontend/` (or the smallest supported release that leaves the advisory's range).
2. Confirm `npm audit --json` no longer reports GHSA-fc5q-39xc-vjpf.
3. Delete the exception object from `ops/ci/audit-policy.json`; the gate then reports `PASS`.
4. Run `node --test ops/ci/audit-gate.test.mjs`, replacing its fixtures with the new reports.
5. Record the removal in a new owner record.

**If neither happens by the expiry:** CI fails, and continuing needs a **new** owner decision (a new record, a new fixed period). Editing the dates is not a continuation of this one.

## 3. Unchanged

- **C6-T6 acceptance stays pending.** Hosted verification and canonical adoption remain separate decisions.
- **Outside this authorisation:**
  - any GitHub push, pull request or workflow dispatch;
  - purchases, provisioning, deployment, DNS, live email and production changes;
  - any change to `C:\ME\Valida`;
  - history rewriting and unrelated refactoring.
- Production candidate acknowledgements stay disabled. The genuine vacancy stays Draft through E6.
