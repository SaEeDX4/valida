# Personal-data and provider inventory — recipient suppression entries (B7)

| | |
| --- | --- |
| Status | **Minimal entry — B7 r3 review correction (finding 4).** It records what the B7 recipient-suppression code actually stores, logs and needs, so that SUP-6 ("the entry is listed in the inventory") is met. Production inputs that have not been decided are marked **AWAITING INPUT**; nothing here is invented. |
| Governing text | Doc 13 §173 (data subjects), §§177–178 (purpose limitation, minimisation), §§183–184 (access), §§186–187 (storage limitation; retention **AWAITING**), §190 (privacy deletion workflow), §192 (data access request), §§197–198 (cross-border processing; provider inventory), §§199–201 (provider change, contracts, legal applicability); Doc 14 §§174, 178; design [`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) §§3.1, 3.3, 4 (rev 8.2) |
| Scope | Only the entries B7 adds. The inventory Doc 13 §198 requires as a whole — for example Applications, resume objects and the corporate email backup entry proposed as AMD-OD-02 (`OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`) — is **not** part of B7 and is not entered here. |
| Checked by | `backend/tests/b7-suppression-inventory.test.js` (offline, in `verify:b7`): every field the two suppression models store is listed in §1, and every pending production input is marked. |
| Not | A privacy legal assessment, a Privacy Notice or a retention decision. Those stay open (§3). |

## 1. Data entries

### 1.1 `recipient_suppressions` (MongoDB collection; Doc 10 addition)

| Item | Entry |
| --- | --- |
| Data subjects | Candidates (Doc 13 §173) whose acknowledgement address was **confirmed** permanently invalid (relay refusal or DSN with 5.1.1, 5.1.2, 5.1.3 or 5.1.10), or who complained, or for whom a provider suppression notice was verified (design §2). |
| Purpose (Doc 13 §177) | Stop **future candidate acknowledgements** to that address (Doc 14 MAIL-042–044; design §1). It is used for nothing else: no profiling, no recruitment decision, no effect on Application acceptance or the internal notification. |
| Personal data held | **Pseudonymous** (Doc 13 §178; design §4.1). No plaintext address, name, DSN text, provider reply text or subject is stored. The keyed digest is still personal data. |
| Fields | `_id` (the suppression id the command prints). `lookup.keyId`, `lookup.digest` — the current keyed HMAC-SHA-256 digest of `candidate.emailNormalized` and its key id. `lookups` (`keyId`, `digest`, `retiredAt`) — the same digest under every key the entry is still matchable under: the primary and, for at most `ALIAS_QUIET_PERIOD_MS` after a key move, the previous one (rev 8.2). `scope`, `state`, `reason`. `basis.kind`, `basis.statusCode` (an enhanced status code such as `5.1.1`), `basis.evidenceRef` (a bounce-log reference, never an address). `sources` (`applicationId`, `attempt`, `messageToken` — the r9 Message-ID token, derived, 32 hex) — at most 10. `duplicateReports`. `history` (`at`, `action`, `actor` — an operator identifier token, `reason`, `evidenceRef`, `decisionRef`, `requestId`) — at most 20. `createdAt`, `updatedAt`, `version`. |
| Source | The operator command (`npm run ops:notifications:suppression`), from a **stored** Application's `candidate.emailNormalized` and its recorded acknowledgement outcome or a correlated DSN token. No address is typed in. |
| Storage | The application's MongoDB database, the same database as Applications. **Production MongoDB hosting provider and region: AWAITING INPUT** (C6 provider selection; Doc 15 §§260–268). |
| Provider, contractual / privacy role, transfers (Doc 13 §§197, 200–201) | **AWAITING INPUT** — decided with the production MongoDB provider (C6): provider, storage / processing location, contractual role and any transfer requirement. |
| Access (Doc 13 §§183–184) | Writes: only an operator with production command access (hosting access plus the database secret) **and** an identifier listed in `SUPPRESSION_OPERATOR_IDS`. **Production operator tokens: AWAITING INPUT** (C6 prerequisite). Reads by the acknowledgement path: an equality lookup only. Phase 3: the Admin permission `notifications:suppression:manage` with an AuditEvent (design §3.4). Command output never shows an address or digest. |
| Retention (Doc 13 §§186–187) | **AWAITING PRIVACY / LEGAL / OPERATIONAL DETERMINATION.** No automatic deletion and no TTL until a retention decision exists (design §4.3). An entry may outlive its source Applications when a source is removed for retention; it then stays `ACTIVE` without a source. |
| Deletion (Doc 13 §190) | `forget --application <id> --reason PRIVACY_REQUEST\|RETENTION --evidence-ref <ref>`: removes that source; for a privacy request with no source left, deletes the entry (which re-enables acknowledgements to the address). The register is a step of the coordinated deletion workflow (Doc 13 §190), which is itself not yet built. |
| Data access request (Doc 13 §192) | Found only through the person's stored Application: `check --application <id>` (`ACTIVE` / `LIFTED` / `NONE`). An address is never accepted as input. |
| Backups | Contained in the production MongoDB backup. **Backup design and the reconciliation of deleted entries (Doc 13 §190, last step): AWAITING INPUT** (C6). |

### 1.2 `recipient_suppression_keys` (MongoDB collection; Doc 10 addition)

| Item | Entry |
| --- | --- |
| Data subjects | Operators (Doc 13 §173, Admin users), through identifier tokens only. |
| Purpose | Prove that each configured key's bytes are the bytes registered under its id (design §4.5.1). |
| Fields | `_id` (the key id), `check` (HMAC of the key id under the key; reveals nothing about any address or the key), `state`, `recovery` (`decisionRef`, `evidenceRef`, `reason`, `startedAt`, `startedBy`, `startCount`, `completedAt`, `completedBy`), `createdBy`, `requestId`, `createdAt`, `updatedAt`, `version`. |
| Storage, provider, access, retention | As §1.1 (same database; the same **AWAITING INPUT** items). Retained for as long as any entry or alias under the key id may exist; `RECOVERING` and `RETIRED` documents are kept permanently so an id is never trusted again (design §4.5.1). |

### 1.3 Application field `lastStatusCode` (notification channels)

| Item | Entry |
| --- | --- |
| Data | `notifications.<channel>.lastStatusCode`: the enhanced status code of a relay refusal (for example `5.1.1`), validated against `^[245]\.\d{1,3}\.\d{1,3}$`; never provider text (design §3.3; Doc 10 §122). |
| Data subjects, purpose | The candidate of that Application; delivery status (Doc 14 §178), used only to check `add --from-refusal` eligibility. |
| Storage, retention, deletion | Part of the Application document: the same provider, retention (**AWAITING**, Doc 13 §187) and deletion as the Application. |

### 1.4 Key material (secret; not stored in the database)

| Item | Entry |
| --- | --- |
| Variables | `SUPPRESSION_HMAC_KEY`, `SUPPRESSION_HMAC_KEY_ID`, `SUPPRESSION_HMAC_PREVIOUS_KEYS` (design §4.2, §5). Not personal data, but whoever holds a key and the register can confirm guessed addresses (design §4.2 "Compromise"). |
| Location | The production host's secret store — **production hosting provider: AWAITING INPUT** (C6). The protected second copy outside the host — **location: AWAITING INPUT** (owner decision; design §4.2). Never in Git, chat, logs, screenshots or a ZIP (Doc 13 §§112–117). Development and tests use synthetic keys only. |

### 1.5 Logs and command output

| Item | Entry |
| --- | --- |
| Content | Application id, channel, suppression `_id`, key ids, counts, fixed codes and request id only — never an address, digest, key or check value (Doc 13 §§118–121; design §4.3; SUP-6, SUP-22f). |
| Storage, retention | The application log destination — **production log provider and retention: AWAITING INPUT** (C6; Doc 13 §187). |

## 2. Providers

| Provider category (Doc 13 §198) | Personal data from this entry | Status |
| --- | --- | --- |
| MongoDB hosting | §§1.1–1.3 | **AWAITING INPUT** (C6) |
| Hosting (secret store, logs) | §§1.4–1.5 | **AWAITING INPUT** (C6) |
| Transactional email (relay) | None stored by the register; the relay's refusal status is the input of §1.3 | The relay's own entry belongs to the transactional email inventory item (Doc 14 §174), outside B7 |
| Corporate email (bounce mailbox) | The DSNs that `evidenceRef` points to | The proposed AMD-OD-02 entry, outside B7 |

## 3. Open items (not decided here)

| Item | Status |
| --- | --- |
| Production MongoDB / hosting provider, region, contractual role, transfer requirements (Doc 13 §§197, 200–201) | **AWAITING INPUT** (C6) |
| Retention period (Doc 13 §187) | **AWAITING PRIVACY / LEGAL / OPERATIONAL DETERMINATION** |
| Privacy Notice description of this processing (Doc 13 §§181, 199) | **AWAITING INPUT** (Privacy Notice approval) |
| Production operator tokens; protected key-copy location | **AWAITING INPUT** (C6 prerequisites) |
