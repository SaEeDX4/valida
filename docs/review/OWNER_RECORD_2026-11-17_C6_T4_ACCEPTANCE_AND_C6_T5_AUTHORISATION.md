# Owner record 2026-11-17 — C6-T4 accepted (at correction 2); D-6 approved; C6-T5 authorised

| | |
| --- | --- |
| Date | 2026-11-17 |
| Decided by | Saeed (owner), after Astra's review of C6-T4 and its corrections 1 and 2 |
| Source | The owner's instruction "Execute C6-T5 locally. The owner has approved D-6 and the full T5 scope" (2026-11-17), which names the accepted local `c6-work` baseline |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |
| Governing | Doc 00 §5 (change control); Doc 13 §146; Doc 17 QA-040; Doc 18 C6 (§§173–179); C6 plan revision 3, §10 steps 2b and 2d, §8.4, §11 (D-2, D-6) |
| Not an owner-decision identifier | No new `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. C6-T4 — accepted

| | |
| --- | --- |
| Accepted commit | **`16119a71e3f78435c32c8f6846b799b189e5c010`**, tree **`71f3b2d5d43cae73dd817d3ae384a4a83634458c`** — C6-T4 with correction 1 (ownership after uncertain writes, conclusive start-up privacy check, validated listings) and correction 2 (every deletion bound to the exact object version observed) |
| Record | [`C6_T4_S3_PRIVATE_STORAGE.md`](C6_T4_S3_PRIVATE_STORAGE.md), §§5–6 |
| Evidence | The C6-T4 handoff and the correction-1 and correction-2 handoffs (outside the repository), unchanged |

**Kept open for hosting (not verified locally):**

- the real provider's bucket versioning;
- version-specific deletion (HEAD and DELETE by `versionId`, the `s3:GetObjectVersion` and `s3:DeleteObjectVersion` permissions);
- how versioning interacts with lifecycle rules, retention, restore and noncurrent copies;
- the provider's access policy, encryption at rest, region or jurisdiction, and its `If-None-Match`, checksum and `ListObjectsV2` behaviour.

The requirement that the S3 bucket have versioning enabled (`VERSION_BOUND_DELETE`) remains a **proposal** against Doc 15 and the Doc 13 token permissions until the owner adopts it under Doc 00 §5.

## 2. D-6 — approved

**D-6** (C6 plan r3 §11): a release header on both services, stating the deployed commit (plan §8.4, reading 2). Approved as recommended. The header exposes a public commit id and changes no documented response body.

## 3. C6-T5 — authorised (local only)

**Scope:** plan steps **2b** and **2d** together.

- **2b.** Inspect the document server's actual routes, asset and API origins, structured data and current headers. Implement an enforced Content-Security-Policy and the applicable document security headers (Doc 13 §146; Doc 17 QA-040). Preserve the accepted C4 SEO behaviour, the C5 application flow, the T2 cache decisions and the T3 private Review access. **HSTS activation belongs to the later P9 owner decision.**
- **2d.** One consistently named release header on the API and the document server. The full commit SHA comes from trusted build or start-up configuration (plan §8.4). Valid, absent and malformed configuration are covered on both services. Ordinary local start-up is preserved, and no request-supplied value can determine release identity.
- **Verification** through the real local HTTP entry points and Chromium: representative success, redirect, private-Review refusal and error responses; required resources load; the synthetic Careers → Job Detail → Apply flow works; the browser blocks a harmless resource the policy disallows; SEO, cache behaviour and release identity where affected. Unaffected evidence is reused.
- One review package, and a short dependency and owner-decision note for the remaining C6 work.

D-2 (the document server is the frontend host) is the basis of step 2b, as plan §10 records.

**Outside this authorisation:** GitHub writes, provisioning, purchases, deployment, DNS, production changes, live email, and changes to `C:\ME\Valida`. Later C6 implementation needs a separate approval. Production candidate acknowledgements stay disabled. The genuine vacancy stays Draft through the Release E gates, including E6.

## 4. Still open, tracked separately

- G-ACCESS (H1–H9) for each real hostname.
- Canonical adoption of the T1–T4 proposals (and of any T5 proposal).
- The T4 hosting checks in §1.
- Delegated-read rate limiting; the `mongoose` advisory; Safari on real devices (OPEN).
