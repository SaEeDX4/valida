# Acknowledgement budget — a separate, optional risk-reduction proposal (D2b)

| | |
| --- | --- |
| Decision | **D2b — PROPOSED, owner choice.** It is **not** part of the suppression design (D2a) and **not** a criterion of gate G-SUP. GPT's review of rev 4 recommends a budget but approves no numbers or design. **Nothing here is approved.** |
| Status of this document | **PROPOSED design.** Nothing is implemented. No schema, script, configuration, test or dependency was created or changed. **No numeric cap is proposed.** Tests BUD-1…BUD-10 are **NOT WRITTEN / NOT RUN**. |
| Origin | Split out of [`RECIPIENT_SUPPRESSION_DESIGN.md`](RECIPIENT_SUPPRESSION_DESIGN.md) §7.2 (control 2) in rev 5, 2026-10-26. The earlier example cap was withdrawn: no evidence supports a number yet. |
| Milestone | If adopted: a bounded **B7** change, reviewed on its own. It can follow the suppression change. It is never bundled with Stage 2, R3, the message-copy work or the body-discard fix. |
| Governing text | Doc 14 §§117–121, 166–167; Doc 09 §§128–136; Doc 10 §§117–122; suppression design §7.1 |

## 1. What it is for — and what it cannot do

**Purpose.** Limit how many candidate acknowledgements Valida submits in any rolling hour, day and three days. A burst of **new** invalid addresses cannot be stopped by suppression, because those addresses have never bounced. The budget makes it less likely that such a burst pushes `notifications@`, or the domain, over Titan's bounce limits.

**It is risk reduction, not a guarantee that Titan will never restrict the mailbox or the domain:**

| Limit of the control | Why |
| --- | --- |
| It counts **sends**; Titan counts **bounces** | A cap bounds acknowledgement bounces only in the worst case, where every acknowledgement bounces. |
| **Delayed bounces** | A delivery-failure report can arrive minutes or days after the send: deferred mail is retried, and RFC 5321 §4.5.4.1 suggests a give-up time of at least 4–5 days. If the longest delay is *D*, the bounces that arrive in any period of length *W* can come from all the sends of the preceding *W + D*. A per-window send cap therefore does not cap bounces per window. |
| **Other traffic** | The domain limits are shared with every human mailbox on `cybervalida.com`; their bounces are invisible to the backend. Internal notifications go to the same domain (`hr@`) and fall under the separate same-domain mailbox limits. |
| **Window boundaries** | Titan's page does not say whether its windows are rolling or calendar-based, or whether a bounce counts when it arrives or when the original was sent. |
| **The plan** | Whether the owner's Bluehost plan is "Free" or "Paid" in Titan's table, and whether the published numbers are the account's actual limits, is **UNVERIFIED**. |

It also cannot stop the **first** bounce, does not replace suppression (D2a, G-SUP), and cannot recall a submitted message.

## 2. Documented limits (provider guidance; not verified for the owner's plan)

Source: Titan — [Email Bounce Back](https://support.titan.email/hc/en-us/articles/900001359746-Email-Bounce-Back), read 2026-10-26 and re-read for rev 5.

| Scope | To other domains | To the same domain |
| --- | --- | --- |
| Per mailbox | 5 per hour · 10 per day · 20 per 3 days | 50 per hour · 100 per day |
| Per domain | 10 per hour · 20 per day · 25 per 3 days ("Free") or 50 ("Paid") | No rate limit |

- At the hourly limit, "you would not be able to send any more emails for that hour"; at the daily limit, "for that day". The page does not say what happens at the 3-day limit.
- "Please note that high bounce back count will result in permanent blocking of mailbox/domain."
- The page does not define the window type or the counting time (§1).

## 3. Design

### 3.1 Where it sits

For the acknowledgement channel only, in `createApplicationNotifier().attempt()`:

r9 claim → suppression coverage check and lookup (D2a, if implemented) → **budget reservation** → SMTP → r9 conditional record.

- After suppression, so a suppressed address consumes no capacity, and a coverage block consumes none either.
- Before SMTP, so nothing is submitted without a reservation.
- The internal notification is **never** budgeted and never blocked by the budget.

### 3.2 One atomic reservation across every enforced limit

One document per scope, in a new collection `notification_budgets`:

```
{ _id: "APPLICATION_ACKNOWLEDGEMENT",
  reservations: [ { at, applicationId, attempt } ],   // bounded; pruned on every write
  version }
```

A reservation is **one conditional single-document update**:

- the filter matches the scope document only if, at server time `$$NOW`, the number of reservations newer than 1 hour is below the hourly cap, **and** newer than 24 hours below the daily cap, **and** newer than 72 hours below the 3-day cap (an `$expr` over the array);
- the update — an aggregation-pipeline update using the same `$$NOW` — removes reservations older than 72 hours and appends the new one;
- write concern `w: majority, j: true`;
- matched → reserved; not matched → over budget.

Why this shape:

- **Every limit at once.** The three counts and the append are evaluated and applied to one document version in one operation, so no limit is checked against a stale count.
- **Concurrent processes.** A single-document update is atomic, so two processes cannot both take the last unit of capacity. BUD-1 must prove this under real concurrency, with several processes.
- **Rolling windows.** They are stricter than calendar windows: at most *N* reservations in any 60 minutes means at most *N* in any calendar hour, however Titan counts.
- **Server time.** `$$NOW` avoids clock skew between application hosts. That the filter and the update see the same value is an assumption that BUD-10 verifies.
- **Bounded and private.** The array never holds more than the 3-day cap. It holds no address: only the time, the Application id and the attempt number.
- **Created once.** A setup step creates the scope document. If it is missing, nothing is sent (CONFIGURATION).

### 3.3 Retries, crashes and uncertain outcomes — no refunds, no automatic resends

| Case | Rule |
| --- | --- |
| Every SMTP attempt, first or retry | Needs its **own** reservation. A retry without capacity is not queued. |
| Over budget | No SMTP. `FAILED` / **`ACKNOWLEDGEMENT_BUDGET_EXCEEDED`** (class **CONFIGURATION**: reached only by an operator run with `--include-configuration`, so a burst is never replayed automatically). A warning log with fixed tokens; counted in the retry dry run; visible in the daily review. |
| The reservation write fails, times out or has an unknown outcome | No SMTP. `FAILED` / **`ACKNOWLEDGEMENT_BUDGET_UNAVAILABLE`** (TRANSIENT: nothing was submitted). If the write did land, that capacity is lost — never the reverse. |
| Reserved, then the SMTP outcome is a refusal, a timeout or `OUTCOME_UNKNOWN`, or the process crashes before or after SMTP | **The reservation stays counted.** There is no refund for a message that was or may have been submitted. There is none either for one that provably was not, so that only one write path exists. A crash leaves the r9 `ATTEMPT_IN_PROGRESS` state, handled by the existing uncertain-outcome procedure; `--include-uncertain` remains an operator decision. |
| Candidate experience | Unchanged: the website shows the receipt confirmation (`201`) whether or not an acknowledgement is sent. |

### 3.4 Configuration — no default numbers

- `ACKNOWLEDGEMENT_BUDGET_PER_HOUR`, `ACKNOWLEDGEMENT_BUDGET_PER_DAY`, `ACKNOWLEDGEMENT_BUDGET_PER_3_DAYS`: positive integers, with **no defaults**.
- The budget is active only when all three are set. A partial set is a configuration error, refused at startup in production.
- New codes (Doc 10): `ACKNOWLEDGEMENT_BUDGET_EXCEEDED` (CONFIGURATION) and `ACKNOWLEDGEMENT_BUDGET_UNAVAILABLE` (TRANSIENT).

## 4. Choosing caps — a method, not numbers

1. Verify which tier applies to the owner's plan, and whether the published limits are the account's limits — a Bluehost or Titan support statement, or account documentation. **AWAITING INPUT.**
2. Find out whether the windows are rolling and whether a bounce counts on arrival. Where unknown, assume the less favourable case.
3. Keep each cap below the matching **mailbox** limit to other domains, with a margin for bounces delayed from earlier windows (§1).
4. Keep headroom under the **domain** limits for human mail, which the backend cannot see.
5. Compare with the expected legitimate volume. No real volume exists yet: the real vacancy is DRAFT. A cap low enough to be safe will also hold back legitimate acknowledgements at busy times.
6. The owner records the caps and the evidence behind them. Changing a cap is a configuration change, recorded in the bounce log.

## 5. Acceptance tests — PROPOSED / NOT WRITTEN / NOT RUN

Environment: a real MongoDB replica set; a local SMTP test server with a submission counter; synthetic data only; small synthetic caps chosen for the test.

| # | Test |
| --- | --- |
| BUD-1 | **Concurrency:** many simultaneous reservations from several processes against a cap of *k* → exactly *k* succeed; the rest are `ACKNOWLEDGEMENT_BUDGET_EXCEEDED`; the SMTP count equals *k* |
| BUD-2 | **Every limit enforced:** with pre-seeded reservations at chosen ages, the hourly, daily and 3-day caps each refuse on their own; a reservation exactly at a window boundary is counted consistently |
| BUD-3 | **Rolling, not calendar:** reservations on both sides of a calendar-hour or calendar-day boundary are counted together |
| BUD-4 | **No refund:** a relay refusal, a timeout, `OUTCOME_UNKNOWN`, and a killed process before and after SMTP (fault injection) each leave the reservation counted |
| BUD-5 | **Retries:** each retry needs a new reservation; an over-budget retry is recorded and is selected by no retry flag except `--include-configuration`; nothing is resent automatically |
| BUD-6 | **Reservation failure:** a write error, a write-concern timeout or an unknown outcome → zero submissions and `ACKNOWLEDGEMENT_BUDGET_UNAVAILABLE`; the Application still returns `201`; the internal notification is sent |
| BUD-7 | **Order:** a suppressed address and a coverage block consume no reservation; the internal notification never reserves and is never blocked |
| BUD-8 | **Bounded and private:** pruning keeps the array at or below the 3-day cap; no address in the document or the logs |
| BUD-9 | **Configuration:** a partial set of caps is refused in production; a missing scope document → zero submissions (CONFIGURATION) |
| BUD-10 | **Server time:** the filter and the update use one consistent time; application-host clock skew has no effect |

**Live verification** of how Titan actually counts is not proposed and not authorised.
