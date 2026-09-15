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

## 2026-09-14: Postgres queue claims with skip-locked; caps are soft

**Decision.** Jobs live in a `jobs` table and are claimed with `FOR UPDATE SKIP LOCKED`, oldest first, with per-workspace and global caps checked inside the claim query.
**Alternatives.** Advisory locks to make the caps exact; a Redis-backed queue.
**Reasoning.** Skip-locked gives correct at-least-once claiming with no extra service. The caps are enforced by counting running rows in the same statement, which two racing claimers can overshoot by one; at demo scale that is harmless and the simpler query is easier to read and test.
**Cut.** Exact caps via advisory locks. Noted as the first change if the queue ever runs hot.

## 2026-09-15: Rank-based claim caps replace same-statement correlated counts

**Decision.** `claimJobs` in `src/lib/queue/claim.ts` ranks queued candidates with `row_number()`, oldest first, both globally and per workspace, added on top of the pre-existing running count, inside a `ranked` CTE; only rows whose cumulative rank still fits under `perWorkspace`/`global` are claimed. The brief's literal query instead compared each candidate row against a plain `count(*) from jobs where status = 'running' ...` correlated subquery.
**Alternatives.** Keep the brief's literal correlated-subquery caps as written; claim jobs one at a time in a loop from application code instead of one batch statement; add advisory locks to serialize claims.
**Reasoning.** The brief's exact query failed its own "respects the per-workspace cap" test deterministically. A `count(*) from jobs where status = 'running' ...` subquery inside the `candidate` CTE reads the table as of the start of the UPDATE statement, so when several queued rows from the same workspace are claimed in one call, each row independently sees the same pre-claim running count (0, if none were already running) and all of them pass `< perWorkspace`. Three queued jobs in a fresh workspace with `perWorkspace: 2` were all claimed instead of two. This is standard single-statement MVCC snapshot behaviour and reproduced identically against a real, separately started Postgres 18 server, not a PGlite quirk; five isolated runs against that server, including the concurrency test PGlite skips, passed every time after the fix. Adding each row's oldest-first position via `row_number()` on top of the pre-existing count makes the cap exact within one batch, while leaving the documented softness between two separate concurrent claim statements unchanged, per the resolution not to add advisory locks. `FOR UPDATE` cannot combine with window functions in the same `SELECT`, so ranking lives in its own CTE and the `candidate` CTE re-selects by id to take the row locks.
**Cut.** Advisory locks, which would make even the cross-statement race exact; the brief's resolutions explicitly rule this out. Claiming one row at a time from application code, which would abandon the single round-trip batch claim the brief and the concurrency test depend on.

## 2026-09-15: sweepStale casts its CASE expression to job_status

**Decision.** `sweepStale`'s `UPDATE` casts its `CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END` expression to `::job_status` before assigning it to the `status` column. The brief's literal query left the expression uncast.
**Alternatives.** Keep the brief's literal uncast `CASE` expression; split the update into two separate statements, one for rows going dead and one for rows being requeued, each assigning a bare string literal.
**Reasoning.** The brief's literal query failed the "requeues stale running jobs" test with a real Postgres error, reproduced the same way against a real Postgres 18 server: `column "status" is of type job_status but expression is of type text`. A bare string literal assigned directly to an enum column is implicitly coerced from its "unknown" literal type, but once two such literals sit inside a `CASE WHEN ... THEN ... ELSE ... END`, Postgres resolves the expression's own type to `text`, and assigning `text` to an enum column needs an explicit cast. The cast is the smallest fix that keeps the single-statement shape.
**Cut.** Splitting into two statements. It would work but doubles the round trips against a design that is otherwise a single `UPDATE`.

## 2026-09-14: Ground truth doubles as the mock model

**Decision.** The mock model returns the sample ground truth for known documents and classifies unknown files as "not an invoice" with a message pointing at the API key.
**Alternatives.** A canned generic extraction for any file; recorded live responses only.
**Reasoning.** One artifact drives the demo content, the mock, the tests and the accuracy evaluation, so they cannot drift apart. Recorded live responses are added later for fidelity, but ground truth is the floor.
**Cut.** Fabricating plausible values for unknown files. Honest rejection beats convincing nonsense.

## 2026-09-14: Stages checkpoint through pipeline_runs

**Decision.** Each stage records a run row and is skipped on retry if a succeeded row exists. Later stages reload their inputs from the database when the in-memory state is empty.
**Alternatives.** Re-running the whole pipeline on every retry; a single status column per document.
**Reasoning.** A retry after a model timeout should not pay for parsing again, and the run rows are the per-document trace shown in the UI, so checkpointing and observability are the same table.
**Cut.** Per-stage retry counts. The job's attempt budget covers the whole pipeline.

## 2026-09-15: parseMoney uses BigInt(...) calls instead of BigInt literal syntax

**Decision.** `src/lib/normalize/money.ts` builds its cents-scaled integer with `BigInt(100)`, `BigInt(1)`, and `BigInt(0)` function calls instead of the brief's literal `100n`, `1n`, `0n` BigInt syntax in the same three expressions. The redundant clause in the brief's `isThousands` expression (already flagged as simplifiable in the task's ambiguity resolutions) was also reduced to `after.length === 3`, which is a behaviour-preserving simplification, not a deviation, and needed no entry; the now-unused `sep` variable it left behind was removed to keep `pnpm lint` warning-free.
**Alternatives.** Keep the brief's literal BigInt syntax as written; raise `tsconfig.json`'s `compilerOptions.target` from `ES2017` to `ES2020` or later so the literal syntax typechecks.
**Reasoning.** `pnpm typecheck` failed with `TS2737: BigInt literals are not available when targeting lower than ES2020` on all three literals. Unlike most later syntax (optional chaining, `??`), TypeScript cannot down-level a BigInt literal into an equivalent pre-ES2020 form, so it refuses the syntax outright below that target regardless of the `lib` setting, and this project's `tsconfig.json` targets `ES2017` for reasons unrelated to this task. `BigInt(100)` and `100n` construct the identical runtime value, and `BigInt(whole)` / `BigInt(cents)` in the same expression already used the function form, so switching the remaining three literals to match is a pure syntax substitution with no behavioural change: all 16 `parseMoney` table rows and the null-input case still pass.
**Cut.** Raising the project-wide `target`. That changes what syntax `tsc --noEmit` accepts everywhere, a larger and unrelated surface change for a one-file problem, and Next's own build uses SWC/Turbopack, not this `target`, for its actual emit, so raising it would buy nothing beyond satisfying this one file.

## 2026-09-15: runJob only marks a document "processing" when a stage is about to actually run

**Decision.** `runJob` in `src/lib/pipeline/runner.ts` moves the `documentsRepo.setStatus(document.id, "processing")` call from unconditionally before the stage loop to inside the loop, right after the existing `hasSucceeded` check, so it only runs immediately before a stage that has not already succeeded is about to run.
**Alternatives.** Keep the brief's literal unconditional `setStatus(document.id, "processing")` before the loop; pre-scan `stages` for any stage still pending and call `setStatus` once before the loop only if the scan finds one.
**Reasoning.** The brief's literal runner set "processing" unconditionally, before checking which stages still need to run, and relied on a stage's own `run()` to move status elsewhere again (`finaliseStage` sets `needs_review`; the extract stage's reject branch sets `rejected`). The integration test's "idempotent on re-run" case requeues a job whose document already reached `needs_review` and calls `runJob` again; every stage's `pipeline_runs` row already reads `succeeded`, so the existing `hasSucceeded` check skips both stages via `continue` and no stage ever runs to move status off "processing", leaving the document stuck there even though the job still reports `succeeded`. Reproduced deterministically: the test failed with the document at `processing` instead of the expected `needs_review` before this change and passed after it, with the "no new `pipeline_runs` rows" assertion holding both before and after, since that half of the checkpoint logic was already correct. Gating the same `setStatus` call on the same `hasSucceeded` result the loop already computes keeps every other behaviour identical, a stage that actually runs still flips the document to "processing" first, exactly as before, and means a fully skipped, fully idempotent replay never touches document status at all, leaving whatever the last real run left behind.
**Cut.** Pre-scanning `stages` for pending work and calling `setStatus` once up front. It would produce the same outcome but adds a second full pass of `hasSucceeded` lookups (one to decide whether to set "processing", one inside the loop to decide whether to skip) for no behavioural difference from checking inline.

## 2026-09-15: The file route re-wraps blob bytes in a fresh Uint8Array instead of passing them straight to Response

**Decision.** `GET /api/documents/[id]/file` constructs its `Response` with `new Uint8Array(blob.bytes)` instead of the brief's literal `blob.bytes` as the body argument.
**Alternatives.** Keep the brief's literal `new Response(blob.bytes, { ... })`; cast the argument with `blob.bytes as BodyInit`; widen `BlobObject.bytes` in `src/lib/blob/types.ts` to `Uint8Array<ArrayBuffer>`.
**Reasoning.** `pnpm typecheck` failed with `TS2345: Argument of type 'Uint8Array<ArrayBufferLike>' is not assignable to parameter of type 'BodyInit | null | undefined'`. TypeScript 5.9's `lib.dom.d.ts` defines `BufferSource` (part of `BodyInit`) as `ArrayBufferView<ArrayBuffer> | ArrayBuffer`, but `BlobObject.bytes` is typed as the bare `Uint8Array`, which defaults its generic to `Uint8Array<ArrayBufferLike>` so it can also represent a `SharedArrayBuffer`-backed view; `ArrayBufferLike` is wider than the `ArrayBuffer` the DOM type requires, so the two do not line up structurally even though every real value here is backed by a concrete `ArrayBuffer`. `Uint8ArrayConstructor`'s `new (array: ArrayLike<number>): Uint8Array<ArrayBuffer>` overload turns an existing typed array into a freshly, concretely typed one, so wrapping is a real fix, not a suppression: the result is verifiably `ArrayBuffer`-backed rather than merely asserted to be. `BlobObject` lives in `src/lib/blob/types.ts`, a Task 7 file outside this task's file list, and other already-shipped, already-tested code (`local-fs.ts`, `vercel.ts`) depends on its current shape, so this task widens nothing there.
**Cut.** A type assertion (`as BodyInit`). It would compile but would silently accept a `SharedArrayBuffer`-backed view too, which the DOM type is correctly rejecting; re-wrapping keeps that check real for a one-file, one-call-site problem instead of switching it off. Widening the shared `BlobObject` type, which would ripple into two files this task does not own.

## 2026-09-15: Manual retry reprocesses a document from scratch

**Decision.** `POST /api/documents/[id]/retry` calls the new `pipelineRunsRepo.deleteByDocument(documentId)` before requeueing the job, clearing every stage checkpoint for that document so the next drain re-runs `extract` instead of finding a succeeded checkpoint and skipping straight to `finalise` on a stale extraction.
**Alternatives.** Keep the existing checkpoints on manual retry, the same behaviour automatic job retries already use; mark only the halted stage for re-run instead of clearing the whole trace.
**Reasoning.** A person retrying a rejected or failed document disagrees with the earlier outcome, so nothing from that earlier run should be trusted, including an `extract` checkpoint that produced the rejection in the first place. Automatic retries (a transient model timeout, a dead network call) keep their checkpoints because the earlier stages likely still hold good data; a manual retry is a different event, an explicit signal that the previous result was wrong. `pipelineRunsRepo.listByDocument` also backs the trace shown in the document detail view, so clearing it doubles as clearing the stale trace a user would otherwise see next to a freshly reprocessed document.
**Cut.** Per-stage retry controls, which would let a user re-run only `finalise` after correcting a field. Nothing in this task's scope needs more than one retry action per document yet.

## 2026-09-15: In-memory PGlite during the production build phase

**Decision.** `create()` in `src/lib/db/client.ts` opens PGlite in memory (`new PGlite()`, no on-disk directory) whenever the new pure helper `shouldUseInMemoryPglite({ NEXT_PHASE, DATABASE_URL, PGLITE_DATA_DIR })` returns true: an explicit `PGLITE_DATA_DIR=":memory:"` configuration (unchanged from before), or `process.env.NEXT_PHASE === "phase-production-build"` with no `DATABASE_URL` set. Every other path, including `ensurePgliteDir` for the normal on-disk case, is unchanged.
**Alternatives.** Lazy database initialisation behind a proxy for Better Auth, so `auth/server.ts`'s module-scope `getDb()` call only actually opens a connection on first real use instead of at import time; serialising the build's page-data collection (disabling Next's worker parallelism) so only one process ever opens the on-disk directory at a time.
**Reasoning.** `next build` collects page data for every route module across several parallel worker processes, and any route that imports the auth/session chain transitively calls `getDb()` at module scope, so multiple workers were opening the same on-disk `.data/pglite` directory from separate OS processes at once, which intermittently raced (`PGlite failed to initialize properly`, `RuntimeError: Aborted()`) though it never failed the build outright. A build needs no real data, so giving each worker its own private, ephemeral in-memory instance removes the contention entirely rather than reducing its odds. `pnpm build` run five times in a row after this change showed zero occurrences of either error line, versus roughly half of runs before it. Production never hits this path: a real production boot always sets `DATABASE_URL`, which short-circuits `create()` before `shouldUseInMemoryPglite` is even consulted, exactly like the existing on-disk path production already skips.
**Cut.** Reworking the adapter wiring so `auth/server.ts` no longer calls `getDb()` at module scope. That was already considered and deferred by the 2026-09-15 "authSecret allows the Next build phase to construct auth without a real secret" decision as a larger change than any single task's structure calls for; this fix stays inside `src/lib/db/client.ts`, the file that actually owns how and where PGlite opens.

## 2026-09-15: Workspace status scopes its response counts while the drain trigger consults the global queue

**Decision.** `GET /api/workspace/status` computes `queuedJobs` in the response body from `jobsRepo.countQueued(session.workspaceId)`, scoped to the caller's own workspace. The drain trigger condition below it still calls the unscoped `jobsRepo.countQueued()` (now that `countQueued` takes an optional workspace id, counting globally when omitted) and uses that global count only to decide whether to call `scheduleDrain`; the global number itself is never placed on the response body.
**Alternatives.** Scope the drain trigger to the caller's workspace too, so it only ever fires `scheduleDrain` for jobs the caller can see; drop `queuedJobs` from the response entirely instead of scoping it.
**Reasoning.** `queuedJobs` reaches the client in the JSON body, so it is a workspace-scoped value under the project's rule that every such value derives from the session; counting across every workspace let one workspace observe the size of another's backlog, a real information leak, confirmed by a test that enqueues a job directly into a second workspace and shows the first session's response reporting `1` before this fix and `0` after it. The drain it triggers, however, is a shared, best-effort safety net for a Hobby-plan deployment with no persistent worker: `drain()` in `src/lib/queue/drain.ts` claims across every workspace up to `JOB_LIMITS.global`, not just the caller's, and it runs and returns within the same server process rather than leaving it, so scoping the trigger to the caller's own workspace would not scope what actually gets processed, only whether some OTHER workspace's stuck jobs ever get a chance to run, and only when a client from THAT workspace happens to poll status. Keeping the trigger global keeps every workspace's queue moving no matter which workspace's browser tab happens to be open, while the number that reaches JSON stays properly scoped. `Dashboard` calls this route through `useWorkspaceStatus(anyInFlight(docs))` while anything is queued or processing, which is what actually triggers the drain and lets `sweepStale` recover a job stuck behind a stale lock or a failed attempt.
**Cut.** Scoping the drain trigger to the caller's own workspace. It would still leak nothing over the wire, but would leave another workspace's queued jobs stalled until someone from that specific workspace happened to poll status themselves, which defeats the point of a shared drain safety net on a deployment with no background worker. Dropping `queuedJobs` from the response, which the dashboard does not read today; its in-flight signal is `anyInFlight` over `/api/documents`, not this field, so scoping `queuedJobs` rather than dropping it costs nothing the UI currently relies on.

## 2026-09-14: Polling over server-sent events for job status

**Decision.** The dashboard polls the documents list every two seconds while anything is in flight and stops when nothing is.
**Alternatives.** Server-sent events; WebSockets.
**Reasoning.** Polling reuses the same JSON endpoint and TanStack Query cache the rest of the page uses, and needs no connection management. Documents take seconds, not milliseconds, so two-second latency is invisible. A second poll, `useWorkspaceStatus`, runs in parallel against `GET /api/workspace/status` while anything is in flight; that request, not this one, is what actually triggers a server-side drain on the Hobby plan where cron cannot run every minute, and lets `sweepStale` recover a job stuck behind a stale lock or a failed attempt.
**Cut.** A streaming channel. Worth revisiting only if the review screen needs sub-second updates.

## 2026-09-15: The e2e data-directory reset moves from globalSetup into webServer.command

**Decision.** `playwright.config.ts`'s `webServer.command` now runs `rm -rf .data/e2e &&` before `pnpm dev -p 3100` (and before `pnpm start -p 3100` in CI). `tests/e2e/global-setup.ts` keeps its file and its wiring into `globalSetup`, exactly as the brief's file structure requires, but its body is now an empty, documented no-op instead of the brief's literal `rm(".data/e2e", { recursive: true, force: true })`.
**Alternatives.** Keep the brief's literal `global-setup.ts` body as written; delete `globalSetup` from the config and drop the file instead of keeping it as a no-op; replace the declarative `webServer` block with a hand-rolled spawn-and-poll implemented entirely inside `globalSetup`/`globalTeardown`.
**Reasoning.** The brief's literal pairing failed all three e2e tests deterministically, every run, with a real Postgres error surfacing through PGlite: `could not open file "base/5/16517": No such file or directory` on the very first guest sign-in. Traced to source: Playwright 1.63's actual task order for `playwright test` (confirmed by reading `createGlobalSetupTasks` and `runAllTestsWithConfig` in the installed `playwright` package) is remove-output-dirs, then plugin setup, then global teardowns, then the user's `globalSetups` files, last. The `webServer` option is injected into `config.plugins` before that list is built, so its plugin's `setup()`, which spawns the command and polls `url` until ready, always fully completes before the config's own `globalSetup` file even starts. This project's `src/instrumentation.ts` calls `ensureDbReady()` (open and migrate PGlite) as soon as the Next process boots, so by the time `/api/health` first responds, the on-disk directory is already open inside that live server process; `globalSetup`'s `rm` then deleted it out from under that same still-running process, corrupting it for every later query. Reproduced identically on three separate runs (cold `.next`, warm, warm) before the fix, 0/3 tests passing each time; moving the same `rm -rf .data/e2e` to the front of `webServer.command`, the only point guaranteed to run before the server process exists, fixed all three, reproduced clean on three further consecutive runs (cold, warm, warm) after the fix, plus a fourth throwaway spec exercising drop-zone keyboard operability and delete-dialog focus return. `rm -rf` on a path that does not yet exist is a silent no-op, matching the brief's `force: true` semantics exactly. Left as a no-op rather than deleted, `global-setup.ts` still matches the brief's required file list and keeps `globalSetup` wired in `playwright.config.ts`, and its comment documents the ordering constraint for the next person tempted to move the `rm` back.
**Cut.** A hand-rolled process spawn and readiness poll inside `globalSetup`/`globalTeardown` in place of the declarative `webServer` option. It would sequence correctly too, but throws away `webServer`'s existing port-reuse check, graceful shutdown, and CI/local command split for a much larger rewrite of a file the brief specifies verbatim. Dropping `globalSetup` and the file entirely, which would leave the config's `globalSetup: "./tests/e2e/global-setup.ts"` line and the file itself out of the brief's given file list.

## 2026-09-15: ISO date until hydration, then locale-formatted local time

**Decision.** `LocalTime` in `src/components/ui-bits/local-time.tsx` renders a `<time dateTime={iso}>` whose text is the plain `iso.slice(0, 10)` (`YYYY-MM-DD`) until the client has hydrated, then swaps to `Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })`. Hydration is tracked by a new shared hook, `useHydrated()` in `src/hooks/use-hydrated.ts`, built on `useSyncExternalStore(() => () => {}, () => true, () => false)`; `document-list.tsx`'s "Uploaded" column and `theme-toggle.tsx`'s mounted check both now call it, and `theme-toggle.tsx` no longer keeps its own copy of the same `useSyncExternalStore` call.
**Alternatives.** Pin a fixed locale and UTC on both sides so server and client always agree; load the formatting behind a client-only dynamic import (`next/dynamic` with `ssr: false`).
**Reasoning.** `formatWhen`'s `Intl.DateTimeFormat(undefined, ...)` resolves the runtime's locale and timezone, which the server (wherever it runs) and a visitor's browser are not guaranteed to share, so the server-rendered markup for a returning user's existing documents could disagree with the client's first render and trigger a hydration mismatch. An AP reviewer wants upload times in their own local time, not a fixed locale or UTC, so pinning a locale would trade correctness for the wrong kind of consistency. A client-only dynamic import removes the mismatch but costs an extra chunk and a loading flash for a small, always-needed piece of UI. Showing the deterministic ISO date slice until hydration keeps server and first-client-render markup identical, both computed from the same string with no `Intl` involved, and swaps to the localised value the moment it is safe to, with no extra network request. `useHydrated` centralises the one genuinely reusable idiom `theme-toggle.tsx` already had inline.
**Cut.** Relative times ("2 hours ago"). They read nicely at a glance but go stale without a refresh timer and lose the exact timestamp a reviewer might want when checking an upload against an email or a vendor's own records.

## 2026-09-15: e2e status-chip assertions scoped to the table, not the whole page

**Decision.** `tests/e2e/dashboard.spec.ts`'s "Needs review" and "Rejected" count assertions now query through `page.getByRole("table").getByText(...)` instead of the brief's literal `page.getByText(...)` against the whole page.
**Alternatives.** Keep the brief's literal unscoped `page.getByText(...)`; assert on the specific row's status cell by filename instead of counting matches page-wide; disable or filter the live announcer while this spec runs.
**Reasoning.** The brief's literal, unscoped assertion failed intermittently (deterministically reproduced on repeated runs, particularly from a cold `next dev`): `page.getByText("Needs review")` sometimes counted 3 instead of 2. Root-caused with a saved trace: the screenshot at the exact moment of the stuck assertion showed the fully correct table, one "Rejected" chip and two "Needs review" chips, visible on screen, while Playwright's own locator kept reporting 3. `getByText` matches text anywhere in the DOM regardless of visibility, and `LiveAnnouncerProvider` (Task 3) keeps two `sr-only-live` divs in the DOM that are off-screen (clipped, not `display:none`) and hold the text of the last announcement made on that politeness channel until the next one replaces it. `Dashboard`'s effect announces `` `${filename}: ${statusLabel(status)}` `` whenever a tracked document's status changes from a prior in-flight value to a terminal one; when the backend's drain takes long enough that the client's polling happens to observe an intermediate `queued`/`processing` state before the terminal one (more likely on a cold, still-compiling dev server), that transition fires, and the resulting text, for example "mismatch-total.pdf: Needs review", sits in the live region for the rest of the test since nothing else announces afterward to overwrite it. An unscoped `getByText("Needs review")` then matches both real status chips plus that leftover announcement. Scoping to `page.getByRole("table")` excludes it by construction, since the live region is a sibling of the app shell, not a descendant of the documents table. Confirmed with a bisected minimal reproduction (stripped to just the failing assertion, outside any `describe` block) and fixed after scoping: 3 passed (3 tests each) on repeated full-suite runs from both cold and warm starts, versus a failure on nearly every cold run before the fix.
**Cut.** Filtering or disabling the live announcer for this spec. The announcement firing is correct, intended behaviour that real screen reader users depend on; axe reported zero violations on the populated page in every run, confirming the live region itself is not an accessibility bug. Asserting by filename-scoped row instead of a page-wide count, which would also fix it but is a larger rewrite of the brief's literal assertions than scoping the existing locator.

## 2026-09-15: Axe scan of the open delete dialog waits for entrance animations to finish

**Decision.** `tests/e2e/dashboard.spec.ts`'s third accessibility check, on the open delete confirmation dialog, calls `page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))` after the dialog's title becomes visible and before running `AxeBuilder`.
**Alternatives.** A fixed `page.waitForTimeout(...)` long enough to outlast the dialog's transition; exclude the `color-contrast` rule for the dialog scan; change the dialog's or the underlying page's colours to pass mid-transition too.
**Reasoning.** Scanning the dialog immediately after `toBeVisible()` reported three `serious` `color-contrast` violations (the dialog title, the Cancel button, and the destructive Delete button), each pairing a blended, partially-transparent colour with a background sampled from elements behind the dialog (the overlay, the drop zone underneath it), at ratios between 2.56 and 4.31 against a 4.5 minimum. `toBeVisible()` only requires the element to be attached with non-zero size; it does not wait for the popup's and overlay's own `data-open:animate-in` fade and zoom transition (`duration-100`) to finish, so axe's contrast check can sample a frame mid-fade, when the dialog is still partially see-through, and report the transitional blend as if it were the final, settled state. Waiting for every running animation to finish before scanning, confirmed with a diagnostic fixed delay first, then replaced with the real `getAnimations()` signal, made all three violations disappear on four consecutive runs, with zero flakiness afterward across further full-suite runs. This is a documented axe-core caveat (contrast checks are unreliable on transitioning elements), not a real colour problem: the dialog's settled colours are the same tokens (`text-danger` on `bg-danger-bg`, `--popover`/`--popover-foreground`) already covered by this project's own `tests/unit/tokens-contrast.test.ts` AA check.
**Cut.** A fixed timeout. It would work today but silently under- or over-shoots if `duration-100` ever changes, exactly the kind of brittle sleep this project avoids elsewhere. Excluding the rule, which the brief's resolutions explicitly forbid ("do not exclude rules or elements from the check") and would hide a real regression if a future change actually did ship a low-contrast dialog. Changing colours to pass mid-transition, which is not a real accessibility requirement, since assistive technology and sighted users alike perceive the dialog only after it settles.

## 2026-09-15: claimJobs re-checks job status inside its locking predicate and its final update

**Decision.** `claimJobs` in `src/lib/queue/claim.ts` adds `and j.status = 'queued'` to the `candidate` CTE's `where` clause, and `and jobs.status = 'queued'` to the final `UPDATE`'s `where` clause, alongside the existing id-membership check against `ranked` and `FOR UPDATE SKIP LOCKED`. Every other part of the query, including the ordering, the ranking, and the two caps, is unchanged.
**Alternatives.** Rely on the outer application-level retry logic to tolerate a rare double claim instead of closing the gap in the query itself.
**Reasoning.** The `candidate` CTE selected rows by id membership from `ranked` and locked them with `FOR UPDATE SKIP LOCKED`, and the final `UPDATE ... FROM candidate WHERE jobs.id = candidate.id` wrote them, but neither clause re-checked `status = 'queued'`. If a competing claimer commits a claim on a row between this statement's snapshot and its own lock attempt, Postgres's EvalPlanQual re-evaluation re-checks only id membership, not status, so an already-claimed row could be claimed a second time. A double claim means a double model call once the live extraction provider lands, a real cost against a fixed daily budget, not just a wasted `runJob` invocation, and the fix is two words in each of two places.
**Cut.** Nothing. This closes a real gap at negligible cost.

## 2026-09-15: Cap uploads at 4 MB rather than 10 MB

**Decision.** The per-file upload limit drops from 10 MB to 4 MB: `LIMITS.maxFileBytes` in `src/lib/pipeline/ingest.ts`, `MAX_BYTES` in `src/components/documents/drop-zone.tsx`, and their matching rejection and hint copy.
**Alternatives.** Keep 10 MB and accept the platform-level 413 a larger file would hit; move to client-direct Vercel Blob uploads now, which bypass the function body limit entirely.
**Reasoning.** Vercel Functions cap request bodies at 4.5 MB regardless of what the app enforces, so a 10 MB cap was never actually reachable in production and would fail with an unhelpful platform error rather than the app's own message.
**Cut.** Supporting files above 4 MB until client-direct upload is built, which is scoped into the pipeline plan rather than done here.

## 2026-09-15: Drop the explicit pnpm version pin in CI

**Decision.** Removed `with: { version: 12 }` from every `pnpm/action-setup@v4` step in `.github/workflows/ci.yml`, leaving the action to read the version from `package.json`'s `packageManager` field alone.
**Alternatives.** Remove `packageManager` from `package.json` instead and keep the workflow's explicit version; pin an older `pnpm/action-setup` version that tolerated both being set.
**Reasoning.** The very first push to GitHub failed all four jobs identically at the setup step: `pnpm/action-setup@v4` now refuses to run when both the workflow's `version` input and `package.json`'s `packageManager` field are set, calling it a version conflict, a behavior change this repo's local validation could not have caught since it only checks YAML syntax, never actually runs the action. `packageManager` is the source of truth other tools also read, so it stays and the redundant workflow input goes.
**Cut.** Nothing of substance; this is a one-line-per-job configuration fix with no behavior change to what gets installed, since both inputs named the same version.

## 2026-09-15: Official Anthropic SDK over the Vercel AI SDK

**Decision.** Extraction calls Claude through `@anthropic-ai/sdk` directly: `messages.parse` with a zod output format, native PDF and image content blocks, explicit prompt caching, typed errors, and usage fields.
**Alternatives.** The Vercel AI SDK with `@ai-sdk/anthropic`, which the design spec named.
**Reasoning.** Vouch uses one model. The AI SDK's provider abstraction buys nothing here and adds a layer whose current API differs from training data, while the official SDK exposes structured outputs, cache controls, and stop reasons directly and is documented for the exact model in use.
**Cut.** Provider portability. Swapping models later is a one-file change in the provider, which is acceptable.

## 2026-09-15: A daily model budget that pauses instead of failing

**Decision.** Before every live model call the extract stage sums today's spend from the usage ledger; at the cap the job is deferred to the next UTC midnight without consuming an attempt and the document shows "Daily model budget reached" while staying queued.
**Alternatives.** Fail the job; reject uploads when over budget; a per-workspace budget.
**Reasoning.** The cap protects a personal card, not a product tier. A pause that resumes on its own is honest to the person who uploaded and needs no operator action. Samples cost nothing, so the demo stays explorable.
**Cut.** Per-workspace budgets. A single global cap is what the deployment needs.

## 2026-09-15: OCR runs in-process with Tesseract, language data cached at runtime

**Decision.** Image-only PDF pages are rasterised with pdf.js and a Node canvas, then read by tesseract.js in the same function invocation, capped at five pages and 25 seconds per page. The English language data is downloaded on first use and cached under a writable directory (`/tmp/tessdata` on Vercel), never committed.
**Alternatives.** A hosted OCR API; asking the model for word boxes; committing the traineddata file.
**Reasoning.** Grounding needs word boxes the model does not return, and a second paid service adds a key and a bill for a reviewer to set up. Tesseract is free, deterministic, and good enough on office scans; the caps keep a single job inside the function's time limit. Committing 10 MB of language data would bloat every clone for a file a CDN serves in a second.
**Cut.** OCR beyond five pages per document and non-English language packs.

## 2026-09-15: Ungrounded line amounts warn; ungrounded header amounts block

**Decision.** V010 is blocking for subtotal, tax, shipping, discount and total, and a warning for individual line-item amounts.
**Alternatives.** Blocking for every money field, as the spec's table reads; no rule for line items.
**Reasoning.** The header amounts are the invoice's financial truth and must be seen on the page before anyone vouches for them. A line amount is already corroborated by the line-sum check, and one OCR miss on a 25-line scan should not stop verification of a document whose totals are grounded and add up.
**Cut.** Nothing; the warning still surfaces the line in the review order.

## 2026-09-15: Reconcile keeps whichever extraction has fewer blocking issues

**Decision.** A second, focused extraction runs at most once per document and only when validation found an arithmetic contradiction. It replaces the first extraction only if it produces strictly fewer blocking issues. Rejected attempts stay in the extractions table with `adopted = false` for the trace.
**Alternatives.** Always take the newer answer; merge field by field; ask the model to arbitrate.
**Reasoning.** A re-read that introduces a new contradiction is worse for the reviewer than the original. Counting blocking issues is a cheap, explainable criterion, and keeping the losing attempt lets the trace show what the model said the second time.
**Cut.** Field-level merging. It sounds smarter but makes the provenance of each value harder to explain.

## 2026-09-15: Samples replay recorded extractions in every mode

**Decision.** A sample can ship with the recorded live model output for its file hash, produced by `pnpm samples:record` and committed under `samples/recordings/`. The mock provider replays that recording offline and the live provider replays it instead of calling the API, so only files that are not samples reach the model. No recordings are committed yet: until that script has been run against a real key, mock mode answers a sample from its hand-written ground truth and live mode extracts the samples for real.
**Alternatives.** Replay only in mock mode; hand-written ground truth as the mock answer.
**Reasoning.** Reviewers click "load samples" first. Replaying real model output means the demo shows real model behaviour, including its confidence values and any quirks, at zero cost and with no rate-limit risk, while their own uploads exercise the live path.
**Cut.** Freshness. Recordings are refreshed by `pnpm samples:record` when the prompt version changes.

## 2026-09-15: No temperature parameter

**Decision.** Extraction sends no sampling parameters at all: no temperature, no top_p, no top_k. A test pins their absence from the request.
**Alternatives.** `temperature: 0`, which the design spec named as the determinism lever.
**Reasoning.** Sonnet 5 rejects sampling parameters outright, so a request carrying `temperature: 0` fails with a 400 rather than behaving deterministically. The levers that remain are the ones that matter more anyway: a structured output schema the answer has to satisfy, adaptive thinking, and a system prompt that forbids computing any value that is not printed. Repeatability is then checked where it counts, by grounding every value back to a box on the page.
**Cut.** Nothing. The spec's intent survives; only the parameter it named is gone.

## 2026-09-15: pdf.js legacy build under Node, Node 24 floor

**Decision.** The parse stage loads pdf.js's legacy build (`pdfjs-dist/legacy/build/pdf.mjs`), and CI, Vercel (via `package.json`'s `engines` field) and `.nvmrc` are all on Node 24.
**Alternatives.** The official build on Node 26 only; pinning `pdfjs-dist` to a 5.x release.
**Reasoning.** The official 6.x build calls `Promise.try` and `Uint8Array.prototype.toHex`, both of which Node 24 (Vercel's runtime) lacks, while the legacy build carries core-js polyfills for both and is the build pdf.js itself recommends for Node.
**Cut.** Node 22 support.
