# C6 hosting-stage assignment (proposed; for separate authorisation act by act)

| | |
| --- | --- |
| Status | **PROPOSED.** This is planning only: nothing here is executed or authorised by its existence. Each act in §5 needs the owner's own written authorisation, naming the SHA, the act and its limits |
| Base | Accepted local C6-T6 `aa92ed545d47bad73c2b26ead519807ad2443e17` (owner record 2026-11-18-02). The code tree of the Review/release candidate equals it; only documentation was added on top |
| Supersedes | The proposal revisions 1 and 2 of 2026-11-18 (`claude/valida-C6-hosting-stage-proposed-assignment.md`); C6 plan r3 §3 where provider facts have changed (R2 is no longer viable) |
| Governing | Doc 18 §§173–187; Doc 15 (OPS-001–OPS-090, §281; §7 re-check before purchase); Doc 13 §§31–36, 136–137, 288, 310, 313; Doc 14 with the approved Titan amendments; Doc 17 §§352–368; C6 plan r3 with correction 1; runbooks `C6_RUNBOOK_FIRST_HOSTED_RUN.md` and `C6_RUNBOOK_FAILURE_HANDLING.md` |
| Verification | Provider facts were read on **2026-11-18 UTC** (2026-11-17 evening, Vancouver). The labels: <br>- **[V]** official page, read on that date; <br>- **[V-r3]** official page read on 2026-11-15 for plan r3 and not re-read; <br>- **[S]** a secondary source, not relied on as proof; <br>- **[A]** an assumption to confirm in Review; <br>- **[P]** a proposed choice for the owner's decision. <br>Doc 15 §7: prices are re-checked immediately before each purchase |
| Execution | The owner executes every provider, GitHub and DNS act and types every secret. Claude supplies steps, reads public results and checks evidence. **No credential is ever sent in chat** |

## 1. Recommended providers and region

**Recommendation [P]: one EU region, Frankfurt.**

| Function | Provider | Region | Why |
| --- | --- | --- | --- |
| API + document server (×2 environments) | **Render**, paid web services, Hobby workspace | Frankfurt [V] | Accepted in plan r3 (D-2): auto-deploy Off, deploy of a specific commit, `RENDER_GIT_COMMIT` [V]; paid instances can reach Titan's SMTP ports (§3) |
| Database | **MongoDB Atlas Flex** (Review and Production through C7; M10 decided before Release E, D-3) | AWS Frankfurt | Daily snapshots, restorable; Germany clusters keep snapshots in Germany [V] |
| Private résumé storage, the copy and the log buckets | **AWS S3** | `eu-central-1` (Frankfurt) | The only candidate verified to support every feature the accepted driver uses (§2) |
| Error monitoring | **Sentry**, EU data region | Frankfurt (events) | D-4a approved; EU storage chosen at org creation, not changeable [V] |
| Uptime | UptimeRobot free | not verified | Plan r3 [V-r3]; Doc 18 §174 |
| Email | **Titan / Bluehost (approved; unchanged)** | not verified (Titan offers EU-hosted accounts [S]; Valida's account location unknown) | OD-2026-10-26-01; no provider change is proposed |
| CI | GitHub Actions (public repository) | not verified | Synthetic data only |

**Alternative (concise): one US-West region.**
- Render Oregon [V region list], Atlas AWS `us-west-2` (a USA Flex cluster keeps its snapshots in the USA [V]), S3 `us-west-2` and Sentry US.
- Latency would be lower for Vancouver; personal data would sit in the USA instead of Germany.
- The same storage provider (S3) applies; no other storage provider is verified compatible (§2).
- Hosts, clusters and buckets cannot be moved after creation, so D-1 is decided once.

## 2. Storage compatibility with the accepted driver

The driver (`backend/src/integrations/storage/s3PrivateStorage.js`, `backend/src/ops/backup/*`) signs with SigV4 and needs the features below. Each must be confirmed against the real provider in Review (act C, check S1–S8).

| Feature the driver uses | AWS S3 | Backblaze B2 | Cloudflare R2 |
| --- | --- | --- | --- |
| Bucket versioning; version id on PUT/HEAD | Yes [V: Object Lock page, "works only in buckets that have S3 Versioning enabled"] | Always versioned [V] | **Unimplemented** [V] |
| HEAD / DELETE by `versionId` (version-bound deletion) | Yes; a DELETE with a version id is permanent, and on a locked version it is refused 403 [V] | Yes [V] | Not listed [V] |
| Conditional create `If-None-Match: *` on PUT (no overwrite) | Yes: PutObject, CompleteMultipartUpload, CopyObject; a current version leads to 412; a concurrent delete may give 409 [V] | **Rejected**: "Backblaze B2 does not allow to set the `If-None-Match` http header for put requests" [S: Proxmox patch, 2025-07]; not documented on B2's S3 page [V] | — |
| `x-amz-checksum-sha256` (copy integrity) | Yes, validated server-side and stored [V] | Unsupported checksum headers reported [S] | — |
| Object Lock (copy and log buckets), default retention | Yes: governance and compliance modes, default retention in days or years [V] | Yes [V] | **Unimplemented** [V] |
| Private by default | New buckets: Block Public Access on, ACLs disabled [V] | — | — |
| Least-privilege credentials per role | IAM policies per action and bucket, e.g. `s3:PutObject` without `s3:DeleteObject`, and no `s3:BypassGovernanceRetention` [V: permission names] | Multi-bucket keys, `deleteFiles` separate [V] | — |

**Verdict:**
- **AWS S3 is recommended.**
- B2 is excluded because of the conditional-write evidence. The evidence is secondary, but B2 does not document support, and the driver depends on it to refuse overwrites.
- R2 is excluded, on official evidence.

**To confirm in Review [A]:**
- the driver's default **path-style** URLs against `https://s3.eu-central-1.amazonaws.com` (the path the tests exercise; virtual-host style exists in the code but has no test);
- the SigV4 behaviour of the driver's own HTTP client.

**The roles and their boundaries** (`backupConfig.js`): each role is its own IAM user with its own access key [P]. Static keys are what the driver takes; they are rotated on suspicion of exposure.

| Role | Buckets | Allow | Never |
| --- | --- | --- | --- |
| API | primary | Put (new), Get, Head, Delete by version, List | copy and log buckets |
| copier | primary (read), copy (write new), log (write new) | Get/Head/List on primary; Put on copy and log | Any delete; retention bypass |
| manifest | primary (Head), copy and log (read); log (Put new, `manifests/`); a **read-only** database user | Head; Get/List; Put on log only | Any delete; any database write |
| log-writer | log | Put (append) | Any delete |
| restorer | copy, log (read); restore bucket (write) | Get/List; Put on the restore bucket only | Any delete on copy/log |

**Object Lock, retention and replay** (D-9; plan r3 correction 1):
- **Locks:** the copy and log buckets are created with Object Lock. **Review: governance mode, a 2-day default** [P], so rehearsal resources can be removed; it still proves enforcement, because a version-specific DELETE without bypass is refused (check S7). **Production: the lock length is at least the snapshot retention (8 days) plus a margin**, e.g. 14 days [P]. The mode is decided at the Production stage; compliance mode cannot be shortened, and only deleting the account removes it early [V].
- **Deletion and the locks:** an authorised deletion removes the primary version (the primary is unlocked) and appends to the locked deletion log. A restore **replays every log entry**, so a deleted applicant is not resurrected from the locked copy (runbook 2 §§5–6).
- **Restore:** the restore targets are a **new** Atlas cluster and a **new**, empty, versioned bucket. The command refuses the live ones. The verdict must be **RECOVERY VERIFIED**, followed by indexes, a refused unauthenticated object read, and readiness in closed mode.

## 3. Email (Titan, approved)

- **Transport:** Titan's scripts guidance: `SMTP.titan.email`, port 465 SSL, or 587 STARTTLS [V]. AMD-TITAN-03 uses implicit TLS on 465.
- **Render:** SMTP ports are blocked on free web services; paid instances can use 465 and 587 [V, read 2026-11-17]. Both Review services are therefore paid.
- **Credentials:** separate per environment (Doc 14 §185). Live tests should use a non-production identity where possible (AMD-TITAN-05(d)). **Owner decision D-13** (§7): which Titan identity and application password Review uses.
- **Production acknowledgements stay disabled.** Review sends only the internal notification, plus a bounded test.

## 4. Where data is, service by service (recommended EU set)

| Service | Data | Personal data | Location | Status |
| --- | --- | --- | --- | --- |
| Render API / documents | Requests in transit; logs (redacted) | In transit only | Frankfurt compute [V]; **log storage location not verified** | Partly verified |
| Atlas | Jobs, Applications, suppression register (keyed hashes) | **Yes** | AWS Frankfurt; snapshots in **Germany** [V] | Verified |
| S3 primary, copy, log | Résumés, their copies, the deletion log and manifests (one-way references) | **Yes** | `eu-central-1` (Frankfurt) [P region; S3 regions exist A] | To confirm at creation |
| Sentry | Error events (redacted; marker-tested) | None by design | Events in Frankfurt; **accounts, settings and tokens always in the US** [V] | Verified |
| Titan / Bluehost | The internal notification (Application reference only) | None in C6/C7 | **Not verified** | Open |
| GitHub | Source, CI logs, audit artifacts (public repository) | None (synthetic) | **Not verified** | Open |
| UptimeRobot | URLs, status codes | None | **Not verified** | Open |
| DNS provider | The zone | None | AWAITING INPUT (which account holds it) | Open |
| Operator machine (rehearsal, §6) | Restore transit of **synthetic** objects and records | None | The owner's location | By design |

**Statement that can be made:** candidate personal data at rest would be in Frankfurt (database, S3) and Germany (snapshots). It is not "everything in one region": Sentry account data is in the US, and four locations are unverified.

## 5. The execution sequence

Each arrow is a stop. Nothing moves to the next act without the owner's written authorisation of that act.

```
accepted local SHA (aa92ed5; candidate = acceptance-record commit, same code tree)
 → P1  branch publication (authorised separately)
 → P2  pull request c6-work → main as a CI vehicle, not merged (separately)
 → C   private Review provisioning (separately)
 → D   Review deployment of the CI-green SHA (separately)
 → G   G-ACCESS (R0), every hostname, BEFORE any synthetic Job
 → F   functional / security / monitoring checks (R1–R14, Sentry, alert)
 → B-R real-provider backup/restore rehearsal in Review (separately)
 → E   bounded live-email checks in Review (separately)
 → M   required manual checks (Safari, Lighthouse R12, screen captures)
 → RG  owner acceptance of the Review/release SHA
 → I   main integration (separately) — then Production stages (separately) — then C7
```

**The backup/restore rehearsal (B-R) comes before RG and before `main` integration.** No mandatory Review gate is deferred: R0–R14, monitoring, the rehearsal, email and the manual checks are all inputs to RG.

## 6. How the Review rehearsal runs without `main`, and why no schedule can run

**The dependency.** The backup jobs exist as GitHub workflows, but GitHub can run neither of their triggers before `main` integration:
- **Schedules run only from the default branch.**
- **"To trigger the `workflow_dispatch` event, your workflow must be in the default branch"** [V].
- `main` is `e2c7ce7`, which has **no `.github/workflows/` directory at all** (checked: `git ls-tree e2c7ce7 .github/workflows/` is empty).

**The resolution [P].** The Review rehearsal uses the same code, at the same SHA, as **operator-run commands**, not GitHub Actions:
1. The owner makes a **fresh clone** of the published SHA in a new folder. This is not `C:\ME\Valida` and not the development workspace.
2. In that clone's `backend/`, the owner runs `npm ci`. The Review-only role variables go in a local `.env`; `.env` is git-ignored, and the scripts read it with `--env-file-if-exists`. **Review keys and Review buckets only**: never Production values, never in chat, never committed. The file is deleted after the rehearsal.
3. The commands are `npm run ops:backup:copy`, `ops:backup:manifest`, `ops:backup:delete-application` and `ops:backup:restore` (`backend/package.json`), following runbook 2 §§4–6 and plan r3 correction 1, **both** rehearsals: damaged and healthy snapshot.
4. Atlas network access: the operator's address is added to the **Review** project's access list for the rehearsal only, then removed.
5. Temporary resources (a restore-target cluster, a restore bucket, a throwaway API in `RECRUITMENT_MODE=closed`) are destroyed afterwards, with screenshots as evidence.

**Unapproved scheduled execution is prevented before `main` integration by:**
- (a) the default-branch rule above;
- (b) no `backup` environment and no backup secrets existing in GitHub;
- (c) the backup workflows having no `pull_request` or `push` trigger, so the PR in P2 runs only `ci` and `e2e`.

**At and after `main` integration (act I):** the Production backup schedule stays **separately authorised**. Before act I:
- the owner creates the `backup` environment with deployment branches `main` only and a **required reviewer** (the owner), and **no secrets** (B0). A run that references the environment then waits for approval [V: GitHub environments; a missing environment would otherwise be auto-created];
- immediately after act I, the owner disables `backup-copy` in Actions until the activation decision (D-11) and its own authorisation.

## 7. Requirement → action → evidence → gate → rollback

| Requirement | Action (act) | Evidence | Acceptance gate | Rollback / stop |
| --- | --- | --- | --- | --- |
| Doc 18 §178; Doc 13 §136 | P1 publish `c6-work`; P2 open the PR (not merged) | The remote ref equals the SHA; CI run URLs naming the SHA; `ci/backend` and `ci/frontend` **PASS WITH APPROVED EXCEPTION** with the `audit-*` artifacts; storage-double, e2e guards green; `e2e` recorded | All `ci` jobs green on that SHA | Red: no deploy; fix by a new commit. Delete the remote branch if publication is withdrawn (no rewrite) |
| Doc 18 §§176–177; Doc 15 OPS | C: Review: Atlas Flex, S3 buckets (primary versioned; copy and log versioned with Object Lock), IAM users per role, two Render services connected to `c6-work`, auto-deploy Off, edge caching None, secrets typed by the owner | Provider screenshots, addresses redacted; IAM policy JSON (no keys) | Settings match §2 | Delete the resources (synthetic only) |
| Storage compatibility | D, then S1–S8 against the real bucket: <br>S1 the API starts (it refuses without versioning); <br>S2 PUT gives a version id; <br>S3 a second PUT with `If-None-Match` gives 412; <br>S4 HEAD by version; <br>S5 DELETE by version, then 404; <br>S6 the checksum is stored; <br>S7 a locked delete is refused; <br>S8 an unauthenticated GET is refused | Command output with one-way references, no keys | All 8 pass | Stop; D-4b reopens |
| Doc 18 §179; T5 R14 | D: deploy the CI-green SHA via *Deploy a specific commit* [V] | Deploy records; start-up lines; `X-Valida-Release` = SHA on both | R14 | Redeploy the prior SHA; a failed deploy keeps the previous one [V] |
| G-ACCESS (plan r3 §4.6.5) | G: runbook 1 §3, rows 1–10, every hostname, listed and unlisted | `mapping.json`, checker folders, operator rows | Every row passes **before any synthetic Job** | Stop; `RECRUITMENT_MODE=closed` |
| Phase 1 functions; Doc 13 §313; Doc 16 | F: synthetic Jobs; R1–R14; CSP (R8); Sentry test events, R13 marker, one alert | Checker results; Sentry screenshots | All pass | Unpublish synthetic Jobs; `SENTRY_DSN` empty |
| Doc 18 §180; D-9; plan r3 correction 1 | B-R: §6, the damaged and healthy rehearsals | Copy `complete:true`; manifest `PRELIMINARY: NO DEFECT FOUND`; restore **RECOVERY VERIFIED**; deletion-log replay shown; measured RPO/RTO | Both rehearsals give their expected verdicts | Stay closed; destroy temporary resources |
| Doc 14; AMD-TITAN-03/-04/-05(d) | E: bounded sends from Review (D-13) | Relay acceptance per message, headers with addresses redacted, the bounce review entry | The count and window as authorised; nothing else sent | Remove the Review mail credential |
| Doc 17 manual | M: Safari (macOS and iOS), Lighthouse (R12), screenshots | Versions, captures | No blocker | Defect: fix by a new commit; CI and the deploy repeat |
| Release gate | RG: one package at **one SHA** | Everything above | **Owner's written acceptance** | Not accepted: `main` unmoved |
| Integration | B0, then I: fast-forward `main` to the RG SHA; `backup-copy` disabled at once | `ci` on push green; screenshot of the workflow disabled | — | Correct by a new commit, never by force |
| Production stages, C7 | Separately planned and authorised (domain, Production services, backup activation D-11, C7 synthetic) | Doc 18 §179, §185 | C7 master gate | Per stage |

## 8. Costs (USD; list prices as read; taxes excluded)

**Assumptions:**
- one small instance per service;
- traffic within the allowances;
- no dedicated IPs.

**Exclusions:**
- sales taxes (e.g. GST/PST, by billing country), which depend on the owner's billing details;
- currency conversion;
- the existing Titan/Bluehost and domain subscriptions.

Billing is in arrears. Render is "prorated to the second" [V]; Atlas Flex is billed hourly [V].

| Monthly | Review | Production (through C7) | Source |
| --- | --- | --- | --- |
| Render: API + documents | 2 × $7 = **$14** (Hobby workspace $0; 5 GB bandwidth, then $0.15/GB) | **$14** | [V] |
| Atlas Flex | **$8** base (≤100 ops/s), capped at **$30** | **$8–$30** | [V] |
| S3 (primary, copy, log; megabytes of synthetic data) | **< $1** expected [A: the Frankfurt per-GB and request prices were not readable from the official page this round]. New AWS customers get up to $200 in credits [V] | **< $1** at C7 volume [A] | [V] partial |
| Sentry Developer (1 user, 5k errors) | **$0** (Team $29/month, or $26 annually, if more seats) | shared org [A] | [V] |
| UptimeRobot | $0 | $0 | [V-r3] |
| GitHub Actions (public repository) | $0 | $0 | [V-r3] |
| **Total** | **≈ $22–$45** | **≈ $22–$45** | |

From Release E, Atlas M10 starts at $56.94/month [V-r3], decided at D-3.

**Each restore rehearsal (temporary):**

| Resource | Life | Cost |
| --- | --- | --- |
| Restore-target Flex cluster | ≤ 3 days | $0.0110/h → **≈ $0.79** (≤ $2.96 at the cap rate) [V]. If a Flex snapshot cannot be restored to a Flex cluster [A: only "replica sets" is documented], M10 ≈ $0.08/h → ≈ $5.76 [V-r3] |
| Restore bucket | hours | cents [A] |
| Throwaway API (closed mode) | hours | ≈ $0.01/hour, prorated [V] |
| **Per rehearsal** | | **≈ $1–$9** |

**Proposed spending caps [P]** (alert thresholds; these providers bill usage, so they are not hard stops [A]):
- Review ≤ **$50/month**;
- Production through C7 ≤ **$50/month**;
- each rehearsal ≤ **$15**.

Exceeding a cap means stop and report.

## 9. Owner decisions still open

| ID | Decision | Recommendation | Needed by |
| --- | --- | --- | --- |
| D-1 | Region | Frankfurt (EU) set; alternative US-West | C |
| D-4b | Storage provider | **AWS S3** (§2); new account with root MFA and IAM users per role | C |
| D-4a (plan, region) | Sentry plan and data region | Developer (free), **EU** | F |
| D-12 | Review hostnames and the tester allowlist | Owner's values, typed at the host only | C |
| D-13 | Titan identity for Review email checks; recipients; count and window | A Review-only credential (a separate mailbox or application password, per Titan's options), owner-controlled recipients, ≤ 10 messages in one window | E |
| D-14 | Rehearsal operator location | A fresh clone on the owner's machine (§6) | B-R |
| D-15 | Review lock mode and length | Governance, 2 days | C |
| D-16 | Spending caps | §8 | P2/C |
| D-10 | Repository settings | Secret scanning and push protection at P1; required `ci` and protected `main` before I | P1 / I |
| Exception | GHSA-fc5q-39xc-vjpf expiry 2026-12-18T05:31:00Z | Remediate when a patched release appears, or decide anew. **CI fails after the expiry**: P2 and RG must finish before it, or be re-run after remediation | Before 2026-12-18 |
| D-11 | Production backup activation | Later; B0 before I | I |

## 10. Sources (read 2026-11-18 UTC unless marked)

- Render: [Deploys](https://render.com/docs/deploys); [Environment variables](https://render.com/docs/environment-variables) (`RENDER_GIT_COMMIT`); [Pricing](https://render.com/pricing). SMTP ports on free instances: Render documentation, read 2026-11-17 in this assignment's preparation.
- GitHub: [Manually run a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow); [Manage environments](https://docs.github.com/en/enterprise-server@3.20/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) (environment auto-creation, protection rules).
- AWS S3: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html); [Object integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.md); [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.md); [Default bucket security](https://aws.amazon.com/about-aws/whats-new/2023/04/amazon-s3-security-best-practices-buckets-default); [Pricing](https://aws.amazon.com/s3/pricing/) (no regional per-GB figure was readable).
- Backblaze B2: [S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api); [Application keys](https://www.backblaze.com/docs/cloud-storage-application-keys). [S] [Proxmox pbs-devel patch on B2 and `If-None-Match`](https://lists.proxmox.com/pipermail/pbs-devel/2025-July/014234.html).
- Cloudflare R2: S3 API compatibility page (read 2026-11-17).
- MongoDB Atlas: [Flex costs](https://mongodb.com/docs/atlas/billing/atlas-flex-costs); [Flex cluster backups](https://www.mongodb.com/docs/atlas/backup/cloud-backup/flex-cluster-backup.md).
- Sentry: [Pricing](https://sentry.io/pricing/); data storage location page (read 2026-11-17).
- Titan: [Configuring Titan on email scripts](https://support.titan.email/hc/en-us/articles/4405162224665-Configuring-Titan-on-Email-Scripts).
