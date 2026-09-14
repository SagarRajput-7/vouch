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

## 2026-09-14: Keep the shadcn/tailwind.css import

**Decision.** Keep `@import "shadcn/tailwind.css";` in globals.css alongside the Zamp token import, in addition to the brief's literal Step 6 text.
**Alternatives.** Drop the import, since the brief's resolution only names `tw-animate-css` as an import to keep; hand-write the missing custom variants directly in globals.css instead of importing shadcn's own copy.
**Reasoning.** This shadcn 4 generation ships `data-open`, `data-closed`, `data-horizontal`, `data-vertical` and `data-active` as custom variants defined only in that file. Separator, Tabs, Dialog, DropdownMenu and Tooltip reference them directly, and Separator renders with no width or height at all without it, not just without animation. Keeping the import follows the same principle the brief already applies to `tw-animate-css`: keep the infrastructure the installed shadcn version needs, and override values, not structure.
**Cut.** Hand-rolled duplicates of shadcn's custom variants. Importing the maintained file avoids drift from whatever future `shadcn add` commands assume is present.

## 2026-09-14: PGlite data directory bootstrap

**Decision.** `create()` in `src/lib/db/client.ts` creates the on-disk PGlite data directory recursively before opening it, through a small exported helper, `ensurePgliteDir(dir)`.
**Alternatives.** Document that a fresh clone must create `.data/pglite` itself before the first `pnpm dev`; ship a postinstall script that creates it.
**Reasoning.** One-command setup is a stated criterion, and the installed `@electric-sql/pglite@0.5.8` Node filesystem backend does a single, non-recursive `mkdirSync` for its data directory, so a fresh checkout with no `.data` yet crashed PGlite construction with ENOENT the first time anything booted without `DATABASE_URL` set. This task's Better Auth CLI schema generation also ran from the already-installed `@better-auth/cli` devDependency rather than `pnpm dlx @latest`, for the same reproducibility reason.
**Cut.** A postinstall hook. It would run, and create a directory, for every install of the project, including everyone who only ever points `DATABASE_URL` at Postgres and never touches PGlite.

## 2026-09-14: Guest sessions are real sessions, bootstrapped by a redirect

**Decision.** First visits to a page route redirect once through a session-start endpoint that creates an anonymous Better Auth user and a guest workspace, then land on the page with the cookie set.
**Alternatives.** A bare random cookie with no server record; creating the session inside the proxy and rewriting request headers; client-side sign-in on mount.
**Reasoning.** A real session gives expiry, rotation, revocation, and a clean upgrade path to Google sign-in through the anonymous plugin's link hook. The single redirect costs one round trip on the first visit and avoids fiddly header rewriting or a client-side flash.
**Cut.** Creating sessions for API-only callers. Requests without a session get a 401.

## 2026-09-15: authSecret allows the Next build phase to construct auth without a real secret

**Decision.** `authSecret()` in `src/lib/env.ts` only throws its production guard when `NODE_ENV` is `"production"` and `process.env.NEXT_PHASE` is not Next's `PHASE_PRODUCTION_BUILD`. The `isProduction` export itself is unchanged.
**Alternatives.** Make the `auth` export in `src/lib/auth/server.ts` lazy, a getter or cached promise, so `betterAuth()` only constructs on first real use; require `BETTER_AUTH_SECRET` to be set for every `pnpm build` invocation, including a local build with no deployment target.
**Reasoning.** Task 5 is the first task to give a route handler a module-scope import of `auth/server.ts` (`src/app/api/session/start/route.ts` and the catch-all auth route), so `next build`'s page-data-collection step now imports that module to read its exports. `next build` always runs with `NODE_ENV=production`, including for a purely local build with no deployment target, so the existing fail-fast check treated every `pnpm build` as a real production boot and threw before the build could inspect the route. `next build` sets `process.env.NEXT_PHASE` to `phase-production-build` for exactly this step and nowhere else, confirmed by checking the installed `next` package directly; `next start` never sets it. A real `next start` in production still throws immediately when `BETTER_AUTH_SECRET` is missing, verified directly against a locally built server.
**Cut.** A lazy `auth` export. It would ripple into every file that calls `auth.api.*` synchronously (`session.ts`, both new routes), a larger change than the brief's structure calls for to fix a build-time-only problem.

## 2026-09-15: Mark @electric-sql/pglite external to Turbopack's production bundle

**Decision.** `next.config.ts` sets `serverExternalPackages: ["@electric-sql/pglite"]` so Next requires the package from `node_modules` at runtime instead of bundling it.
**Alternatives.** Leave it bundled; add `pg` to `serverExternalPackages` as well; disable Turbopack for `next build`.
**Reasoning.** Once a route handler imports `auth/server.ts` at module scope, `getDb()` runs during `next build`, constructing a real on-disk PGlite instance for the first time in this codebase's build, since no earlier task had a route or page reachable from the build importing the db client. Turbopack's production bundle broke PGlite's Emscripten-generated WASM glue (`TypeError: h.instantiateWasm is not a function`), a documented incompatibility between Turbopack's minifier and PGlite's pre-minified ESM. That error was present in the one build run before this change and absent from eight consecutive clean builds after it, including builds that reused an already-populated `.data/pglite` directory. `pg` needed no change: it already ships in Next's own default `serverExternalPackages` list, and this build never constructs a `Pool` since no `DATABASE_URL` is set locally.
**Cut.** Disabling Turbopack. It is Next 16's default bundler here and the brief does not ask to move off it; externalizing the one package that cannot survive bundling is the smaller change.

## 2026-09-15: promoteToAccount merges into the target's existing workspace instead of retiring it

**Decision.** `workspacesRepo.promoteToAccount(sourceWorkspaceId, newOwnerUserId)` runs in one transaction. When the new owner has no active workspace, it reassigns the source (owner, kind, expiry) as before and returns `{ mode: "reassigned", workspaceId: sourceWorkspaceId }`. When the new owner already has one, it deletes any source document whose `sha256` already exists in the target (cascading away that document's dependents), moves every remaining workspace-scoped row from source to target with plain `workspace_id` updates on `documents`, `invoices`, `jobs`, `usage_ledger`, and `audit_log`, soft-deletes the now-empty source workspace, and returns `{ mode: "merged", workspaceId: target.id }`. The target workspace row is never deleted or reassigned.
**Alternatives.** Retire the target's existing workspace and let the source take over its owner (the previous behaviour in this file); keep both workspaces active and add a workspace switcher to the product.
**Reasoning.** The previous fix treated a target's active workspace as disposable and soft-deleted it so the source could take that owner slot, which discards a returning user's own data the moment they link a second guest session, exactly backwards for a product about not losing verified data. Merging keeps every document from both sides (deduplicated by content hash, since the same file uploaded from two sessions should not become two rows) and keeps the target's identity and id stable, which matters once other rows or a signed-in UI start holding a reference to a workspace id. One workspace per user is still the v1 model, so the source does not survive as a second workspace; it is folded in and retired.
**Cut.** A workspace switcher that would let a merge instead keep both workspaces around and let the user pick. Nothing in this task's scope needs more than one workspace per signed-in user yet, and a switcher is real product surface, not a bootstrap concern.
