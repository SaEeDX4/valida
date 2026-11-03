# D1 — Titan as the long-term provider: proposed canonical amendments and change matrix

| | |
| --- | --- |
| Basis | Owner decision **OD-2026-10-26-01**, D1: all Valida human and automated company email stays on Titan / Bluehost as the **long-term** provider (**APPROVED business direction**). |
| Status of this document (rev 7) | **ALL FIVE AMENDMENTS APPROVED:** AMD-TITAN-02 (OD-2026-10-26-02) and **AMD-TITAN-01, -03, -04 and -05 ([OD-2026-11-02-03](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md), "D-1 … approved")**, with their texts unchanged. Wherever this document still says "PROPOSED" for one of these four, read APPROVED (rev 7). This file is the controlled amendment register for them under Doc 00 §5; incorporating the texts into the canonical Doc 14 file is a canonical-document revision, outside this sandbox. |
| Status of this document (rev 6, kept) | **PROPOSED wording — except AMD-TITAN-02, APPROVED by the owner on 2026-10-26 (OD-2026-10-26-02).** Nothing here has been inserted into the canonical documents. Approval of the business direction does **not** approve this wording. LOCKED canonical text (Doc 14 §§201–205) is not modified silently; where an amendment touches a LOCKED decision, it says so and needs explicit owner approval of that change. |
| Supersedes (as the proposed canonical route) | The interim deviation texts DEV-B6-01…04 of the decision package §3 ("until D3"). They stay in the package as history, with their credential wording corrected. |
| Not waived | Doc 14 §§122–133 tests (reply, inbound, outbound, authentication, alignment, deliverability), MAIL-048…057, Doc 18 D2 §§199–200 and D3 §204 tests, **D3** identity / authentication / routing verification and **D7** Outlook delivery testing. The provider decision waives none of them. |
| Revision | **rev 5** (2026-10-26): AMD-TITAN-04 states the approved monitoring cadence, and §1 and the §117 row of the matrix say so. No other wording changed. |
| Revision | **rev 7** (2026-11-02): AMD-TITAN-01, -03, -04 and -05 **APPROVED** (OD-2026-11-02-03) — status row only; no text changed. AMD-TITAN-05 (d) now governs the R1 live-test proposal: a future live test needs separate authorisation and, where possible, a non-production identity. |
| Revision | **rev 6** (2026-10-26): AMD-TITAN-02 recorded as **APPROVED** (OD-2026-10-26-02) in the header, §1, a status line in §2 and the matrix rows it governs; its text is unchanged. AMD-TITAN-04's escalation wording follows the approved timing. AMD-TITAN-01, -03, -04 and -05 stay PROPOSED. |

## 1. Four separate questions

| Question | Decision status |
| --- | --- |
| **Provider** — which service carries Valida mail | **APPROVED:** Titan / Bluehost, long term, for human and automated mail |
| **Sender identity / namespace** — which address automated mail comes from | **APPROVED** (AMD-TITAN-02, OD-2026-10-26-02): `Valida Careers <notifications@cybervalida.com>` permanently, with Reply-To `careers@cybervalida.com`, subject to the authentication, security and access-separation requirements. Keeping Titan did not by itself require the root domain; this was the owner's separate approval. |
| **Transport and credentials** — how the backend submits mail | **PROPOSED** (AMD-TITAN-03): authenticated SMTP over verified TLS with a dedicated backend application password |
| **Bounce observation** — how failures are seen | Mechanism, cadence and escalation timing **APPROVED** (D2; OD-2026-10-26-02); canonical wording **PROPOSED** (AMD-TITAN-04) |

## 2. Amendment texts — AMD-TITAN-02 APPROVED; AMD-TITAN-01, -03, -04 and -05 PROPOSED

> **AMD-TITAN-01 — Shared provider as the enduring architecture.** Doc 14 §28 and §94 (status), §108, MAIL-034; Doc 13 §129 unchanged.
>
> **§28 and §94 status (replacing "AWAITING INPUT"):** Corporate email provider and transactional email provider: Bluehost Professional Email (powered by Titan), selected by the owner as the long-term provider for all Valida company email (OD-2026-10-26-01).
>
> **§108 (replacement):** Valida uses one approved provider for human corporate mail and for automated notification mail. The two functions share the provider but stay separate in identity, credentials and purpose. Automated mail is sent only from a dedicated automated identity, by the backend Notification Service. No human correspondence is sent from that identity, and the backend never uses a human mailbox or its credential. The backend's SMTP application password is a server-side secret used only by the backend. It is never used for human mailbox access, for bounce monitoring or for backup clients. People authorised to monitor or back up the automated mailbox use their own, separately authorised access — for example webmail with multi-factor authentication, or a separately named application password for a backup client — and never share it. Shared-provider quotas, sending and bounce-rate restrictions, suspension and incidents that affect both kinds of mail are explicit operating risks. A provider change needs a demonstrated requirement the provider cannot meet and a separate owner decision.
>
> **MAIL-034 (replacement):** Human corporate email and automated transactional email are distinct identities with separate credentials and purposes. They may share one approved provider.

**AMD-TITAN-02 — status: APPROVED** by the owner on 2026-10-26 (OD-2026-10-26-02). The text below is unchanged. Recording it in Doc 14 follows change control (Doc 00 §5).

> **AMD-TITAN-02 — The automated sender identity (recommended; separate owner approval needed; touches LOCKED §202).** Doc 14 §§96–99, §§103–106, §202, MAIL-036; Doc 18 §§201–204.
>
> **§96 (replacement):** The approved production transactional identity is `Valida Careers <notifications@<PRIMARY_DOMAIN>>`, a dedicated automated mailbox on the root domain, used only by the backend, with Reply-To `careers@<PRIMARY_DOMAIN>` (§100, §203). The `notify.<PRIMARY_DOMAIN>` namespace is an optional future configuration, not a mandatory migration.
>
> **§99 (applied to the approved identity; conditions retained):** Root-domain automated sending remains allowed only while DMARC passes on real messages, the provider configuration is verified, SPF and DKIM are aligned, and the human / automated distinction stays clear.
>
> **§98, §§103–106 (note added):** The `careers@notify.` From address, the `bounce.notify.` Return-Path and `d=notify.` DKIM are preferences that apply if the `notify.` namespace is adopted. With the root-domain identity, the Return-Path is the automated mailbox, and DKIM signs with an aligned `d=<PRIMARY_DOMAIN>` key managed by the provider.
>
> **§202 TRANSACTIONAL IDENTITY — LOCKED (amendment of a LOCKED decision):** Canonical logical architecture: a dedicated automated identity under Valida's authenticated domain — currently `notifications@<PRIMARY_DOMAIN>` by owner decision — with `notify.<PRIMARY_DOMAIN>` as an optional future namespace.
>
> **MAIL-036 (replacement):** The canonical transactional identity is a dedicated, authenticated automated address under the Valida domain, approved by the owner (currently `notifications@<PRIMARY_DOMAIN>`). `notify.<PRIMARY_DOMAIN>` is optional.
>
> **Doc 18 §§201–202 (replacement):** D3 verifies the selected transactional identity, its SPF / DKIM / DMARC alignment, its routing, Reply-To and bounce visibility. It does not presume a provider or namespace migration. §204 tests are unchanged.

> **AMD-TITAN-03 — Authenticated SMTP over verified TLS.** Doc 14 §95, §110, §135; §§152–153 and §185 applied, not weakened; MAIL-038 restated.
>
> **§95 (amended):** The transactional provider must support a custom sending identity and domain, DKIM, SPF, TLS, authenticated submission, a way to observe bounces, production-grade sending and provider security. Where the provider offers no delivery-status reporting or suppression handling — as with SMTP submission to Titan — Valida does not claim them. Delivery failures are observed through the approved manual mechanism (§117). Suppression is provided by an approved application mechanism, or by a separately approved explicit exception, before candidate acknowledgements are enabled in production (§120).
>
> **§110 and §135 (amended):** Backend business event → Notification Service → the provider's maintained submission interface (an HTTP API, or authenticated SMTP submission over implicit TLS with certificate and host-name verification, through a maintained client library) → authenticated Valida email. Provider acceptance is recorded as relay acceptance, never as delivery (§166).
>
> **§§152–153 (unchanged, applied):** The application password is used because the provider documents no stronger API or OAuth method for SMTP submission (B6 r4 provider review; to be re-checked at D3). It is dedicated to the backend, revocable, separate per environment (§185) and rotated on any suspicion of exposure.
>
> **MAIL-038 (clarification):** Transactional provider credentials remain backend-only. This does not prevent separately authorised people from accessing the automated mailbox for monitoring or backup with their own access.

> **AMD-TITAN-04 — Manual bounce observation.** Doc 14 §117, §118, §§166–167, MAIL-042; §§120–121 and MAIL-043 unchanged.
>
> **§117 (addition):** For SMTP submission to Titan, the equivalent operational mechanism is the manual review of the automated mailbox under the approved bounce procedure. It records: a named primary monitor (currently the owner); backup cover (to be assigned); the cadence (approved: every calendar day, including weekends and holidays); correlation by the returned Message-ID or attempt token; classification; a restricted log that holds no addresses; and escalation of repeated failures, sender-side failures and provider warnings on the same calendar day as discovery, including weekends and holidays. Absence of a bounce is not delivery confirmation. Observations do not change database state automatically. This mechanism does not by itself satisfy §§120–121 or MAIL-043.
>
> **MAIL-042 (clarification):** For SMTP submission, the backend observes relay acceptance, relay refusal and uncertain outcomes; later bounces are observed through §117. Five outcomes are kept apart: relay acceptance, confirmed delivery (known only from the recipient), later permanent bounce, temporary deferral, and unknown outcome.

> **AMD-TITAN-05 — Routing and configuration records; historical exception.**
>
> **(a) `careers@` routing — an interim routing choice, not yet enduring.** `careers@<PRIMARY_DOMAIN>` forwards to the `hr@` mailbox, which holds the recruitment history; Reply-To (§203, LOCKED) is met; the internal notification goes to the configured authorised destination (§114). §§35–37 and Doc 18 §218 still require, by the Release E entry gate, either a `careers@` mailbox with controlled access and tested Send-As, or an amendment of §35. Operating note: Titan's guidance says a forwarder is removed automatically when its destination rejects mail as "Recipient Does Not Exist"; the forwarding is therefore checked as part of monitoring. (DEV-B6-05 continues.)
>
> **(b) AMD-B6-07 (configuration record, updated):** "Transactional email provider: Bluehost Professional Email (powered by Titan), authenticated SMTP submission — selected by the owner as the long-term provider (OD-2026-10-26-01)."
>
> **(c) AMD-B6-08 (variable record):** unchanged. It is the configuration record of the B6 variables; Doc 15 still has no variable list (copy design §4).
>
> **(d) DEV-B6-06 — a historical, bounded exception.** The owner-authorised verification runs of 2026-10-25 used the production sender from a development machine under the recorded controls. This covers those runs only. It is **not** a permanent permission to test with production credentials. A future live test needs separate authorisation and, where possible, a non-production identity (§186), which is **AWAITING INPUT** on Titan.

## 3. Requirement-by-requirement change matrix

Status values:

- **APPROVED** — business direction;
- **PROPOSED** — wording awaiting approval;
- **UNCHANGED** — still governing;
- **MET** — the current implementation satisfies it, with the evidence named;
- **GAP** — not met; recorded with a gate or a plan.

| Reference | Canonical requirement (short) | Lock | Current implementation | Change | Status | Still to verify |
| --- | --- | --- | --- | --- | --- | --- |
| Doc 14 §28 | Corporate provider: AWAITING INPUT | — | Titan / Bluehost in use | AMD-TITAN-01 status | Direction APPROVED; wording PROPOSED | — |
| Doc 14 §§29–31 | Selection not only on price; required capabilities (MFA, admin and mailbox recovery, forwarding control, …) | — | Not reviewed against Titan as a whole | None | UNCHANGED | D2 tests: MFA, admin recovery, mailbox recovery (§189) |
| Doc 14 §35 / MAIL-010 | `careers@` with durable history and controlled delegated or shared access by Phase 3 | — | Forwarding to `hr@`; no delegated access identified on Titan | AMD-TITAN-05(a) | PROPOSED (interim) | Release E entry gate decision |
| Doc 14 §94 | Transactional provider: AWAITING INPUT | — | Titan SMTP | AMD-TITAN-01 / AMD-B6-07 | Direction APPROVED; wording PROPOSED | — |
| Doc 14 §95 | API authentication, bounce handling, delivery status, suppression handling | — | SMTP + app password; no delivery status; no suppression | AMD-TITAN-03 | PROPOSED; **GAP** for suppression (G-SUP) | D3 |
| Doc 14 §96 / §97 | `notify.` canonical namespace | — | `notifications@` on the root domain | AMD-TITAN-02 | **APPROVED** (OD-2026-10-26-02) | D3 |
| Doc 14 §98 | Preferred `careers@notify.` | — | Not used | AMD-TITAN-02 note | **APPROVED** | — |
| Doc 14 §99 | Root-domain From only if DMARC passes, setup verified, distinction clear | — | DMARC / SPF / DKIM PASS on one Gmail message (owner-reported) | AMD-TITAN-02 | **APPROVED** (conditions retained) | D3 (§§129–130), D7 |
| Doc 14 §§100–101, §203 | Reply-To `careers@`; no `no-reply@` | §203 LOCKED | Reply-To `careers@` (met, live) | None | UNCHANGED; MET (EV-A6) | §122 reply test at D3 |
| Doc 14 §§103–106 | `bounce.notify.` Return-Path; `notify.` SPF / DKIM | — | Return-Path = `notifications@`; DKIM `d=cybervalida.com` | AMD-TITAN-02 note | **APPROVED** | D3 / D4 |
| Doc 14 §107 / MAIL-037 | Transactional From passes DMARC via aligned DKIM / SPF | — | PASS on one message (owner-reported) | None | UNCHANGED | D3, D4 |
| Doc 14 §108 / MAIL-034 | Human and automated mail on distinct systems / providers | — | One provider, separate identities and credentials | AMD-TITAN-01 | Direction APPROVED; wording PROPOSED | — |
| Doc 14 §§109, 111, 179 / MAIL-038 | No SMTP credential in the frontend; credential server-side only | — | Backend-only (`backend/.env`, host secret store) | MAIL-038 clarification | UNCHANGED; clarification PROPOSED | D8 (production-only credential) |
| Doc 14 §110 / §135 | Notification Service → provider API | — | → authenticated SMTP | AMD-TITAN-03 | PROPOSED | — |
| Doc 14 §114 | Internal notification to `careers@` or an authorised destination | — | `hr@` (configured) | None | UNCHANGED; MET | — |
| Doc 14 §117 / MAIL-042 | Bounce information via dashboard, API or an equivalent operational mechanism | — | Manual review of `notifications@` | AMD-TITAN-04 | Mechanism APPROVED (D2); wording PROPOSED | Backup monitor; unexpected-absence procedure (the cadence and the escalation timing are APPROVED) |
| Doc 14 §118 | Distinguish outcomes to the degree supported | — | Relay acceptance / refusal / uncertain | MAIL-042 clarification | UNCHANGED; MET to the degree supported | — |
| Doc 14 §119 / MAIL-044 | A bounce deletes no business record | — | Met (`SENT` never changed by a bounce) | None | UNCHANGED; MET | — |
| Doc 14 §120 | No blind repeated sending to a suppressed address | — | **Not met** across Applications | Suppression design (D2a) | **GAP**; G-SUP closed | SUP-1…6 at B7 |
| Doc 14 §121 / MAIL-043 | Retry only transient failures | — | Met per channel | None | UNCHANGED; MET per channel | — |
| Doc 14 §§152–153 | Avoid basic SMTP / application passwords unless stronger methods are unavailable | — | App password (no API / OAuth found, r4) | AMD-TITAN-03 (applied) | UNCHANGED | Re-check at D3 |
| Doc 14 §§163–164 | Provider migration rules | — | No migration | None | UNCHANGED (not triggered) | — |
| Doc 14 §§166–167 | Acceptance ≠ delivery; observe sends, rejections, bounces, suppression, authentication failures | — | Relay results recorded; bounces manual | AMD-TITAN-04 | UNCHANGED | — |
| Doc 14 §185 / §186 / MAIL-047 | Separate credentials and identity per environment; no reckless staging impersonation | — | Two historical runs with the production sender (DEV-B6-06) | AMD-TITAN-05(d) | PROPOSED (historical, bounded) | Staging identity at C6 (**AWAITING INPUT**) |
| Doc 14 §202 / MAIL-036 | **LOCKED:** `notify.` for automated identity | **LOCKED** | Root-domain `notifications@` | AMD-TITAN-02 (amends a LOCKED decision) | **APPROVED** (OD-2026-10-26-02); recorded in Doc 14 through change control | — |
| Doc 14 §204 | **LOCKED:** human recruitment correspondence as `careers@` | **LOCKED** | Human replies from `hr@` show `hr@` | None | UNCHANGED; **GAP** until Send-As (Release E) | §128 / MAIL-056 |
| Doc 14 §§122–133, MAIL-048…057 | Real inbound, outbound, reply, authentication, deliverability tests | — | Gmail only; Reply-To routing seen | None | UNCHANGED | D2 / D3 / D5; **D7** Outlook |
| Doc 13 §102 | Email credential scoped to sending where possible | — | Mailbox application password (full mailbox scope at the provider) | None | UNCHANGED; limitation recorded | — |
| Doc 13 §129 | Human and transactional email remain distinct operational concerns | — | Separate identities, credentials and purposes | AMD-TITAN-01 | UNCHANGED | — |
| Doc 18 §136 | B6 may use an approved real provider before full Phase 2 identity | — | Titan | None | UNCHANGED; MET | — |
| Doc 18 §§199–200 (D2) | MFA, recovery, no shared passwords, controlled Careers Send-As | — | Not yet tested as a milestone | None | UNCHANGED | D2 tests |
| Doc 18 §§201–204 (D3) | Move automated mail to `notify.`; tests | — | Root domain | AMD-TITAN-02 (D3 re-scoped to verification) | **APPROVED** | D3 tests unchanged |

## 4. Credential wording — corrected throughout

| Rule | Where it is now stated |
| --- | --- |
| The backend SMTP application password is backend-only: never used for monitoring, backup, webmail or a mail client | AMD-TITAN-01, AMD-TITAN-03 (MAIL-038 clarification); decision package DEV-B6-01 / 02 (corrected); bounce procedure §2; backup proposal §4.1 |
| Authorised monitoring and backup may access `notifications@` with separately authorised access (webmail with 2FA, or a separately named application password for a backup client) | AMD-TITAN-01; bounce procedures (English draft §2; Persian procedure); backup proposal §4.1 |
| No human correspondence is sent from the automated identity | AMD-TITAN-01, AMD-TITAN-02 (§99) |
| Monitoring never uses, changes or shares the backend SMTP password | AMD-TITAN-01; Persian bounce procedure |
| Environment separation, TLS validation, authentication alignment and rotation stay intact | AMD-TITAN-03 (§§152–153, §185); Doc 14 §§107, 131 unchanged |

## 5. Provider facts used (Titan guidance, not a contract for the owner's plan)

| Fact | Source | Status |
| --- | --- | --- |
| Bounce limits: per mailbox, to other domains, 5 per hour, 10 per day, 20 per 3 days; per domain, to other domains, 10 per hour, 20 per day, 25 (Free) or 50 (Paid) per 3 days. Exceeding a mailbox limit stops sending for that hour or day. A persistently high bounce count can block a mailbox or domain permanently. | [Titan — Email Bounce Back](https://support.titan.email/hc/en-us/articles/900001359746-Email-Bounce-Back), read 2026-10-26 | Provider guidance. **Whether "Paid" here is the owner's Bluehost plan is UNVERIFIED.** |
| A forwarder is removed automatically when its destination rejects with "Recipient Does Not Exist" | Same article | Provider guidance |
| No HTTP message API, and no OAuth / token method for SMTP submission | B6 r4 provider review | To re-check at D3 |
| No delegated or shared-mailbox access identified | B6 material | **UNVERIFIED** on the account |
