# Vouch - Design Specification

Date: 2026-09-14
Status: approved for planning
Author: Sagar Rajput (with Claude as pair)

Vouch turns messy vendor invoices into a verified, queryable ledger where every value is traceable to the exact spot in the source document and nothing enters the ledger unverified. The name comes from the audit practice of vouching a ledger entry back to its source document.

---

## 1. Context and constraints

- Built for Zamp's open-ended engineering project round, Problem 1: "turn messy documents into structured, queryable data".
- Deliverables: a deployed web app a reviewer can use with zero setup, a public GitHub repo, and a `decisions.md` at the repo root kept as a running, dated log.
- Evaluation rubric: problem framing, product thinking, UX decisions, code quality, meaningful tests, documentation, setup experience, velocity, above and beyond (depth on a hard sub-problem).
- Role being evaluated: Senior Frontend Engineer. Security, identity, scalability, performance, accessibility and UI/UX are each treated as explicit evaluation areas with a concrete mechanism and a visible artifact.
- Budget: about seven focused days; about $12 total in Anthropic credits; everything else on free tiers.
- Accounts (all owned by Sagar): GitHub `SagarRajput-7`, Vercel Hobby, Neon via the Vercel Marketplace, Anthropic API key, Google Cloud OAuth client (free, created only when reached).
- Rule: no external service is authenticated or provisioned without Sagar's explicit confirmation; every proposal states its cost.

## 2. Problem framing (this text seeds the top of decisions.md)

**The user.** An accounts-payable specialist at a mid-size company receives hundreds of vendor invoices a month as digital PDFs, scanned PDFs and phone photos. Their fear is a wrong number reaching the ledger, not slow processing. Today they either re-key every invoice or trust an extraction tool blindly.

**The problem.** Extraction tools output numbers with no fast way to check them, so users re-verify everything or accept silent errors.

**The hard part.** Making machine-extracted values verifiable and correctable in seconds, robust to scans and bad inputs. A naive "PDF to LLM to JSON" pipeline fails here: values cannot be located in the source, arithmetic errors pass silently, scans produce confident nonsense, and users must re-check every field anyway.

**The slice.** Upload one or more invoices, extract, review fields ordered by risk with source highlighting, correct and verify, then filter, search and export the ledger. The handled failure case: a low-quality scan whose total does not add up.

**Deliberate cuts.** Multiple document schemas, custom fields, ERP or accounting integrations, approval workflows, multi-user teams, email ingestion, vector search or chat over documents, fine-tuning, UI localisation, SSO.

**North-star metrics.** Time to a verified record, and zero silent errors.

## 3. Product principles

1. Every value shows its source. If it cannot be located in the document, it is flagged, never silently accepted.
2. The riskiest field is always first. Review order is computed, not positional.
3. Arithmetic is a free reviewer. Validation runs before a human looks.
4. The demo path is the real path. Guest sessions are real sessions, background jobs are real queued jobs.
5. Restraint in the interface. The document and its highlights are the only colourful things on the review screen.

## 4. Architecture

```mermaid
flowchart LR
  B[Browser<br/>Next.js App Router, React 19] -->|upload, poll, review, query| A[Route handlers + RSC<br/>Vercel Fluid Compute]
  A --> DB[(Postgres<br/>Neon prod / PGlite local)]
  A --> BL[(Vercel Blob private<br/>local FS in dev)]
  A -->|after() and status polls| Q[Job drain<br/>SKIP LOCKED claims]
  Q --> P1[parse] --> P2[extract] --> P3[ground] --> P4[validate] --> P5[reconcile?] --> DB
  P2 -->|PDF or image, structured output| LLM[Claude Sonnet 5<br/>AI SDK, mock in dev/tests]
  P1 -->|scans| OCR[Tesseract.js]
  CRON[Daily cron] --> Q
  CRON --> CL[cleanup expired guests]
```

**Shape.** One Next.js application. Route handlers form a JSON API consumed by TanStack Query on the client; React Server Components render initial page data. Pipeline stages are pure, idempotent functions that persist their output. A Postgres-backed job queue with `FOR UPDATE SKIP LOCKED` claiming provides at-least-once execution with checkpoints. Long work runs after the response via Next's `after()` within the five-minute function limit.

**Rejected shapes.** Vercel Workflow or Queues (Vercel-specific, hard to run locally, learning curve inside a seven-day window). Separate worker service (Vercel does not host long-running workers; a second deploy target hurts setup experience). Both are documented in decisions.md with the stage-function design as the migration path.

### 4.1 Stack and versions (latest at time of writing)

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js App Router, React | 16.3, 19.3 |
| Language | TypeScript strict | 5.9 line (7.0 only if the toolchain is clean) |
| Styling | Tailwind CSS v4 with CSS variables tokens, shadcn/ui on Radix | 4.3 |
| Fonts | Geist Sans, Geist Mono via `geist` | 1.7 |
| Data | Drizzle ORM, Postgres on Neon (prod), PGlite (local and tests) | 0.45, 0.5.8 |
| Files | Vercel Blob private store (prod), local filesystem (dev) | 2.8 |
| Auth | Better Auth with Drizzle adapter, anonymous plugin, Google provider | 1.7 |
| Model | Claude Sonnet 5 via AI SDK and `@ai-sdk/anthropic` | ai 7.0, anthropic 4.0 |
| PDF text | `unpdf` (serverless-safe pdfjs) for positioned text; `react-pdf` on the client | 1.8, 11.0 |
| OCR | Tesseract.js | 7.0 |
| Raster | `@napi-rs/canvas` via unpdf for scanned PDFs | 1.0 |
| Client state | TanStack Query | 5.1 |
| Validation | zod | 4.6 |
| Env | `@t3-oss/env-nextjs` | 0.13 |
| Tests | Vitest, Playwright, `@axe-core/playwright`, Lighthouse CI | 5.0, 1.63, 4.13, 0.15 |
| Package manager | pnpm | 12 |

## 5. Domain and data model

All tables carry `created_at` and `updated_at` unless noted. Money is `numeric(18,2)`. Every workspace-scoped table has an index starting with `workspace_id`.

| Table | Purpose and key columns |
|---|---|
| `users`, `sessions`, `accounts`, `verifications` | Managed by Better Auth. `users.is_anonymous` marks guests. |
| `workspaces` | `id`, `owner_user_id`, `kind` (`guest`, `account`), `expires_at` (null for accounts), `deleted_at`. One workspace per user in v1. |
| `documents` | `id`, `workspace_id`, `original_filename`, `mime`, `byte_size`, `sha256`, `blob_key`, `page_count`, `kind` (`pdf_text`, `pdf_scan`, `image`), `status` (`queued`, `processing`, `needs_review`, `verified`, `failed`, `rejected`), `failure_code`, `failure_message`, `doc_type` (`invoice`, `receipt`, `credit_note`, `other`). Unique on (`workspace_id`, `sha256`). |
| `pages` | `document_id`, `page_no`, `width`, `height`, `rotation`, `text_source` (`pdf`, `ocr`, `none`), `ocr_mean_confidence`, `tokens` JSONB of positioned tokens. |
| `extractions` | `document_id`, `kind` (`initial`, `reconcile`), `model`, `prompt_version`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `latency_ms`, `raw` JSONB. |
| `invoices` | `document_id` PK, `workspace_id`, `vendor_name`, `vendor_key` (normalised), `invoice_number`, `issue_date`, `due_date`, `currency`, `subtotal`, `tax`, `shipping`, `discount`, `total`, `fields` JSONB (per-field metadata, see 5.1), `search` tsvector over vendor, invoice number and line descriptions, written by the finalise stage, `verified_at`, `verified_by_session_id`. |
| `line_items` | `document_id`, `idx`, `description`, `quantity`, `unit_price`, `amount`, `meta` JSONB (per-cell grounding). |
| `issues` | `document_id`, `code`, `severity` (`blocking`, `warning`, `info`), `field_paths` text[], `message`, `suggestion` JSONB, `status` (`open`, `resolved`, `overridden`), `override_reason`, `resolved_at`. |
| `corrections` | `document_id`, `field_path`, `old_value` JSONB, `new_value` JSONB, `actor_session_id`. Audit trail, append-only. |
| `jobs` | `workspace_id`, `document_id`, `kind`, `status` (`queued`, `running`, `succeeded`, `failed`, `dead`), `attempts`, `max_attempts` (3), `run_after`, `locked_at`, `locked_by`, `last_error`. Index on (`status`, `run_after`). |
| `pipeline_runs` | `document_id`, `job_id`, `stage`, `status`, `started_at`, `finished_at`, `duration_ms`, `error`, `meta` JSONB. The per-document trace. |
| `usage_ledger` | `workspace_id`, `document_id`, `model`, token counts, `cost_micros`. Feeds the daily budget cap. |
| `rate_limits` | `key` PK (for example `ip:<hash>:<hour>`), `count`, `window_start`. Fixed-window counters. |
| `audit_log` | `workspace_id`, `actor_session_id`, `action`, `target_type`, `target_id`, `meta` JSONB. |

### 5.1 Field metadata

Each scalar field in `invoices.fields` stores:

```json
{
  "value": "1420.00",
  "sourceText": "Total  1,420.00",
  "page": 1,
  "bbox": [0.62, 0.71, 0.30, 0.02],
  "groundingScore": 1.0,
  "groundingMethod": "exact",
  "modelConfidence": 0.93,
  "risk": 0.05,
  "status": "pending",
  "correctedAt": null
}
```

Boxes are `[x, y, w, h]` normalised to `[0, 1]` of the rendered page with a top-left origin, so the same overlay component works over pdfjs canvases and plain images regardless of which parser produced the box.

## 6. Pipeline stages

Each stage is a function `(ctx, input) => output` that writes a `pipeline_runs` row, persists its output, and returns early if output already exists for the document, which makes retries safe.

| Stage | Input | Output | Failure modes handled |
|---|---|---|---|
| ingest | multipart file | `documents` row, blob stored, job enqueued | wrong type by magic bytes, oversized, duplicate hash (409 with link to existing), caps exceeded, uploads disabled |
| parse | blob | `pages` rows with tokens | encrypted or corrupt PDF (fail with specific message), no text layer (route to OCR), too many pages, rasterisation failure on scanned PDFs (fail with "scan format unsupported"), OCR timeout per page (page marked `none`, document continues) |
| extract | original PDF or page images | `extractions` row, draft invoice | model timeout or rate limit (retry with backoff), malformed output (one schema-guided repair retry), not an invoice (document `rejected` with the model's reason), budget exhausted (job parked with message) |
| ground | draft fields plus tokens | per-field page, bbox, score, method | no match (method `none`, risk raised), repeated values (label-proximity disambiguation), OCR noise (fuzzy match) |
| validate | invoice plus line items | `issues` rows | see section 8 |
| reconcile | blocking arithmetic issues | second `extractions` row, updated fields if better | runs at most once; keeps the version with fewer blocking issues |
| finalise | all of the above | `invoices` row status `needs_review`, risk scores | none |

### 6.1 Extraction contract

- Model: `claude-sonnet-5`, temperature 0, structured output validated against a zod schema. Input is the original file: PDFs as a document part, photos as an image part. Rasterisation is used only to feed OCR for image-only PDFs. Our own text extraction is never sent; it exists only for grounding.
- Output schema: `docType {value, confidence, reason}`, header fields each as `{value, sourceText, page, confidence}`, `lineItems[] {description, quantity, unitPrice, amount}` each cell with `sourceText`, plus `currency` and `notes`.
- The system prompt and schema are stable and cached with prompt caching. Document content sits after the cache breakpoint and is framed as untrusted data: instructions inside the document are to be extracted as text, never followed.
- Timeout 90 seconds, two retries with exponential backoff on 429 and 5xx, one repair retry on schema failure that includes the validation error.
- Token usage and computed cost are written to `usage_ledger` per call.

### 6.2 Grounding algorithm

1. Build a per-page token list from the parser: `{page, text, x, y, w, h, lineId}` in normalised coordinates.
2. For each field, generate candidate strings: the model's `sourceText`, the raw value, and normalised variants (currency symbols and grouping separators stripped, decimal comma converted when the document locale suggests it, dates rendered in the formats seen in the document).
3. Slide windows of one to twelve tokens per page. Score: exact concatenation match 1.0; normalised match 0.9; fuzzy match with Damerau-Levenshtein similarity at or above 0.85 scores similarity times 0.8. Below that, no match.
4. Prefer the page the model named. Among ties, prefer the shortest window, then the candidate nearest a label token for that field (lexicons per field, for example total: "total", "amount due", "balance due", "grand total"). This separates a line amount from the total when both read 100.00.
5. Output the union box of matched tokens, the score, and the method. Ungrounded money fields raise a blocking issue.

Unit tests cover exact, formatting variants, fuzzy OCR noise, repeated values, multi-page and no-match cases, plus Indian lakh grouping and European decimal commas.

## 7. Risk score and review order

`risk = clamp(((1 - groundingScore) + 0.5 * blockingIssuesOnField + 0.25 * min(warningsOnField, 2) + 0.2 * (1 - modelConfidence)) * criticality, 0, 1)` where criticality is 1.0 for money fields, 0.8 for identifiers and dates, 0.5 for everything else. Bands: low below 0.2, medium below 0.5, high otherwise. Review order is high, then medium, then low; within a band, money fields first. Low-risk fields are eligible for one-action acceptance. Model confidence is a weak input by design because self-reported confidence is poorly calibrated; this is recorded in decisions.md.

## 8. Validation rules

| Code | Severity | Rule | Suggestion |
|---|---|---|---|
| V001 missing_required | blocking | vendor name, invoice number, issue date, currency, total present | none |
| V002 line_sum_mismatch | blocking | sum of line amounts within tolerance of subtotal, tolerance `max(0.05, 0.01 * lines)` | digit transposition search on subtotal and on each line |
| V003 total_arithmetic | blocking | subtotal + tax + shipping - discount equals total within 0.05 | transposition search, missing-tax detection |
| V004 line_math | warning | quantity times unit price equals amount within 0.02 | per-line correction proposal |
| V005 date_order | warning | due date not before issue date | none |
| V006 date_range | warning | issue date within ten years back and thirty days ahead | none |
| V007 currency_conflict | warning | currency symbol in source text conflicts with the code | proposed code |
| V008 duplicate_invoice | warning | same vendor key and invoice number already in workspace | link to the other document |
| V009 negative_total | info | negative total, possible credit note | none |
| V010 ungrounded_money | blocking | a money field could not be located in the document | none |
| V011 not_an_invoice | blocking, document rejected | classification is `other` | none |
| V012 low_ocr_confidence | warning | mean OCR confidence below 0.6 | none |

Blocking issues must be resolved by a correction or explicitly overridden with a reason before a document can be verified. Warnings never block.

## 9. Job queue

- Enqueue on upload. Claim with a single statement: update the oldest `queued` jobs whose `run_after` has passed to `running`, selected `FOR UPDATE SKIP LOCKED`, limited by the free concurrency slots, returning the rows.
- Concurrency: at most 2 running jobs per workspace, 5 globally, both enforced by the claim query.
- Drain triggers: after each upload response via `after()`; from the workspace status endpoint the client already polls, also via `after()` so the poll stays fast; and from the daily cron for stale-job sweep. Vercel Hobby limits cron to once per day, which is why polling is a drain trigger; on Pro a one-minute cron replaces it. Recorded in decisions.md.
- Stale detection: a `running` job with `locked_at` older than six minutes is requeued with backoff `30s * 2^attempts`, or marked `dead` after three attempts. Dead jobs surface in the UI with a retry button.
- Each stage checkpoints, so a resumed job skips completed stages.

## 10. Identity and sessions

- Better Auth with the Drizzle adapter stores users, sessions and accounts in our Postgres. The anonymous plugin creates a guest user on first visit; the session token is random, stored hashed, and delivered in an httpOnly, Secure, SameSite=Lax cookie with expiry and rotation.
- A workspace is created with every user. Guest workspaces carry `expires_at` seven days out; a daily cleanup job deletes expired workspaces, their blobs and rows.
- "Sign in with Google to keep this workspace" links the anonymous user to a Google account through Better Auth's link flow; the workspace's owner is updated, its kind becomes `account`, and expiry is cleared. Scopes are limited to openid, email and profile. If Google credentials are not configured, the sign-in entry point is hidden and everything else works.
- Every data access goes through a repository layer whose functions take a `workspaceId` derived from the session, never from the request. A test asserts cross-workspace reads return nothing.
- Guests can delete their workspace at any time.

## 11. Security

**Threat model.** Assets: uploaded documents, extracted financial data, the model API key and budget, availability. Attackers: anonymous internet users seeking free compute or data, malicious documents targeting parsers or the model, cross-tenant snooping, injection of document-derived content into the UI.

| Threat | Control |
|---|---|
| Cross-tenant access | workspace-scoped repository layer, ids never trusted from the client, isolation test |
| Malicious files | magic-byte type detection, 4 MB and 10 page caps, pdfjs with scripting and XFA disabled under a timeout, images re-encoded to strip metadata, filenames never used as paths, private blob store served only through an authenticated route handler that streams bytes |
| Prompt injection via document text | content framed as data in the prompt, schema validation of output, grounding requirement, red-team fixture in tests |
| XSS from document-derived strings | React escaping, no `dangerouslySetInnerHTML`, nonce-based CSP with no inline scripts |
| CSRF | same-origin check on every mutating route via `Sec-Fetch-Site` and `Origin`, SameSite cookies |
| Abuse and cost | per-IP upload limit, per-workspace caps, global daily model budget, body size limits, idempotent uploads, `UPLOADS_ENABLED` kill switch |
| Transport and headers | HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, `Permissions-Policy` |
| Secrets | server-only env validated at boot with `@t3-oss/env-nextjs`, none reach the client bundle |
| Supply chain | pnpm lockfile, `pnpm audit` in CI failing on high severity, Dependabot |
| Accountability | append-only `corrections` and `audit_log` with the acting session |

## 12. API surface

Route handlers return JSON validated by zod on input and typed on output. All are workspace-scoped through the session.

| Method and path | Purpose |
|---|---|
| `POST /api/documents` | multipart upload, up to 5 files, returns documents and jobs |
| `GET /api/documents` | ledger query: cursor, status, q, vendor, from, to, min, max, currency, sort |
| `GET /api/documents/:id` | document, pages, invoice, line items, issues, trace summary |
| `GET /api/documents/:id/file` | streams the bytes after a workspace check; there are no public blob URLs |
| `POST /api/documents/:id/retry` | requeue a failed or dead job |
| `DELETE /api/documents/:id` | delete document, blob, rows |
| `POST /api/documents/:id/fields` | accept, correct, or undo one field; optimistic on the client |
| `POST /api/documents/:id/accept-low-risk` | accept every low-risk pending field |
| `POST /api/documents/:id/issues/:issueId/override` | override a blocking issue with a reason |
| `POST /api/documents/:id/verify` | verify when no open blocking issues remain |
| `GET /api/documents/:id/trace` | pipeline runs for the trace drawer |
| `GET /api/workspace/status` | counts and in-flight documents; triggers drain via `after()` |
| `POST /api/workspace/samples` | load the sample set |
| `DELETE /api/workspace` | delete everything |
| `GET /api/export.csv` | CSV of the current filter |
| `GET /api/health` | database and blob reachability |
| `GET /api/cron/daily` | protected by `CRON_SECRET`: stale sweep, expired guest cleanup |
| `/api/auth/*` | Better Auth handler |

## 13. Frontend architecture

**Routes.** `/` documents dashboard with drop zone and status; `/documents/[id]` review; `/invoices` ledger with filters, search and export; `/how-it-works` explainer also available as a dialog from the review screen. Sign-in is a small page rendered by our own UI over Better Auth's client.

**Review screen composition.** `DocumentViewer` renders pages lazily inside a virtualised column, using `react-pdf` for PDFs and `img` for photos, with a `HighlightLayer` of absolutely positioned, transform-based boxes from normalised coordinates. `FieldPanel` lists fields grouped into header, amounts and line items, sorted by risk, each `FieldRow` showing value, source snippet, risk chip and actions. `IssueBanner` summarises open issues with jump links. `ReviewToolbar` holds accept-all-low-risk, verify, retry, trace and shortcuts. `TraceDrawer` shows stage timeline with durations and errors. Selection is bidirectional: selecting a field scrolls and highlights its source; clicking a highlight focuses its field.

**Keyboard model.** Arrow keys or `j` and `k` move between fields, `Enter` accepts, `e` edits, `Esc` cancels, `a` accepts all low-risk, `v` verifies, `t` opens the trace, `?` opens the shortcuts dialog. Roving tabindex within the field list; focus is restored after dialogs.

**State.** RSC renders initial data. TanStack Query owns client data: document detail polls every two seconds while processing, the dashboard polls while any document is in flight, mutations apply optimistic updates with rollback on error. Filters on `/invoices` live in the URL. The PDF library loads only on the review route.

**Announcements.** A polite live region announces pipeline progress and review actions; an assertive one announces failures. Overlays are `aria-hidden`; the field list carries the accessible equivalent: page number and quoted source text.

## 14. Design system

Derived from Zamp's marketing site and product app: Geist and Geist Mono, near-black on warm off-white, hairline borders instead of shadows, pill primary buttons, one blue accent, restraint everywhere.

- **Type.** Geist Sans for interface text; Geist Mono for amounts, dates, identifiers and section labels, with `tabular-nums`. Scale 12, 14, 16, 20, 24, 32; headings track -0.02em.
- **Light tokens.** background `#FBFBFA`, surface `#FFFFFF`, surface-2 `#F3F2EF`, border `rgba(23,23,23,0.10)`, border-strong `rgba(23,23,23,0.20)`, text `#171717`, muted `#5F5E5A`, accent `#005EFF`, accent-hover `#0047C2`, success `#146C32` on `#E7F5EC`, warning `#8A5300` on `#FFF3DD`, danger `#B42318` on `#FDECEC`, highlight fill `rgba(0,94,255,0.16)` with a 1.5px `#005EFF` outline, active highlight `rgba(0,94,255,0.28)` with 2px.
- **Dark tokens.** background `#0F0F0E`, surface `#171716`, surface-2 `#1F1F1D`, border `rgba(255,255,255,0.10)`, text `#F2F2F0`, muted `#A5A49E`, accent `#5C9BFF`, success `#6CCB8B`, warning `#F0B458`, danger `#F28B82`, highlight fill `rgba(92,155,255,0.22)`.
- **Shape and motion.** Radii 6 for small controls, 10 for cards and inputs, pill for primary buttons. No shadows except dialogs. Transitions 150ms ease-out, disabled under `prefers-reduced-motion`.
- **Components.** shadcn: button, input, dialog, dropdown menu, tooltip, badge, table, tabs, separator, skeleton, sheet, toast via sonner. Themes switch through the same tokens with `prefers-color-scheme` and an explicit toggle.
- Every foreground and background pair is checked for WCAG AA contrast in a unit test over the token file.

## 15. Accessibility acceptance criteria

- Skip link, landmarks, a single `h1` per route, logical heading order.
- Every interactive element reachable and operable by keyboard; visible 2px focus ring with offset on everything; no keyboard traps; dialogs trap and restore focus.
- Every icon-only button has an accessible name; every form field has a label, and errors are linked with `aria-describedby`.
- Status changes announced through live regions; table sort state exposed with `aria-sort`.
- Colour is never the only signal; status chips carry text and an icon.
- PDF text layer enabled so document text is readable and selectable by assistive tech.
- Layout works at 200% zoom and at 400px width; touch targets at least 24px.
- `@axe-core/playwright` runs on every route in CI with zero violations allowed; `eslint-plugin-jsx-a11y` in lint; a manual VoiceOver pass of the review flow is documented in the README.

## 16. Performance budgets

- Core Web Vitals targets: LCP under 2.5s, INP under 200ms, CLS under 0.1 on `/`, `/invoices` and the review route under Lighthouse's throttled profile.
- JavaScript under 180 kB gzipped on `/` and `/invoices`; the review route may add the PDF library lazily.
- Lighthouse CI thresholds fail the build below: performance 90 (85 on the review route), accessibility 100, best practices 95.
- Techniques: RSC for initial data, route-level code splitting, virtualised lists, lazy page rendering, transform-based overlays, `useTransition` for filters, debounced search, self-hosted fonts with preload and `font-display: swap`, prefetch on hover, cursor pagination, indexed queries, pooled database connections, prompt caching.
- A load test script fires twenty concurrent uploads against the mock model and reports queue timing; results go in the README.

## 17. Observability

- `pipeline_runs` is the per-document trace, shown in the trace drawer with stage, duration, status and error.
- Structured JSON logs with request id, workspace id and job id; no document content is logged.
- `/api/health` checks database and blob reachability.
- Usage and cost per document from `usage_ledger`, with a daily aggregate visible in the health payload.
- Vercel Hobby retains runtime logs for one hour, which is why the trace lives in Postgres.

## 18. Guardrails and limits

| Limit | Value | Behaviour when hit |
|---|---|---|
| File size | 4 MB | rejected with message |
| Pages per document | 10, OCR on at most 5 | rejected or OCR limited with notice |
| Documents per guest workspace | 25 | upload blocked with message |
| Files per upload request | 5 | rejected |
| Uploads per IP per hour | 30 | 429 with retry hint |
| Global daily model budget | `BUDGET_DAILY_USD`, default 3 | jobs park with an honest message; samples remain fully explorable |
| Running jobs | 2 per workspace, 5 global | queued |
| Extraction timeout | 90s | retry, then failed |
| OCR per page | 25s | page marked unreadable, document continues |
| Job attempts | 3 | dead, retry button |
| Guest workspace lifetime | 7 days | purged by daily cleanup |

## 19. Sample and evaluation set

Eight documents generated by a script in the repo from HTML templates and image processing, each with ground truth:

1. `clean-digital.pdf`, one-page SaaS invoice in USD.
2. `multipage-lineitems.pdf`, three pages, 25 line items spanning pages, INR with lakh grouping.
3. `euro-format.pdf`, EU vendor with `dd.mm.yyyy` dates, decimal commas, VAT.
4. `scan-photo.jpg`, phone photo of a printed invoice, slight rotation and shadow.
5. `scan-lowres.pdf`, image-only PDF at low resolution with one ambiguous digit, producing the handled failure case.
6. `mismatch-total.pdf`, digital invoice with a vendor arithmetic error, exercising override with reason.
7. `injection.pdf`, contains an instruction to set the total to zero, proving document text is not obeyed.
8. `not-an-invoice.pdf`, a bank statement page, exercising rejection.

Re-uploading the first document exercises duplicate detection. A recorded extraction per sample powers mock mode. `pnpm eval` runs the pipeline over the set, live or recorded, and reports field accuracy after normalisation, grounding rate and issue precision; the report goes in the README.

## 20. Testing strategy

- **Unit (Vitest).** Number and date normalisers across locales; grounding matcher cases; every validation rule and the transposition suggester; risk scoring bands; the filter-to-SQL builder including cursor encoding; CSV escaping; rate limiter windows; token contrast checks.
- **Integration (Vitest on PGlite).** Full pipeline with the mock model per sample; malformed model output and repair; timeout to retry to dead letter; not-an-invoice rejection; duplicate upload; concurrent job claims never double-process; workspace isolation.
- **End to end (Playwright).** Load samples, open a document, correct a field, verify, find it in a filtered ledger and export; corrupt upload shows a clear error; keyboard-only review; axe on every route.
- **Performance.** Lighthouse CI on the built app with mock mode.
- **Load.** Twenty concurrent uploads script with a summary table.
- CI on every push: lint and typecheck, unit and integration, e2e, Lighthouse, dependency audit.

## 21. Local setup and environments

`pnpm install && pnpm dev` runs with zero external services: PGlite on disk with automatic migrations, blobs under `.data/`, and the mock model replaying recorded extractions. Setting `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` and `ANTHROPIC_API_KEY` switches each concern to the real service independently. Other variables: `LLM_MODE` (`live`, `mock`, `record`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, optional `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`, `BUDGET_DAILY_USD`, `UPLOADS_ENABLED`. All validated at boot. Scripts: `dev`, `build`, `test`, `test:e2e`, `eval`, `load-test`, `db:migrate`, `db:studio`, `samples:generate`, `samples:record`.

## 22. Deployment and CI

- Vercel project connected to the GitHub repo: preview deployments per pull request, production from `main`. Neon provisioned through the Vercel Marketplace into the project; a Blob store created in the project. Environment variables set through the Vercel CLI after Sagar's login.
- GitHub Actions workflow with jobs: `check` (lint, typecheck), `test` (unit, integration), `e2e` (Playwright with mock and PGlite), `lighthouse` (build, start, `lhci autorun`), `audit` (`pnpm audit --prod`).
- Vercel cron entry for the daily job with `CRON_SECRET`.

## 23. Documentation deliverables

- `README.md`: what and who, live URL, a GIF of the review flow, quickstart, architecture diagram, how grounding and validation work, accuracy report, Lighthouse and load results, accessibility notes, limits, environment variables, testing.
- `decisions.md`: the brief from section 2 at the top, then dated entries each with decision, alternatives, reasoning and what was cut. Seeded entries: problem choice and framing; single app over queue services; Postgres queue with skip-locked; sending the original PDF to the model; grounding over trusting model confidence; fixed schema over user-defined fields; guest sessions over mandatory login; Sonnet 5 everywhere over a tiered model plan; PGlite locally over Docker; route handlers plus TanStack Query over server actions; polling over SSE; Vercel Hobby cron constraint; Tesseract with degraded grounding for scans; what was cut and why.
- `docs/architecture.md` with the diagram and module map; `docs/accessibility.md` with the manual pass; `docs/threat-model.md`.

## 24. Build plan

| Day | Core | Parallel track |
|---|---|---|
| 1 | Scaffold, tokens and base components, schema and migrations, Better Auth guest sessions, upload to blob, jobs and drain skeleton, stage interfaces with mock model, first deploy | Sample document generator and ground truth |
| 2 | Parse with pdf text and OCR, live extraction, grounding, validation, persistence | Review screen v1: viewer, overlays, field panel, polling |
| 3 | Review interactions, risk ordering, keyboard model, live regions, issue banner, reconcile stage | Ledger page with filters, search, cursor pagination, export |
| 4 | Rate limits, budget, caps, dedup, stale jobs, retries, error states, trace drawer, health, security headers and CSP, same-origin checks, cleanup cron | Google sign-in and workspace linking |
| 5 | Unit, integration and e2e suites, axe, eval script and report | Load test, Lighthouse CI, performance fixes |
| 6 | README, architecture, threat model, decisions.md pass, first-run and empty and error state polish, dark theme, screen-reader pass, narrow viewport | GIF and screenshots |
| 7 | Buffer, final deploy, submission checklist | |

Independent tracks are delegated to subagents with the spec as their contract.

## 25. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tesseract memory or cold start on Vercel | day-2 spike; page cap; fields degrade to "no source location" rather than failing; documented |
| Scanned-PDF rasterisation needs a native canvas binary | prebuilt Linux binary; on failure the document reports "scan format unsupported"; the JPG sample keeps the demo path independent |
| AI SDK 7 API differences from training data | verify calls against current docs before writing them |
| Anonymous-to-Google account linking edge cases | implemented last; guest path never depends on it |
| Neon cold start after idle | noted in README; optional free pinger only with Sagar's consent |
| TypeScript 7 toolchain friction | pin the 5.9 line if lint or Next complains |
| Scope versus seven days | strict day plan; anything slipping past day 5 becomes a documented cut |

## 26. Out of scope

Multiple document types or user-defined schemas, ERP and accounting integrations, approval workflows, teams and shared workspaces, email or mobile capture, vector search or chat over documents, model fine-tuning, UI localisation, SSO, custom domains, a separate worker service.
