# Owner record 2026-11-17 (third) — C6-T6 CI remediation authorised (local)

| | |
| --- | --- |
| Date | 2026-11-17 (America/Vancouver) |
| Decided by | Saeed (owner) |
| Source | The owner's instruction "Valida — consolidated local C6-T6 CI remediation" (2026-11-17), continuing from `e743e898a63fb64de59eb2f4b49203b07bec2667` on `c6-work` |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |
| Governing | Doc 00 §5 (change control); Doc 13 §§133–134 (dependencies), §313; Doc 15 §7; Doc 17 (evidence); C6 plan r3 §6; the C6-T6 record and its correction 1 |
| Not an owner-decision identifier | No `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. Authorised (local only)

1. **Dependency remediation.**
   - Re-verify the advisories and releases.
   - Apply the smallest supported **`mongoose`** upgrade that resolves GHSA-gg4r-jv3p-qx3c, GHSA-8332-j7wj-wjw4, GHSA-wr5m-5jph-8m96 and GHSA-6972-9mcm-vhwj (9.11.4 if still appropriate), including the lock-file changes it requires.
   - Investigate the `picomatch` and other tooling findings, and apply compatible patched releases where they exist.
   - **Not permitted:** `npm audit fix --force`, an unsupported downgrade, disabling or weakening the audit, or an unapproved exception. Where no supported fix exists, report the paths, exposure, upstream status and the smallest decision needed.
2. **CI image pinning.** Verify the `mongo` image digest against an authoritative registry if it can be reached, then pin both workflows. A digest is never invented, and a secondary-source value is never described as registry-verified. If the registry is blocked, record the exact failure and give one owner-side verification command.
3. **Verification.**
   - Run the backend offline and real-database suites, plus focused checks only where the dependency changes reach.
   - Re-run the audits, actionlint and zizmor.
   - Reuse unchanged evidence, stating why.
   - Keep failing logs and report actual exit codes.
4. **Documentation and handoff.**
   - This record.
   - The clarification that matching size and SHA-256 establishes **content equality**, not independent ownership identity. The deletion implementation is **not** expanded here.
   - One package for review.

## 2. Unchanged

- **C6-T6 acceptance stays pending.** Hosted verification and the adoption of canonical proposals remain separate decisions.
- **Outside this authorisation:**
  - unrelated refactoring and history rewriting;
  - any GitHub push, pull request or workflow dispatch;
  - provisioning, purchases, deployment, DNS, live email and production changes;
  - any change to `C:\ME\Valida`.
- Production candidate acknowledgements stay disabled. The genuine vacancy stays Draft through E6.
