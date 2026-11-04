# B6 — bounce procedure: the remaining owner choices (decision sheet)

| | |
| --- | --- |
| Purpose | The open choices inside the bounce procedure, one line each, with recommended wording. **Nothing here is approved until the owner marks it.** Unmarked items stay as they are now. |
| Sources | English draft `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`; Persian procedure `docs/operations/BOUNCE_PROCEDURE_FA.md`; full texts in [`B6_REMAINING_OWNER_APPROVALS.md`](B6_REMAINING_OWNER_APPROVALS.md) (B6-2) |
| Already approved — not asked again | Manual monitoring as the Doc 14 §117 mechanism; Saeed as primary monitor (OD-2026-10-26-01); the cadence — every calendar day, including weekends and holidays; escalation on the same calendar day as discovery, including weekends and holidays (OD-2026-10-26-02) |
| After the decision | The chosen wording is written into both procedures (English and Persian) as a documentation change; the owner then approves the full procedure text (B6-2). |
| r9 status ([OD-2026-11-02-03](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)) | **Item 1 APPROVED** (recommended wording: within 1 hour, then at the next daily review). **Item 3 APPROVED** (7 calendar days). **No automatic resending** confirmed. **Item 4: OneDrive Personal, CONDITIONAL** — "on private access, MFA, data protection and ownership requirements" (the owner's words); no paid service is provisioned or required. **Still open:** item 2 (24 or 48 hours), item 5 (planned absence), confirmation that the OneDrive conditions are met, and approval of the complete English and Persian texts. Items 6–7 stay production prerequisites. |
| r10 correction (2026-11-03; [OD-2026-11-02-03 §4](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)) | The r9 row above was too narrow: the D-2 **timings, items 1–3, are APPROVED** with the recommended wording — **item 2: 24 hours** — and no automatic resending. All three are now written into both procedures (English §3, §4.7 step 4, §5; Persian §1, §7, §8). **Still open:** item 5 and approval of the complete English and Persian texts; the OneDrive conditions are confirmed before the first log entry. Items 6–7 stay production prerequisites. |
| r11 correction (2026-11-03; [OD-2026-11-02-03 §5](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)) | **Item 2 is a 24-hour manual review of uncertain outcomes, explicitly approved by the owner** — not the "may decide to retry" wording recommended below, and not a standing permission to re-send. Any re-send is a separate, explicit owner decision for that case. Both procedures corrected. |
| r12 (2026-11-03; [OD-2026-11-03-01](OWNER_DECISION_2026-11-03-01_B6_BOUNCE_PROCEDURE_APPROVAL.md)) | **Item 5 APPROVED** (planned absence) and **the complete English and Persian procedures APPROVED** (the r11 texts). **B6-2 closed.** Item 4 stays conditional (before the first log entry); items 6–7 stay production prerequisites. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED** — candidate acknowledgements stay disabled in production. |

## Which choices block what

| Choice | Needed for | Why |
| --- | --- | --- |
| 1–3 Business-day timings | **B6 acceptance** (B6-2, the procedure text) | They are sentences of the text to be approved; the cadence they sit beside is already calendar-day |
| 4 Restricted log location | **B6 acceptance** (recommended) | Every handled report is recorded in the log (§4.6), and the repeat drill T5 logs a `REPEAT`; without a location these steps cannot be carried out |
| 5 Planned absence | **B6 acceptance** (B6-2 text, currently PROPOSED) | Part of the text |
| 6 Backup monitor | **Production prerequisite** — before production candidate acknowledgements (checklist §3) | People and account checks (a Titan rule is UNVERIFIED); not needed while acknowledgements stay disabled |
| 7 Unexpected absence | **Production prerequisite** — before production candidate acknowledgements (checklist §3) | Depends on 6 and on who can change production settings |

## 1. Follow-up after an authorised live test (English draft §3)

- **Current:** "After any authorised live test — Check within 1 hour, then the next business day".
- **Recommended:** "After any authorised live test — check within 1 hour, then again at the next daily review (the next calendar day)."
- **Persian (for the Persian procedure):** «پس از هر آزمایش زندهٔ مجاز: ظرف یک ساعت بررسی کنید و دوباره در بررسی روزانهٔ روز تقویمی بعد.»
- **Why:** reviews are daily on every calendar day, so "business day" is a different, looser clock.

☐ Approve the recommended wording  ☐ Other: ______________________

## 2. Waiting before an uncertain outcome may be re-sent (English draft §4.7, step 4)

- **Current:** "If neither has appeared after 1 business day, the owner may decide to retry with `--include-uncertain`, accepting a possible duplicate. Record the decision."
- **Recommended:** "If neither has appeared 24 hours after the attempt, confirmed at a daily review, the owner may decide to retry with `--include-uncertain`, accepting a possible duplicate. Record the decision."
- **Persian:** «اگر ۲۴ ساعت پس از ارسال، در یکی از بررسی‌های روزانه، نه پیام برگشتی دیده شد و نه (برای اعلان داخلی) نسخه‌ای در hr@، مالک می‌تواند تصمیم بگیرد با `--include-uncertain` دوباره ارسال شود و احتمال ارسال تکراری را بپذیرد. این تصمیم ثبت شود.»
- **Alternative:** 48 hours — fewer duplicates if a late report arrives, a longer wait for the recipient.

☐ 24 hours (recommended)  ☐ 48 hours  ☐ Other: ______________________

## 3. Escalating an entry that stays open (English draft §5)

- **Current:** "any `OPEN` entry older than 5 business days".
- **Recommended:** "any `OPEN` entry older than 7 calendar days".
- **Persian:** «هر مورد باز (OPEN) که بیش از ۷ روز تقویمی از آن گذشته باشد.»
- **Why:** about the same span as 5 business days, on the calendar clock the procedure already uses, and in step with the weekly review of open entries (§4.8).

☐ Approve the recommended wording  ☐ Other: ______________________

## 4. Where the restricted bounce log is kept (English draft §4.6 — now AWAITING INPUT)

The log holds no addresses or names (Application id, Message-ID token, type, action, initials), but it is restricted.

- **Recommended wording:** "The bounce log is one spreadsheet, `Valida bounce log`, kept at `<location chosen by the owner>` — a location under the owner's control, protected by multi-factor authentication, and open only to the named monitors. It is never kept in the repository, MongoDB, chat tools, tickets or review material. It is included in the monthly backup. Its retention follows Doc 13 §187 (AWAITING)."
- **Persian:** «دفتر محدود رسیدگی یک صفحه‌گسترده با نام `Valida bounce log` است در `<محل انتخابی مالک>` — محلی تحت کنترل مالک، با احراز هویت چندمرحله‌ای، که فقط پایشگران تعیین‌شده به آن دسترسی دارند. هرگز در مخزن کد، MongoDB، ابزارهای گفتگو، تیکت‌ها یا مدارک بازبینی نگه داشته نمی‌شود. در پشتیبان‌گیری ماهانه گنجانده می‌شود. مدت نگهداری آن تابع Doc 13 §187 است (در انتظار تعیین).»
- **Options for the location:** (a) a folder in the owner's own MFA-protected cloud storage — a backup monitor can be given access later (**recommended**); (b) an encrypted file on the owner's computer — simplest, but nobody else can reach it; (c) a folder inside the `notifications@` mailbox — not recommended: a mail folder is a poor log and mixes the log with the reports.

☐ (a), location: ______________________  ☐ (b)  ☐ (c)  ☐ Leave AWAITING (then B6-2 cannot be fully approved)

## 5. Planned absence (English draft §2 "Backup"; Persian §9 — PROPOSED)

- **Summary of the current text (Persian §9, PROPOSED; exact text in the compilation):** before a planned absence, confirm cover; if there is none, acknowledgements are paused before the absence; after return, reports are handled in date order, nothing pending is sent automatically, and re-enabling acknowledgements is a separate decision.
- **Recommended:** approve as written.

☐ Approve as written  ☐ Other: ______________________

## 6. Backup monitor (now UNASSIGNED) — production prerequisite

- **Recommended wording for now:** "No backup monitor is assigned. Until one is, candidate acknowledgements are not enabled in production; internal notifications continue."
- **Persian:** «پایشگر پشتیبان تعیین نشده است. تا زمانی که تعیین نشود، تأییدیه‌های متقاضیان در محیط عملیاتی فعال نمی‌شوند؛ اعلان‌های داخلی ادامه دارند.»
- **Later, before production acknowledgements**, one of:
  - (a) a named backup with their own separately authorised access to `notifications@` (MFA) — the server-side copy rule is **UNVERIFIED** on Titan, and copies contain candidate data;
  - (b) break-glass access by the account administrator, used only when the primary is unavailable and recorded in the log;
  - (c) keep the rule above: no production acknowledgements without cover.

☐ Approve the wording for now  ☐ Name a backup now: ______________________  ☐ Leave UNASSIGNED (production stays blocked)

## 7. Unexpected absence (now UNRESOLVED) — production prerequisite

- **Recommended wording:** "If the daily review has not taken place for 2 consecutive calendar days and no backup covered them: (1) the person named for this, who has the right to change production settings (`<name>`), pauses candidate acknowledgements in production (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`); (2) internal notifications continue; (3) on return the gap is recorded in the log and reports are handled in date order; (4) re-enabling acknowledgements is a separate owner decision. Until such a person is named, acknowledgements are not enabled in production."
- **Persian:** «اگر دو روز تقویمی پیاپی بررسی روزانه انجام نشود و پشتیبانی هم آن را پوشش ندهد: (۱) فردی که برای این کار تعیین شده و اختیار تغییر تنظیمات محیط عملیاتی را دارد (`<نام>`) تأییدیه‌های متقاضیان را در محیط عملیاتی متوقف می‌کند (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`)؛ (۲) اعلان‌های داخلی ادامه دارند؛ (۳) پس از بازگشت، فاصلهٔ بررسی‌نشده در دفتر ثبت و پیام‌ها به ترتیب تاریخ رسیدگی می‌شوند؛ (۴) فعال‌کردن دوبارهٔ تأییدیه‌ها تصمیمی جداگانهٔ مالک است. تا تعیین چنین فردی، تأییدیه‌ها در محیط عملیاتی فعال نمی‌شوند.»

☐ Approve the recommended wording, person: ______________________  ☐ Approve without a person (production stays blocked)  ☐ Leave UNRESOLVED

---

Decision recorded by: ______________________  Date: ____________  Decision ID: the next unused `OD-YYYY-MM-DD-NN` at the time of decision
