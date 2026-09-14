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

## 2026-09-14: Keep create-next-app's generated AGENTS.md and CLAUDE.md

**Decision.** Keep the AGENTS.md and CLAUDE.md files create-next-app@16 generates by default, unmodified.
**Alternatives.** Delete them, since the brief does not mention them; hand-edit AGENTS.md's wording.
**Reasoning.** AGENTS.md says it is written and re-added by `next dev`, so removing or editing it just recreates an uncommitted change the next time someone runs dev. CLAUDE.md is a one-line import of it. Neither conflicts with anything the brief specifies.
**Cut.** Nothing. Left as framework-generated content rather than treated as project prose.

## 2026-09-14: pnpm-workspace.yaml build script approvals

**Decision.** Approve esbuild's install script. Block @prisma/client and better-sqlite3.
**Alternatives.** Approve all three. Block all three. Run `pnpm approve-builds` interactively instead of editing the file directly.
**Reasoning.** esbuild is a trusted, already-working build tool that tsx and vitest need. @prisma/client and better-sqlite3 arrive only as optional adapters of @better-auth/cli. This project uses drizzle-orm with PGlite and pg, never Prisma or SQLite, so their install scripts have nothing to do.
**Cut.** Native compilation for better-sqlite3 and Prisma client generation. Neither is reachable from this codebase.

## 2026-09-14: next typegen before typecheck

**Decision.** Set the typecheck script to `next typegen && tsc --noEmit`.
**Alternatives.** Keep a bare `tsc --noEmit`. Strip the scaffold's `LayoutProps` typed-route usage from layout.tsx instead.
**Reasoning.** The scaffolded layout.tsx uses Next 16's `LayoutProps<"/">`, a type that only exists in the gitignored `.next/types/` directory after `next dev`, `next build`, or `next typegen` has run. A bare `tsc --noEmit` fails on a fresh clone, before `build` ever populates that directory, which breaks the brief's own lint, typecheck, test, build order. `next typegen` is Next's own command for generating those types without a full build.
**Cut.** Nothing. Kept the scaffold's generated layout code instead of removing a framework feature to avoid the dependency.

## 2026-09-14: type module in package.json

**Decision.** Add `"type": "module"` to package.json.
**Alternatives.** Rename vitest.config.ts to vitest.config.mts. Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true`. Leave the warning in place.
**Reasoning.** `pnpm test:unit` printed a real Vite config-loader warning because vitest.config.ts uses ESM syntax with no `type` field declaring it. The brief names the file vitest.config.ts, so renaming it was not an option. Setting `type: module` is the standard fix and matches the direction Vite says its config loader is heading. Verified safe by rerunning lint, typecheck, test:unit and build afterward.
**Cut.** Nothing. All four verification commands stayed green after the change.

## 2026-09-14: Zamp-derived tokens mapped onto shadcn variables

**Decision.** A small token file holds the Zamp-derived palette and radii; shadcn 4, built on Base UI primitives, aliases its variables to those tokens so every generated component follows the palette without edits.
**Alternatives.** Hand-written components; keeping shadcn's default neutral theme.
**Reasoning.** Base UI primitives give keyboard and screen-reader behaviour for free, which matters more than owning every component. Aliasing keeps one source of truth for colour and lets a unit test enforce AA contrast on every pair.
**Cut.** A custom component library. Depth belongs in the review flow, not in buttons.
