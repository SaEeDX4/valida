# C4 — Privacy and Legal check (Doc 18 §166)

| | |
| --- | --- |
| Scope | The published Privacy Notice (`/privacy`, Doc 06 §§155–168) and Legal Information (`/legal`, Doc 06 §§170–177), compared with the system as implemented at `c4-work` |
| Governing | Doc 18 §166 ("Do not claim unverified legal compliance"); Doc 06 §§169, 178 (publication gates), §193; Doc 13 §§174, 181, 186–187, 194, 197–207; Doc 14 §203 |
| Result | No copy change in C4. The pages state no fact the system contradicts, and assert no compliance, provider, retention period or contact. The open items below are what the **publication gates** (Doc 06 §§169 and 178) still need. This is an engineering comparison, **not a legal review**. |

## 1. Privacy Notice, claim by claim

| Claim (Doc 06) | What the system actually does | Disposition |
| --- | --- | --- |
| §159 "Valida MB is a Lithuanian technology company." | The same entity as the Legal page's verified facts (§173). | Consistent. |
| §160 Applicants provide "name, contact details, resume, application responses, message or cover letter, and information associated with the position you selected." | The Application stores: `fullName`, `email` (with a normalised copy), `phone` (only if the Job enables it), `message` (only if enabled, up to 5000 characters), screening answers with the question prompt as it was asked, a snapshot of the Job applied for, and the resume as a private object with its original filename, type, size and SHA-256. The record also holds operational fields: the submission time, a hash of the Idempotency-Key, and notification delivery status. There is no separate cover-letter file; the message is the only free text. | Accurate. "Cover letter" corresponds to the optional message. |
| §160 "technical information necessary to operate, secure, diagnose, and protect the service" | The backend access log records: request id, method, route template or path shape (never a raw path, slug value or query; C3 r3), status and duration. It records no IP address, user agent, body or cookie. Rate limiting keeps client addresses in memory only. The site sets **no cookies**, runs **no analytics** and uses **no browser storage**: the regional view is in the URL query. | Accurate. The production log provider and log retention are open (§3, P-4). |
| §161 Purposes | Receive and store the Application; notify the recruitment mailbox. Candidate acknowledgements exist but are **refused at production start-up** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`). | Accurate. |
| §162 Resumes are "intended to be stored through private system storage"; access is "intended to be limited" | B4 private storage: no public route serves a resume (C3 probes: 404). Only the local storage driver exists; the production storage provider is chosen at C6. There is no Admin interface yet (Phase 3), so only an operator with server or storage access can reach a file. | Accurate, and worded as intent. |
| §163 Generic provider categories | Selected: Bluehost Professional Email (Titan) for corporate and transactional mail (B6 owner decisions). Not selected: website hosting, API hosting, MongoDB hosting, private storage, error and uptime monitoring (C6). | Truthful as general text. Doc 13 §181 asks the notice to describe the actual providers; whether naming them is required is part of the gate (P-2). |
| §164 Security, "intended to use safeguards" | Implemented: validation, private storage, rate limits, CORS, security headers on the API, verified TLS to the mail relay. Production HTTPS is C6. | Accurate, and worded as intent. |
| §165 Retention, general wording | No retention period is decided. The Doc 10 retention fields stay null. There is no automated deletion. | Accurate: no period is claimed. The period itself is open (P-3). |
| §166 Data minimisation | Phone and message are optional per Job; Doc 13 §179 data is not requested. | Accurate. |
| §167 "Questions or Requests" | **Not rendered.** Doc 06 points to "the current official contact method published on the Valida website", and none is published. `careers@cybervalida.com` is the recruitment address (the Reply-To of automated mail, Doc 14 §203), but **no approved source designates it as a privacy contact**. | Stays omitted. Decision P-1. |
| §168 Changes to this notice | — | Consistent. |

## 2. Legal Information

| Item | Disposition |
| --- | --- |
| §173 company facts: brand, legal entity, company type, company code, registration date, founder / registered manager | Rendered verbatim from Doc 06 (accepted A4). |
| §§174–177 website, career, content and change statements | Rendered verbatim. They state no warranty, jurisdiction, VAT number or address, because Doc 06 asserts none. |
| §178 legal publication gate | **Open**: a legal review of the page before public deployment (P-5). |
| Doc 06 §193 footer contact | Not shown, because there is no approved, functioning contact method. |

## 3. Open items (internal; nothing here is published)

| ID | Item | Affects | Status |
| --- | --- | --- | --- |
| P-1 | Privacy contact method (Doc 13 §194, Doc 06 §167) | Privacy §167 "Questions or Requests"; Doc 06 §169 gate | **AWAITING INPUT**. careers@ may serve only if an approved source designates it. |
| P-2 | Provider inventory for personal data (Doc 13 §§197–198): hosting, MongoDB, storage, monitoring, plus the selected mail provider; locations, roles, transfers | Privacy §163; Doc 13 §181 | **AWAITING INPUT** (C6 selection) |
| P-3 | Recruitment retention period (Doc 13 §§186–187, 204) | Privacy §165; Doc 10 retention fields | **AWAITING PRIVACY / LEGAL / OPERATIONAL DETERMINATION** |
| P-4 | Production log destination and log retention | Privacy §160 technical information | **AWAITING INPUT** (C6) |
| P-5 | Legal and privacy review: the applicability gate (Doc 13 §§201–203) and the page gates (Doc 06 §§169, 178) | Both pages; publication | **AWAITING INPUT** |
| P-6 | Real approved vacancy content (Doc 06 §231, Doc 12 §45), including the work country or countries, which are OPEN ([OD-2026-11-09-01](../review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md)) | What a real Application collects (screening questions); the international recruitment audience is an input to the applicability review (P-5) | **AWAITING INPUT** |
