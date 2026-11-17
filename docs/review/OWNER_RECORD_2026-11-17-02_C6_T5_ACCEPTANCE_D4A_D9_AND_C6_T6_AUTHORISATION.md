# Owner record 2026-11-17 (second) — C6-T5 accepted; D-4a and D-9 approved; C6-T6 authorised

| | |
| --- | --- |
| Date | 2026-11-17 |
| Decided by | Saeed (owner), after Astra's review of C6-T5 |
| Source | The owner's instruction "Valida — C6-T6: consolidated local implementation and evidence package" (2026-11-17) |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |
| Governing | Doc 00 §5 (change control); Doc 13 §§112–118, 213, SEC-059–SEC-063; Doc 15 §§176–198; Doc 17 QA-085–QA-088, §407; Doc 18 §§176–180; C6 plan revision 3, §10 steps 2e and 2f, §4.5, §5, §6, §7.1, §8.5, §11 (D-4a, D-9); the plan r3 correction 1 (restore rehearsal: damaged and healthy snapshots) |
| Not an owner-decision identifier | No new `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. C6-T5 — accepted

| | |
| --- | --- |
| Accepted commit | **`2a1ec6f61aca7a38ab1dc605050e425cdf82c76a`**, tree **`c95c7d9dc126ebd394f018b911290c9fea693846`** — the enforced document-server CSP and security headers, the API's exact CSP, `X-Valida-Release` on both services, and the C5 instruments that run under the policy |
| Record | [`C6_T5_CSP_SECURITY_HEADERS_AND_RELEASE_IDENTITY.md`](C6_T5_CSP_SECURITY_HEADERS_AND_RELEASE_IDENTITY.md) |
| Included | **The removal of the API's default HSTS header** (Helmet's one-year `includeSubDomains` policy). Neither service sends HSTS. **Activation stays reserved for P9**, by its own owner decision |

**Kept open for hosting:** R8 (the policy with no violation on the host), R14 (the release header equals the deployed SHA on both services), S12 (Safari console under the policy).

The T5 canonical proposals (record §5) remain **proposals** under Doc 00 §5 until adopted.

## 2. D-4a — approved

**D-4a** (plan r3 §11): the error-monitoring service is **Sentry**, integrated locally now. The plan (free or Team) and the data region (the plan recommends Germany) are chosen at provisioning (step 6). Scope of the integration, from plan §4.5: the backend and the document server only, tagged with the commit and the environment; **no browser error capture in C6**; redaction proven by a marker test.

Not authorised by D-4a: creating a Sentry account or project, a DSN, remote delivery, alerts. These stay open until the owner provisions them.

## 3. D-9 — approved

**D-9** (plan r3 §5.1, §11), as recommended:

- the résumé copy job is a **scheduled GitHub Actions workflow** in a protected environment, with two narrowly scoped storage tokens;
- the per-snapshot **manifest** and the **deletion log** live in a separate, locked bucket, apart from the database and both résumé buckets;
- the copy is **hourly**, not copy-at-write (the first hosted rehearsal may show that the window matters, which would reopen this).

The snapshot states and the two rehearsals are those of the plan r3 correction 1: UNASSESSED; PRELIMINARY: NO DEFECT FOUND; PRELIMINARY: DEFECT FOUND (n); RECOVERY VERIFIED; RECOVERY FAILED. A live-database manifest is preliminary; only a restore can verify.

Not authorised by D-9: creating the workflow on GitHub, the protected environment, the tokens, the buckets or their locks.

## 4. C6-T6 — authorised (local only)

**Scope:** plan steps **2e** and **2f** together, as one local assignment:

1. this record;
2. Sentry in the API and the document server, proven against a local receiver with synthetic markers; disabled monitoring and an unavailable receiver; start-up, outcomes and the accepted CSP unchanged;
3. the CI workflow files (minimal permissions, SHA-pinned actions, no secrets for untrusted pull requests), validated and their commands run locally; the read-only Review checker with the R0/G-ACCESS and R1–R14 mapping, exercised against a local stack; runbooks for the first hosted run, failure handling and rollback;
4. the hourly copy, the manifest, the separately protected deletion log and the restore procedure, with their own access boundary, exercised with interrupted and repeated runs and through both rehearsals (damaged and healthy snapshot);
5. one handoff for independent review.

**The accepted T2–T5 decisions govern** wherever older plan text differs (for example: the Jobs API and document cache contracts of T2, the private-Review refusal of T3, the version-bound deletion of T4, the CSP and release header of T5, no HSTS before P9).

**Outside this authorisation:** GitHub writes or workflow dispatch, provider purchases or provisioning, deployment, DNS, live email, production changes and modifications to `C:\ME\Valida`. Production candidate acknowledgements stay disabled. The genuine vacancy stays Draft through E6.

## 5. Still open, tracked separately

- **D-4b** (storage provider): the accepted T4 driver requires bucket versioning; the plan's R2 recommendation does not offer it (dependency note after T5, §2). Decided before provisioning.
- G-ACCESS (H1–H9) for each real hostname; the T4 hosting checks; canonical adoption of the T1–T5 proposals; delegated-read rate limiting; the `mongoose` advisory; Safari on real devices.
