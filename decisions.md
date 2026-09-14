# decisions.md

A running log of the real calls made while building Vouch. Newest entries at the bottom. Each entry records the decision, the alternatives seriously considered, the reasoning with the trade-offs accepted, and what was deliberately cut.

## Brief

**The problem.** An accounts-payable specialist receives hundreds of vendor invoices a month as digital PDFs, scanned PDFs and phone photos. Their fear is a wrong number reaching the ledger, not slow processing. Extraction tools output numbers with no fast way to check them, so people either re-key everything or trust blindly. Vouch turns messy invoices into a verified, queryable ledger where every value is traceable to the exact spot in the source document and nothing enters the ledger unverified.

**The hard part.** Making machine-extracted values verifiable and correctable in seconds, robust to scans and bad inputs. A naive PDF-to-LLM-to-JSON pipeline cannot locate values in the source, lets arithmetic errors pass silently, produces confident nonsense on scans, and leaves the user re-checking every field anyway.

**The slice.** Upload invoices, extract, review fields ordered by risk with source highlighting, correct and verify, then filter, search and export. The handled failure case is a low-quality scan whose total does not add up.

**Deliberate cuts.** Multiple document schemas, custom fields, ERP integrations, approval workflows, multi-user teams, email ingestion, chat over documents, fine-tuning, UI localisation, SSO.

## 2026-09-14: Problem 1 over Problem 2

**Decision.** Build Problem 1, framed narrowly as verified invoice intake.
**Alternatives.** Problem 2 (schema branch, diff, merge on a real database with 5 GB tables); a self-chosen problem.
**Reasoning.** Problem 2's constraints put the hard part in online DDL and backfills, which is backend depth judged against backend candidates. Problem 1's hard part, trust in extracted values, lives in the interface layer where a senior frontend engineer should be judged, and invoices are Zamp's daily input.
**Cut.** Multi-document-type support, so that domain validation stays possible.

## 2026-09-14: One Next.js application, Postgres as the queue

**Decision.** A single Next.js App Router app with route handlers as the API and a Postgres job table claimed with `FOR UPDATE SKIP LOCKED`.
**Alternatives.** Vercel Workflow or Queues; a separate worker service.
**Reasoning.** Reviewers must run nothing. One app deploys in one step and runs locally with one command. Stage functions are idempotent and checkpointed, so moving them behind a queue product later changes deployment, not logic.
**Cut.** A dedicated worker. Vercel does not host long-running workers, and a second target hurts the setup experience.

## 2026-09-14: PGlite locally, plain `pg` for real Postgres

**Decision.** PGlite on disk for local development and tests; the standard `pg` driver for Neon in production and Postgres in CI.
**Alternatives.** Docker Compose Postgres for local; Neon's serverless WebSocket driver in production.
**Reasoning.** Zero-service local setup matters for the setup-experience criterion, and Sagar's machine has no Docker. Neon accepts plain TCP from Vercel's Node runtime, so one driver covers production and CI, and interactive transactions work without a proxy.
**Cut.** The Neon serverless driver. It exists for edge runtimes we do not use.

## 2026-09-14: pnpm

**Decision.** pnpm 12 with a committed lockfile.
**Alternatives.** npm, which is installed by default.
**Reasoning.** Faster installs in CI and strict dependency resolution catch phantom imports early.
**Cut.** Nothing.
