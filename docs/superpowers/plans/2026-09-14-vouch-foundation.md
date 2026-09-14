# Vouch Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Vouch application end to end on day one: a guest visitor gets a real session and workspace, uploads or loads sample invoices, files are validated and stored, jobs are queued and drained through an idempotent pipeline runner with a mock model, and the dashboard shows live status, with CI green and a first deployment.

**Architecture:** One Next.js 16 App Router application. Route handlers form a JSON API consumed by TanStack Query; React Server Components render initial data. Postgres via Drizzle holds everything, including a job queue claimed with `FOR UPDATE SKIP LOCKED`. PGlite runs the same schema locally and in tests with zero services. Pipeline stages are pure, idempotent functions with checkpoints in `pipeline_runs`. Later plans add parsing, live extraction, grounding, validation, the review screen, the ledger, hardening, and docs.

**Tech Stack:** Next.js 16.3, React 19.3, TypeScript 5.9 strict, Tailwind CSS 4.3, shadcn/ui, Geist fonts, Drizzle ORM 0.45, PGlite 0.5, `pg` 8 for real Postgres, Better Auth 1.7 with the anonymous plugin, Vercel Blob 2.8, zod 4, `@t3-oss/env-nextjs`, TanStack Query 5, Vitest 5, Playwright 1.63, `@axe-core/playwright`, pnpm 12.

**Spec:** `docs/superpowers/specs/2026-09-14-vouch-design.md`. Executors read both. Section numbers below refer to the spec.

## Global Constraints

- Node 22 or newer (Node 26 locally), pnpm 12, TypeScript `strict: true`, no `any`, no `dangerouslySetInnerHTML`.
- Every workspace-scoped query goes through `src/lib/repo/*` and takes a `workspaceId` derived from the session, never from the request (spec 10, 11).
- Money is `numeric(18,2)` in Postgres and a canonical string like `"1234.56"` in TypeScript. Never `number` for money.
- Boxes are `[x, y, w, h]` normalised to `[0, 1]` with a top-left origin (spec 5.1).
- Limits (spec 18): file 10 MB, 10 pages, 25 documents per guest workspace, 5 files per upload, 30 uploads per IP per hour, 2 running jobs per workspace, 5 global, 3 job attempts, 6 minute stale threshold, 7 day guest lifetime.
- Copy: plain, short sentences, no em dashes anywhere in UI text, docs, or commit messages. Use a hyphen or a new sentence.
- Tests run on PGlite by default; the same integration tests run on real Postgres when `TEST_DATABASE_URL` is set. Concurrency tests are skipped on PGlite with an explicit message.
- No external service is authenticated or provisioned without Sagar's confirmation. Task 13 marks every such step with **STOP: needs Sagar**.
- Commit after every task. Messages use Conventional Commits and end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0169kHywDWcs7q49DMiSVDUG
```

- `decisions.md` is a running log. Any task that makes a call the spec left open appends a dated entry with decision, alternatives, reasoning, and what was cut.

---

## File structure for this plan

```
vouch/
  package.json  pnpm-lock.yaml  tsconfig.json  next.config.ts  postcss.config.mjs
  eslint.config.mjs  vitest.config.ts  playwright.config.ts  drizzle.config.ts
  .nvmrc  .env.example  .gitignore  .prettierrc  components.json
  decisions.md  README.md
  drizzle/                      generated SQL migrations (committed)
  samples/
    templates/*.html            HTML invoice templates rendered to PDF
    ground-truth/*.json         expected values per sample, also drives the mock model
    manifest.json               filename, sha256, kind, page count per sample (generated)
    out/                        generated sample files (committed, small)
    generate.ts                 renders templates with Playwright, writes manifest
  src/
    proxy.ts                    guest bootstrap redirect for page routes
    instrumentation.ts          runs migrations for PGlite at boot
    app/
      layout.tsx  globals.css  page.tsx
      api/auth/[...all]/route.ts
      api/session/start/route.ts
      api/documents/route.ts                 POST upload, GET list
      api/documents/[id]/route.ts            GET detail, DELETE
      api/documents/[id]/file/route.ts       stream bytes
      api/documents/[id]/retry/route.ts
      api/workspace/status/route.ts          counts + drain trigger
      api/workspace/samples/route.ts         load samples
      api/workspace/route.ts                 DELETE workspace
      api/health/route.ts
    styles/tokens.css
    lib/
      env.ts  llm-mode.ts  contrast.ts  utils.ts  logger.ts
      api/errors.ts  api/respond.ts  api/same-origin.ts  api/documents.ts
      db/client.ts  db/migrate.ts  db/schema/*.ts
      auth/server.ts  auth/client.ts  auth/session.ts
      repo/workspaces.ts  repo/documents.ts  repo/jobs.ts  repo/pipeline-runs.ts
      repo/invoices.ts  repo/audit.ts  repo/index.ts
      files/detect-type.ts  files/hash.ts  files/sanitize.ts
      blob/types.ts  blob/local-fs.ts  blob/vercel.ts  blob/index.ts
      queue/claim.ts  queue/drain.ts
      normalize/money.ts  normalize/vendor.ts
      pipeline/types.ts  pipeline/runner.ts  pipeline/risk.ts  pipeline/ingest.ts
      pipeline/extract/schema.ts  pipeline/extract/model.ts  pipeline/extract/mock-provider.ts
      pipeline/stages/extract.ts  pipeline/stages/finalise.ts
      api-client.ts
    components/
      providers.tsx
      ui/*                      shadcn generated
      layout/app-shell.tsx  layout/top-bar.tsx  layout/skip-link.tsx
      layout/theme-toggle.tsx  layout/live-announcer.tsx
      documents/drop-zone.tsx  documents/document-list.tsx
      documents/status-chip.tsx  documents/empty-state.tsx  documents/dashboard.tsx
    hooks/use-workspace-status.ts  hooks/use-documents.ts  hooks/use-upload.ts
  tests/
    setup-env.ts
    unit/*.test.ts
    integration/setup.ts  integration/*.test.ts
    e2e/*.spec.ts
  .github/workflows/ci.yml
```

Responsibilities: `repo/*` is the only code that writes SQL for domain tables; `queue/*` owns claiming and draining; `pipeline/*` owns stage logic and knows nothing about HTTP; `app/api/*` translates HTTP to repo and pipeline calls and nothing else; `components/*` never import server code.

---

### Task 1: Scaffold, toolchain, and the decisions log

**Files:**
- Create via scaffold: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `src/app/*`
- Create: `vitest.config.ts`, `.nvmrc`, `.env.example`, `.prettierrc`, `tests/setup-env.ts`, `tests/unit/smoke.test.ts`, `decisions.md`, `README.md`
- Modify: `.gitignore`, `package.json` scripts

**Interfaces:**
- Produces: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:unit`, `pnpm test:integration` scripts; the `@/*` import alias to `src/*`; Vitest projects `unit` and `integration`.

- [ ] **Step 1: Scaffold Next.js into the existing repo**

The repo already contains `.git` and `docs/`, both of which create-next-app allows.

```bash
cd /Users/sagarrajput/Desktop/Zamp/vouch
pnpm dlx create-next-app@16 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --yes
```

Expected: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `next.config.ts`, `package.json` exist. If the CLI refuses because of the directory, run it in a temporary directory and copy the generated files in, keeping our `docs/` and `.git`.

- [ ] **Step 2: Add runtime and development dependencies**

```bash
pnpm add better-auth drizzle-orm @electric-sql/pglite pg @vercel/blob zod @t3-oss/env-nextjs @tanstack/react-query geist lucide-react sonner next-themes class-variance-authority clsx tailwind-merge
pnpm add -D vitest drizzle-kit tsx @playwright/test @axe-core/playwright prettier @better-auth/cli @types/pg sharp pdf-lib
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/setup-env.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/setup-env.ts", "tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
```

- [ ] **Step 4: Write `tests/setup-env.ts`**

Sets safe defaults so modules that validate environment at import time load in tests.

```ts
process.env.NODE_ENV ??= "test";
// Integration tests run on real Postgres when TEST_DATABASE_URL is set. It must be mapped here,
// before any module reads the validated env at import time.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-sixteen-chars";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.LLM_MODE ??= "mock";
process.env.PGLITE_DATA_DIR ??= ":memory:";
process.env.LOCAL_DATA_DIR ??= ".data/test";
```

- [ ] **Step 5: Write the smoke test `tests/unit/smoke.test.ts`**

```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs a test", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Add scripts, `.nvmrc`, `.prettierrc`, `.env.example`, `.gitignore` entries**

In `package.json` set:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "format": "prettier --write .",
  "test": "vitest run",
  "test:unit": "vitest run --project unit",
  "test:integration": "vitest run --project integration",
  "test:e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/lib/db/migrate.ts",
  "db:studio": "drizzle-kit studio",
  "samples:generate": "tsx samples/generate.ts"
}
```

`.nvmrc`:

```
22
```

`.prettierrc`:

```json
{ "semi": true, "singleQuote": false, "printWidth": 100, "trailingComma": "all" }
```

`.env.example`:

```bash
# Nothing here is required for local development. Leave a value empty to use the local fallback.
# Database: unset uses PGlite on disk at .data/pglite. Set to a Postgres URL for Neon.
DATABASE_URL=
# Files: unset uses .data/blobs. Set the Vercel Blob read-write token in production.
BLOB_READ_WRITE_TOKEN=
# Model: unset runs the mock model that replays the sample ground truth.
ANTHROPIC_API_KEY=
# live | mock | record. Defaults to live when a key exists, otherwise mock.
LLM_MODE=
# Sessions. Required in production; a development default is used otherwise.
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
# Optional. Sign-in is hidden when these are empty.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Protects the daily cron route.
CRON_SECRET=
# Guardrails
BUDGET_DAILY_USD=3
UPLOADS_ENABLED=true
```

Append to `.gitignore`:

```
.data/
.env
.env.local
test-results/
playwright-report/
```

- [ ] **Step 7: Create `decisions.md` with the brief and the first entries**

```markdown
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
```

- [ ] **Step 8: Create `README.md` stub**

```markdown
# Vouch

Invoices you can vouch for. Messy vendor invoices become a verified, queryable ledger where every value shows its source.

Status: foundation in progress. Full documentation lands at the end of the build.

## Quickstart

```bash
pnpm install
pnpm dev
```

No services or keys are needed locally. The app uses an on-disk Postgres (PGlite), local file storage, and a mock model that replays the sample ground truth.
```

- [ ] **Step 9: Verify the toolchain**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build
```

Expected: lint clean, typecheck clean, 1 test passed, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app, toolchain, and decisions log"
```

---

### Task 2: Environment module

**Files:**
- Create: `src/lib/env.ts`, `src/lib/llm-mode.ts`
- Test: `tests/unit/llm-mode.test.ts`

**Interfaces:**
- Produces: `env` (validated server env object), `resolveLlmMode(mode, apiKey): "live" | "mock" | "record"`, `llmMode` constant, `isProduction` boolean.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/llm-mode.test.ts
import { describe, expect, it } from "vitest";
import { resolveLlmMode } from "@/lib/llm-mode";

describe("resolveLlmMode", () => {
  it("uses the explicit mode when given", () => {
    expect(resolveLlmMode("mock", "sk-ant-key")).toBe("mock");
    expect(resolveLlmMode("record", "sk-ant-key")).toBe("record");
  });
  it("defaults to live when a key exists", () => {
    expect(resolveLlmMode(undefined, "sk-ant-key")).toBe("live");
  });
  it("defaults to mock when no key exists", () => {
    expect(resolveLlmMode(undefined, undefined)).toBe("mock");
  });
  it("refuses live and record without a key", () => {
    expect(() => resolveLlmMode("live", undefined)).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => resolveLlmMode("record", undefined)).toThrow(/ANTHROPIC_API_KEY/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- llm-mode`
Expected: FAIL, cannot resolve `@/lib/llm-mode`.

- [ ] **Step 3: Write `src/lib/llm-mode.ts` and `src/lib/env.ts`**

```ts
// src/lib/llm-mode.ts
export type LlmMode = "live" | "mock" | "record";

export function resolveLlmMode(mode: LlmMode | undefined, apiKey: string | undefined): LlmMode {
  if (mode === "live" || mode === "record") {
    if (!apiKey) throw new Error(`LLM_MODE=${mode} requires ANTHROPIC_API_KEY`);
    return mode;
  }
  if (mode === "mock") return "mock";
  return apiKey ? "live" : "mock";
}
```

```ts
// src/lib/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { resolveLlmMode } from "./llm-mode";

const bool = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url().optional(),
    PGLITE_DATA_DIR: z.string().default(".data/pglite"),
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
    LOCAL_DATA_DIR: z.string().default(".data"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    LLM_MODE: z.enum(["live", "mock", "record"]).optional(),
    BETTER_AUTH_SECRET: z.string().min(16).optional(),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    CRON_SECRET: z.string().min(16).optional(),
    BUDGET_DAILY_USD: z.coerce.number().positive().default(3),
    UPLOADS_ENABLED: bool,
  },
  client: {},
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    LOCAL_DATA_DIR: process.env.LOCAL_DATA_DIR,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    LLM_MODE: process.env.LLM_MODE,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    BUDGET_DAILY_USD: process.env.BUDGET_DAILY_USD,
    UPLOADS_ENABLED: process.env.UPLOADS_ENABLED,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});

export const isProduction = env.NODE_ENV === "production";
export const llmMode = resolveLlmMode(env.LLM_MODE, env.ANTHROPIC_API_KEY);

export function authSecret(): string {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (isProduction) throw new Error("BETTER_AUTH_SECRET is required in production");
  return "vouch-development-secret-not-for-production";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- llm-mode`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts src/lib/llm-mode.ts tests/unit/llm-mode.test.ts
git commit -m "feat: validated environment with derived model mode"
```

---

### Task 3: Design tokens, fonts, theme, app shell, base components

**Files:**
- Create: `src/styles/tokens.css`, `src/lib/contrast.ts`, `src/components/providers.tsx`, `src/components/layout/app-shell.tsx`, `src/components/layout/top-bar.tsx`, `src/components/layout/skip-link.tsx`, `src/components/layout/theme-toggle.tsx`, `src/components/layout/live-announcer.tsx`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`
- Generated by shadcn: `components.json`, `src/lib/utils.ts`, `src/components/ui/*`
- Test: `tests/unit/tokens-contrast.test.ts`

**Interfaces:**
- Produces: CSS variables listed in `tokens.css`; `contrastRatio(hexA, hexB): number`; `useAnnouncer(): { announce(message: string, politeness?: "polite" | "assertive"): void }`; `AppShell` layout wrapper; `Providers` (React Query + theme + announcer).

- [ ] **Step 1: Initialise shadcn and add the base components**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input badge dialog tooltip skeleton separator sheet table tabs dropdown-menu sonner
```

Expected: `components.json`, `src/lib/utils.ts` with `cn()`, and `src/components/ui/*.tsx`. shadcn rewrites `globals.css` with its variable set; the next step overrides those values.

- [ ] **Step 2: Write the failing contrast test**

```ts
// tests/unit/tokens-contrast.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync(path.resolve("src/styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
  return vars;
}

const pairs: Array<[string, string]> = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent", "bg"],
  ["success", "success-bg"],
  ["warning", "warning-bg"],
  ["danger", "danger-bg"],
];

describe("token contrast", () => {
  for (const scheme of [":root", ".dark"]) {
    const vars = block(scheme);
    for (const [fg, bg] of pairs) {
      it(`${scheme} ${fg} on ${bg} meets AA`, () => {
        expect(vars[fg], `missing --${fg}`).toBeDefined();
        expect(vars[bg], `missing --${bg}`).toBeDefined();
        expect(contrastRatio(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit -- tokens-contrast`
Expected: FAIL, cannot resolve `@/lib/contrast` or `tokens.css` missing.

- [ ] **Step 4: Write `src/lib/contrast.ts`**

```ts
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminance(hexA);
  const b = luminance(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 5: Write `src/styles/tokens.css`**

Values come from spec 14. Semantic text colours were chosen to clear 4.5:1 on their backgrounds; the test enforces it.

```css
:root {
  --bg: #fbfbfa;
  --surface: #ffffff;
  --surface-2: #f3f2ef;
  --border: rgba(23, 23, 23, 0.1);
  --border-strong: rgba(23, 23, 23, 0.2);
  --text: #171717;
  --muted: #5f5e5a;
  --accent: #005eff;
  --accent-hover: #0047c2;
  --accent-fg: #ffffff;
  --success: #146c32;
  --success-bg: #e7f5ec;
  --warning: #8a5300;
  --warning-bg: #fff3dd;
  --danger: #b42318;
  --danger-bg: #fdecec;
  --highlight: rgba(0, 94, 255, 0.16);
  --highlight-active: rgba(0, 94, 255, 0.28);
  --highlight-outline: #005eff;
  --radius-sm: 6px;
  --radius: 10px;
  --radius-pill: 999px;
}

.dark {
  --bg: #0f0f0e;
  --surface: #171716;
  --surface-2: #1f1f1d;
  --border: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.2);
  --text: #f2f2f0;
  --muted: #a5a49e;
  --accent: #5c9bff;
  --accent-hover: #86b5ff;
  --accent-fg: #0f0f0e;
  --success: #6ccb8b;
  --success-bg: #14301d;
  --warning: #f0b458;
  --warning-bg: #3a2a0c;
  --danger: #f28b82;
  --danger-bg: #3d1614;
  --highlight: rgba(92, 155, 255, 0.22);
  --highlight-active: rgba(92, 155, 255, 0.36);
  --highlight-outline: #5c9bff;
}
```

- [ ] **Step 6: Map tokens onto shadcn variables in `src/app/globals.css`**

Replace the generated colour values so every shadcn component uses the Zamp-derived tokens. Keep the `@import "tailwindcss"`, the `@custom-variant dark`, and the `@theme inline` block shadcn generated, then set:

```css
@import "tailwindcss";
@import "../styles/tokens.css";
@custom-variant dark (&:is(.dark *));

:root,
.dark {
  --background: var(--bg);
  --foreground: var(--text);
  --card: var(--surface);
  --card-foreground: var(--text);
  --popover: var(--surface);
  --popover-foreground: var(--text);
  --primary: var(--text);
  --primary-foreground: var(--bg);
  --secondary: var(--surface-2);
  --secondary-foreground: var(--text);
  --muted: var(--surface-2);
  --muted-foreground: var(--muted);
  --accent: var(--surface-2);
  --accent-foreground: var(--text);
  --destructive: var(--danger);
  --border: var(--border);
  --input: var(--border-strong);
  --ring: var(--accent);
  --radius: var(--radius);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-success-bg: var(--success-bg);
  --color-warning: var(--warning);
  --color-warning-bg: var(--warning-bg);
  --color-danger: var(--danger);
  --color-danger-bg: var(--danger-bg);
  --color-brand: var(--accent);
  --color-brand-foreground: var(--accent-fg);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius);
  --radius-lg: var(--radius);
  --radius-pill: var(--radius-pill);
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
}

@layer base {
  * {
    @apply border-border;
  }
  html {
    color-scheme: light;
  }
  html.dark {
    color-scheme: dark;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
  .skip-link {
    position: absolute;
    left: 1rem;
    top: -3rem;
    z-index: 100;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .skip-link:focus {
    top: 1rem;
  }
  .sr-only-live {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

The variable named `--muted` in `tokens.css` is a foreground colour, while shadcn's `--muted` is a background. The mapping above resolves that by assigning our `--muted` to shadcn's `--muted-foreground` and our `--surface-2` to shadcn's `--muted`.

- [ ] **Step 7: Write the live announcer and providers**

```tsx
// src/components/layout/live-announcer.tsx
"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Politeness = "polite" | "assertive";
type Announcer = { announce: (message: string, politeness?: Politeness) => void };

const AnnouncerContext = createContext<Announcer | null>(null);

export function LiveAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const last = useRef<{ polite: number; assertive: number }>({ polite: 0, assertive: 0 });

  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    const setter = politeness === "assertive" ? setAssertive : setPolite;
    // Clear first so repeating the same message is still announced.
    setter("");
    const stamp = Date.now();
    last.current[politeness] = stamp;
    setTimeout(() => {
      if (last.current[politeness] === stamp) setter(message);
    }, 50);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only-live" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only-live" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): Announcer {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) throw new Error("useAnnouncer must be used inside LiveAnnouncerProvider");
  return ctx;
}
```

```tsx
// src/components/providers.tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { LiveAnnouncerProvider } from "@/components/layout/live-announcer";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <LiveAnnouncerProvider>
          {children}
          <Toaster position="bottom-right" closeButton />
        </LiveAnnouncerProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 8: Write the shell components**

```tsx
// src/components/layout/skip-link.tsx
export function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to content
    </a>
  );
}
```

```tsx
// src/components/layout/theme-toggle.tsx
"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="inline-block size-9" aria-hidden="true" />;
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </Button>
  );
}
```

```tsx
// src/components/layout/top-bar.tsx
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/", label: "Documents" },
  { href: "/invoices", label: "Ledger" },
  { href: "/how-it-works", label: "How it works" },
];

export function TopBar() {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          Vouch
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
```

```tsx
// src/components/layout/app-shell.tsx
import { SkipLink } from "./skip-link";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <SkipLink />
      <TopBar />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 9: Wire fonts and shell in `src/app/layout.tsx` and replace `src/app/page.tsx`**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: { default: "Vouch", template: "%s · Vouch" },
  description: "Messy invoices become a verified, queryable ledger where every value shows its source.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx (temporary until Task 12)
export default function HomePage() {
  return (
    <section>
      <p className="font-mono text-xs text-muted-foreground">01 / Documents</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Documents</h1>
      <p className="mt-2 text-muted-foreground">Upload arrives in Task 12.</p>
    </section>
  );
}
```

- [ ] **Step 10: Run the tests and the dev server**

Run: `pnpm test:unit -- tokens-contrast && pnpm typecheck && pnpm lint`
Expected: 18 contrast assertions pass, no type or lint errors.

Run: `pnpm dev` and open http://localhost:3000. Expected: the shell renders with the Geist font, the theme toggle switches classes, Tab reveals the skip link first.

- [ ] **Step 11: Append a decisions entry and commit**

Append to `decisions.md`:

```markdown
## 2026-09-14: Zamp-derived tokens mapped onto shadcn variables

**Decision.** A small token file holds the Zamp-derived palette and radii; shadcn's variables alias those tokens so every generated component follows the palette without edits.
**Alternatives.** Hand-written components; keeping shadcn's default neutral theme.
**Reasoning.** Radix primitives give keyboard and screen-reader behaviour for free, which matters more than owning every component. Aliasing keeps one source of truth for colour and lets a unit test enforce AA contrast on every pair.
**Cut.** A custom component library. Depth belongs in the review flow, not in buttons.
```

```bash
git add -A
git commit -m "feat: design tokens, fonts, theme, app shell, base components"
```

---

### Task 4: Database client, schema, migrations, and test harness

**Files:**
- Create: `drizzle.config.ts`, `src/lib/db/client.ts`, `src/lib/db/migrate.ts`, `src/instrumentation.ts`, `src/lib/auth/server.ts` (minimal, expanded in Task 5), `src/lib/db/schema/index.ts`, `src/lib/db/schema/auth.ts` (generated), `src/lib/db/schema/workspaces.ts`, `src/lib/db/schema/documents.ts`, `src/lib/db/schema/pages.ts`, `src/lib/db/schema/extractions.ts`, `src/lib/db/schema/invoices.ts`, `src/lib/db/schema/line-items.ts`, `src/lib/db/schema/issues.ts`, `src/lib/db/schema/corrections.ts`, `src/lib/db/schema/jobs.ts`, `src/lib/db/schema/pipeline-runs.ts`, `src/lib/db/schema/usage.ts`, `src/lib/db/schema/rate-limits.ts`, `src/lib/db/schema/audit.ts`, `drizzle/*` (generated)
- Test: `tests/integration/setup.ts`, `tests/integration/db.test.ts`

**Interfaces:**
- Produces: `type Db`, `getDb(): Db`, `ensureDbReady(): Promise<void>`, `resetDbForTests(): Promise<void>`, all schema tables and enums exported from `@/lib/db/schema`, `auth` instance (minimal) from `@/lib/auth/server`.

- [ ] **Step 1: Write the minimal auth config so the Better Auth CLI can generate its schema**

```ts
// src/lib/auth/server.ts (minimal; Task 5 completes it)
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { authSecret, env } from "@/lib/env";

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  plugins: [anonymous({ emailDomainName: "guest.vouch.local" })],
  advanced: { cookiePrefix: "vouch" },
});
```

- [ ] **Step 2: Write the schema files**

```ts
// src/lib/db/schema/workspaces.ts
import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const workspaceKind = pgEnum("workspace_kind", ["guest", "account"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("My workspace"),
    kind: workspaceKind("kind").notNull().default("guest"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workspaces_owner_idx").on(t.ownerUserId), index("workspaces_expires_idx").on(t.expiresAt)],
);
```

```ts
// src/lib/db/schema/documents.ts
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const documentStatus = pgEnum("document_status", [
  "queued",
  "processing",
  "needs_review",
  "verified",
  "failed",
  "rejected",
]);
export const documentKind = pgEnum("document_kind", ["unknown", "pdf_text", "pdf_scan", "image"]);
export const docType = pgEnum("doc_type", ["invoice", "receipt", "credit_note", "other"]);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    blobKey: text("blob_key").notNull(),
    pageCount: integer("page_count"),
    kind: documentKind("kind").notNull().default("unknown"),
    status: documentStatus("status").notNull().default("queued"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    docType: docType("doc_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_workspace_sha_idx").on(t.workspaceId, t.sha256),
    index("documents_workspace_status_idx").on(t.workspaceId, t.status, t.createdAt),
  ],
);
```

```ts
// src/lib/db/schema/pages.ts
import { index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const textSource = pgEnum("text_source", ["pdf", "ocr", "none"]);

export type PositionedToken = { text: string; x: number; y: number; w: number; h: number; line: number };

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    rotation: integer("rotation").notNull().default(0),
    textSource: textSource("text_source").notNull().default("none"),
    ocrMeanConfidence: real("ocr_mean_confidence"),
    tokens: jsonb("tokens").$type<PositionedToken[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pages_document_page_idx").on(t.documentId, t.pageNo), index("pages_document_idx").on(t.documentId)],
);
```

```ts
// src/lib/db/schema/extractions.ts
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const extractionKind = pgEnum("extraction_kind", ["initial", "reconcile"]);

export const extractions = pgTable(
  "extractions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    kind: extractionKind("kind").notNull().default("initial"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    raw: jsonb("raw").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("extractions_document_idx").on(t.documentId)],
);
```

```ts
// src/lib/db/schema/invoices.ts
import { customType, date, index, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents, docType } from "./documents";
import { workspaces } from "./workspaces";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export type GroundingMethod = "exact" | "normalized" | "fuzzy" | "none";
export type FieldStatus = "pending" | "accepted" | "corrected";
export type FieldMeta = {
  value: string | null;
  sourceText: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  groundingScore: number;
  groundingMethod: GroundingMethod;
  modelConfidence: number;
  risk: number;
  status: FieldStatus;
  correctedAt: string | null;
};
export type InvoiceFields = Record<string, FieldMeta>;

export const invoices = pgTable(
  "invoices",
  {
    documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    vendorName: text("vendor_name"),
    vendorKey: text("vendor_key"),
    invoiceNumber: text("invoice_number"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    currency: text("currency"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }),
    tax: numeric("tax", { precision: 18, scale: 2 }),
    shipping: numeric("shipping", { precision: 18, scale: 2 }),
    discount: numeric("discount", { precision: 18, scale: 2 }),
    total: numeric("total", { precision: 18, scale: 2 }),
    docType: docType("doc_type").notNull().default("invoice"),
    fields: jsonb("fields").$type<InvoiceFields>().notNull().default({}),
    search: tsvector("search"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBySessionId: text("verified_by_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoices_workspace_vendor_idx").on(t.workspaceId, t.vendorKey),
    index("invoices_workspace_issue_date_idx").on(t.workspaceId, t.issueDate),
    index("invoices_workspace_total_idx").on(t.workspaceId, t.total),
    index("invoices_search_idx").using("gin", t.search),
  ],
);
```

```ts
// src/lib/db/schema/line-items.ts
import { index, integer, jsonb, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import type { FieldMeta } from "./invoices";

export type LineItemMeta = Partial<Record<"description" | "quantity" | "unitPrice" | "amount", FieldMeta>>;

export const lineItems = pgTable(
  "line_items",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 18, scale: 4 }),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }),
    amount: numeric("amount", { precision: 18, scale: 2 }),
    meta: jsonb("meta").$type<LineItemMeta>().notNull().default({}),
  },
  (t) => [uniqueIndex("line_items_document_idx_idx").on(t.documentId, t.idx), index("line_items_document_idx").on(t.documentId)],
);
```

```ts
// src/lib/db/schema/issues.ts
import { index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const issueSeverity = pgEnum("issue_severity", ["blocking", "warning", "info"]);
export const issueStatus = pgEnum("issue_status", ["open", "resolved", "overridden"]);

export const issues = pgTable(
  "issues",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    severity: issueSeverity("severity").notNull(),
    fieldPaths: text("field_paths").array().notNull().default([]),
    message: text("message").notNull(),
    suggestion: jsonb("suggestion").$type<unknown>(),
    status: issueStatus("status").notNull().default("open"),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("issues_document_status_idx").on(t.documentId, t.status)],
);
```

```ts
// src/lib/db/schema/corrections.ts
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const corrections = pgTable(
  "corrections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    fieldPath: text("field_path").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    actorSessionId: text("actor_session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("corrections_document_idx").on(t.documentId, t.createdAt)],
);
```

```ts
// src/lib/db/schema/jobs.ts
import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { workspaces } from "./workspaces";

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_status_run_after_idx").on(t.status, t.runAfter), index("jobs_document_idx").on(t.documentId)],
);
```

```ts
// src/lib/db/schema/pipeline-runs.ts
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { jobs } from "./jobs";

export const runStatus = pgEnum("run_status", ["running", "succeeded", "failed", "skipped"]);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    stage: text("stage").notNull(),
    status: runStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("pipeline_runs_document_idx").on(t.documentId, t.startedAt)],
);
```

```ts
// src/lib/db/schema/usage.ts
import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { workspaces } from "./workspaces";

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_created_idx").on(t.createdAt)],
);
```

```ts
// src/lib/db/schema/rate-limits.ts
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});
```

```ts
// src/lib/db/schema/audit.ts
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorSessionId: text("actor_session_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_workspace_idx").on(t.workspaceId, t.createdAt)],
);
```

```ts
// src/lib/db/schema/index.ts
export * from "./auth";
export * from "./workspaces";
export * from "./documents";
export * from "./pages";
export * from "./extractions";
export * from "./invoices";
export * from "./line-items";
export * from "./issues";
export * from "./corrections";
export * from "./jobs";
export * from "./pipeline-runs";
export * from "./usage";
export * from "./rate-limits";
export * from "./audit";
```

- [ ] **Step 3: Write the client factory and migration runner**

```ts
// src/lib/db/client.ts
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = {
  db?: Db;
  pglite?: PGlite;
  pool?: Pool;
  ready?: Promise<void>;
  flavour?: "pglite" | "postgres";
};

const holder: Holder = ((globalThis as unknown as { __vouchDb?: Holder }).__vouchDb ??= {});

const MIGRATIONS = "drizzle";

function create(): Db {
  if (env.DATABASE_URL) {
    holder.pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });
    holder.flavour = "postgres";
    return drizzleNode({ client: holder.pool, schema }) as unknown as Db;
  }
  holder.pglite = env.PGLITE_DATA_DIR === ":memory:" ? new PGlite() : new PGlite(env.PGLITE_DATA_DIR);
  holder.flavour = "pglite";
  return drizzlePglite({ client: holder.pglite, schema }) as unknown as Db;
}

export function getDb(): Db {
  holder.db ??= create();
  return holder.db;
}

export function dbFlavour(): "pglite" | "postgres" {
  getDb();
  return holder.flavour ?? "pglite";
}

/** Runs pending migrations once per process. Safe to call from every entry point. */
export function ensureDbReady(): Promise<void> {
  holder.ready ??= (async () => {
    const db = getDb();
    if (holder.flavour === "pglite") {
      await migratePglite(db as unknown as ReturnType<typeof drizzlePglite>, { migrationsFolder: MIGRATIONS });
    } else if (env.NODE_ENV !== "production") {
      await migrateNode(db as unknown as ReturnType<typeof drizzleNode>, { migrationsFolder: MIGRATIONS });
    }
  })();
  return holder.ready;
}

/** Test only: drops the current instance so the next getDb() starts fresh. */
export async function resetDbForTests(): Promise<void> {
  if (holder.pglite) await holder.pglite.close();
  if (holder.pool) await holder.pool.end();
  holder.db = undefined;
  holder.pglite = undefined;
  holder.pool = undefined;
  holder.ready = undefined;
  holder.flavour = undefined;
}
```

In production, migrations run at build time through `pnpm db:migrate` (next step), so `ensureDbReady()` is a no-op there and never delays a request.

```ts
// src/lib/db/migrate.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL not set; PGlite migrates itself at boot. Nothing to do.");
    return;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : { driver: "pglite", dbCredentials: { url: process.env.PGLITE_DATA_DIR ?? ".data/pglite" } }),
});
```

```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDbReady } = await import("./lib/db/client");
    await ensureDbReady();
  }
}
```

- [ ] **Step 4: Generate the auth schema, then the SQL migration**

```bash
pnpm dlx @better-auth/cli@latest generate --config src/lib/auth/server.ts --output src/lib/db/schema/auth.ts --yes
pnpm db:generate
```

Expected: `src/lib/db/schema/auth.ts` exports `user`, `session`, `account`, `verification`, with `user.isAnonymous`. `drizzle/0000_*.sql` and `drizzle/meta/*` are created. If the generator writes the tables under different export names, rename the exports to `user`, `session`, `account`, `verification` so the adapter's default mapping works.

- [ ] **Step 5: Write the integration test harness and the first DB test**

```ts
// tests/integration/setup.ts
import { afterAll, beforeAll } from "vitest";
import { ensureDbReady, getDb, resetDbForTests } from "@/lib/db/client";
import { sql } from "drizzle-orm";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const db = getDb();
    await db.execute(sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  }
  await ensureDbReady();
});

afterAll(async () => {
  await resetDbForTests();
});
```

```ts
// tests/integration/db.test.ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { user, workspaces } from "@/lib/db/schema";

describe("database", () => {
  it("migrates and round-trips a workspace", async () => {
    const db = getDb();
    const [u] = await db
      .insert(user)
      .values({ id: "u1", name: "Guest", email: "u1@guest.vouch.local", emailVerified: false, isAnonymous: true, createdAt: new Date(), updatedAt: new Date() })
      .returning();
    const [ws] = await db.insert(workspaces).values({ ownerUserId: u.id }).returning();
    const found = await db.query.workspaces.findFirst({ where: eq(workspaces.id, ws.id) });
    expect(found?.kind).toBe("guest");
    expect(found?.ownerUserId).toBe("u1");
  });
});
```

If the generated `user` table requires additional not-null columns, add them to the insert; the generated file is the source of truth.

- [ ] **Step 6: Run the integration test**

Run: `pnpm test:integration -- db`
Expected: 1 passed on PGlite.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: database client, schema, migrations, and integration harness"
```

---

### Task 5: Guest sessions and workspace bootstrap

**Files:**
- Modify: `src/lib/auth/server.ts`
- Create: `src/lib/auth/client.ts`, `src/lib/auth/session.ts`, `src/lib/api/errors.ts`, `src/lib/repo/workspaces.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/api/session/start/route.ts`, `src/proxy.ts`
- Test: `tests/integration/session.test.ts`

**Interfaces:**
- Produces: `auth` (full Better Auth instance); `ApiError` class with `status`, `code`, `message`; `getSession(): Promise<SessionInfo | null>`; `requireSession(): Promise<SessionInfo>` where `SessionInfo = { userId: string; sessionId: string; isAnonymous: boolean; workspaceId: string }`; `startGuestSession(): Promise<{ headers: Headers; info: SessionInfo }>` for tests and the start route; `workspacesRepo.findOrCreateForUser(userId, isAnonymous)`, `workspacesRepo.getById(id)`, `workspacesRepo.deleteCascade(id)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/session.test.ts
import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { startGuestSession, sessionFromHeaders } from "@/lib/auth/session";
import { workspacesRepo } from "@/lib/repo/workspaces";

function cookieHeader(from: Headers): Headers {
  const setCookie = from.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return new Headers({ cookie: setCookie });
}

describe("guest sessions", () => {
  it("creates an anonymous user with a guest workspace that expires in seven days", async () => {
    const { headers, info } = await startGuestSession();
    expect(info.isAnonymous).toBe(true);
    const ws = await workspacesRepo.getById(info.workspaceId);
    expect(ws?.kind).toBe("guest");
    const days = (ws!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const again = await sessionFromHeaders(cookieHeader(headers));
    expect(again?.userId).toBe(info.userId);
    expect(again?.workspaceId).toBe(info.workspaceId);
  });

  it("returns the same workspace for the same user", async () => {
    const { info } = await startGuestSession();
    const first = await workspacesRepo.findOrCreateForUser(info.userId, true);
    const second = await workspacesRepo.findOrCreateForUser(info.userId, true);
    expect(first.id).toBe(second.id);
  });

  it("exposes the session endpoints", async () => {
    expect(typeof auth.api.getSession).toBe("function");
    expect(typeof auth.api.signInAnonymous).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- session`
Expected: FAIL, missing modules.

- [ ] **Step 3: Write the errors helper and the workspaces repository**

```ts
// src/lib/api/errors.ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = () => new ApiError(403, "forbidden", "That action is not allowed.");
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);
```

```ts
// src/lib/repo/workspaces.ts
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

const GUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type Workspace = typeof workspaces.$inferSelect;

export const workspacesRepo = {
  async findOrCreateForUser(userId: string, isAnonymous: boolean): Promise<Workspace> {
    const db = getDb();
    const existing = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.ownerUserId, userId), isNull(workspaces.deletedAt)),
    });
    if (existing) return existing;
    const [created] = await db
      .insert(workspaces)
      .values({
        ownerUserId: userId,
        kind: isAnonymous ? "guest" : "account",
        expiresAt: isAnonymous ? new Date(Date.now() + GUEST_LIFETIME_MS) : null,
      })
      .returning();
    return created;
  },

  async getById(id: string): Promise<Workspace | null> {
    const db = getDb();
    const row = await db.query.workspaces.findFirst({ where: and(eq(workspaces.id, id), isNull(workspaces.deletedAt)) });
    return row ?? null;
  },

  async promoteToAccount(workspaceId: string, newOwnerUserId: string): Promise<void> {
    await getDb()
      .update(workspaces)
      .set({ ownerUserId: newOwnerUserId, kind: "account", expiresAt: null, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  },

  async deleteCascade(id: string): Promise<void> {
    await getDb().delete(workspaces).where(eq(workspaces.id, id));
  },
};
```

- [ ] **Step 4: Complete the auth server config and write the session helpers**

```ts
// src/lib/auth/server.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { authSecret, env, isProduction } from "@/lib/env";
import { workspacesRepo } from "@/lib/repo/workspaces";

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: "vouch",
    useSecureCookies: isProduction,
  },
  socialProviders: googleEnabled
    ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
    : {},
  plugins: [
    anonymous({
      emailDomainName: "guest.vouch.local",
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const ws = await workspacesRepo.findOrCreateForUser(anonymousUser.user.id, true);
        await workspacesRepo.promoteToAccount(ws.id, newUser.user.id);
      },
    }),
  ],
});

export const isGoogleSignInEnabled = googleEnabled;
```

```ts
// src/lib/auth/client.ts
"use client";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [anonymousClient()] });
```

```ts
// src/lib/auth/session.ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { unauthorized } from "@/lib/api/errors";
import { ensureDbReady } from "@/lib/db/client";
import { workspacesRepo } from "@/lib/repo/workspaces";

export type SessionInfo = {
  userId: string;
  sessionId: string;
  isAnonymous: boolean;
  workspaceId: string;
};

export async function sessionFromHeaders(h: Headers): Promise<SessionInfo | null> {
  await ensureDbReady();
  const result = await auth.api.getSession({ headers: h });
  if (!result) return null;
  const isAnonymous = Boolean((result.user as { isAnonymous?: boolean }).isAnonymous);
  const ws = await workspacesRepo.findOrCreateForUser(result.user.id, isAnonymous);
  return { userId: result.user.id, sessionId: result.session.id, isAnonymous, workspaceId: ws.id };
}

export async function getSession(): Promise<SessionInfo | null> {
  return sessionFromHeaders(await headers());
}

export async function requireSession(): Promise<SessionInfo> {
  const info = await getSession();
  if (!info) throw unauthorized();
  return info;
}

/** Creates an anonymous user and session. Returns the Set-Cookie headers to forward. */
export async function startGuestSession(): Promise<{ headers: Headers; info: SessionInfo }> {
  await ensureDbReady();
  const { headers: setCookie, response } = await auth.api.signInAnonymous({ returnHeaders: true });
  if (!response?.user) throw new Error("Anonymous sign-in returned no user");
  const ws = await workspacesRepo.findOrCreateForUser(response.user.id, true);
  const cookie = setCookie.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("Anonymous session could not be read back");
  return {
    headers: setCookie,
    info: { userId: response.user.id, sessionId: session.session.id, isAnonymous: true, workspaceId: ws.id },
  };
}
```

- [ ] **Step 5: Write the auth route, the session start route, and the proxy**

```ts
// src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

export const { GET, POST } = toNextJsHandler(auth);
```

```ts
// src/app/api/session/start/route.ts
import { NextResponse } from "next/server";
import { getSession, startGuestSession } from "@/lib/auth/session";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const existing = await getSession();
  if (existing) return NextResponse.redirect(new URL(next, url.origin));

  const { headers } = await startGuestSession();
  const res = NextResponse.redirect(new URL(next, url.origin));
  for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}
```

```ts
// src/proxy.ts
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const cookie = getSessionCookie(request, { cookiePrefix: "vouch" });
  if (cookie) return NextResponse.next();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  const start = new URL("/api/session/start", request.url);
  start.searchParams.set("next", next);
  return NextResponse.redirect(start);
}

export const config = {
  matcher: ["/", "/documents/:path*", "/invoices", "/how-it-works"],
};
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:integration -- session`
Expected: 3 passed. If `auth.api.signInAnonymous` is named differently in this Better Auth version, run `node -e` to print `Object.keys(auth.api)` from a tsx script and use the anonymous sign-in endpoint it lists.

- [ ] **Step 7: Verify the bootstrap in the browser**

Run `pnpm dev`, open http://localhost:3000 in a private window. Expected: one redirect through `/api/session/start`, then the page, and a `vouch.session_token` cookie in devtools. Reloading does not redirect again.

- [ ] **Step 8: Append a decisions entry and commit**

Append to `decisions.md`:

```markdown
## 2026-09-14: Guest sessions are real sessions, bootstrapped by a redirect

**Decision.** First visits to a page route redirect once through a session-start endpoint that creates an anonymous Better Auth user and a guest workspace, then land on the page with the cookie set.
**Alternatives.** A bare random cookie with no server record; creating the session inside the proxy and rewriting request headers; client-side sign-in on mount.
**Reasoning.** A real session gives expiry, rotation, revocation, and a clean upgrade path to Google sign-in through the anonymous plugin's link hook. The single redirect costs one round trip on the first visit and avoids fiddly header rewriting or a client-side flash.
**Cut.** Creating sessions for API-only callers. Requests without a session get a 401.
```

```bash
git add -A
git commit -m "feat: guest sessions with workspace bootstrap"
```

---

### Task 6: Repository layer for documents, pipeline runs, and audit

**Files:**
- Create: `src/lib/repo/documents.ts`, `src/lib/repo/pipeline-runs.ts`, `src/lib/repo/audit.ts`, `src/lib/repo/index.ts`
- Test: `tests/integration/repo-isolation.test.ts`

**Interfaces:**
- Produces: `documentsRepo.create(input)`, `documentsRepo.getById(workspaceId, id)`, `documentsRepo.listByWorkspace(workspaceId)`, `documentsRepo.findBySha(workspaceId, sha256)`, `documentsRepo.countByWorkspace(workspaceId)`, `documentsRepo.setStatus(id, status, failure?)`, `documentsRepo.update(id, patch)`, `documentsRepo.delete(workspaceId, id)`; `pipelineRunsRepo.start(documentId, stage, jobId)`, `pipelineRunsRepo.finish(runId, status, meta?, error?)`, `pipelineRunsRepo.hasSucceeded(documentId, stage)`, `pipelineRunsRepo.listByDocument(documentId)`; `auditRepo.log(entry)`.

- [ ] **Step 1: Write the failing isolation test**

```ts
// tests/integration/repo-isolation.test.ts
import { describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { documentsRepo } from "@/lib/repo/documents";

async function workspace(): Promise<string> {
  return (await startGuestSession()).info.workspaceId;
}

describe("workspace isolation", () => {
  it("never returns another workspace's documents", async () => {
    const a = await workspace();
    const b = await workspace();
    const doc = await documentsRepo.create({
      workspaceId: a,
      originalFilename: "one.pdf",
      mime: "application/pdf",
      byteSize: 10,
      sha256: "abc",
      blobKey: `${a}/abc.pdf`,
    });
    expect(await documentsRepo.getById(a, doc.id)).not.toBeNull();
    expect(await documentsRepo.getById(b, doc.id)).toBeNull();
    expect(await documentsRepo.listByWorkspace(b)).toHaveLength(0);
    expect(await documentsRepo.findBySha(b, "abc")).toBeNull();
    expect(await documentsRepo.delete(b, doc.id)).toBe(false);
    expect(await documentsRepo.delete(a, doc.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- repo-isolation`
Expected: FAIL, missing module.

- [ ] **Step 3: Write the repositories**

```ts
// src/lib/repo/documents.ts
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

export type Document = typeof documents.$inferSelect;
export type DocumentStatus = Document["status"];
export type NewDocument = {
  workspaceId: string;
  originalFilename: string;
  mime: string;
  byteSize: number;
  sha256: string;
  blobKey: string;
  kind?: Document["kind"];
};

export const documentsRepo = {
  async create(input: NewDocument): Promise<Document> {
    const [row] = await getDb().insert(documents).values(input).returning();
    return row;
  },

  async getById(workspaceId: string, id: string): Promise<Document | null> {
    const row = await getDb().query.documents.findFirst({
      where: and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)),
    });
    return row ?? null;
  },

  /** Internal use by the pipeline, which already holds a trusted document id. */
  async getByIdUnscoped(id: string): Promise<Document | null> {
    const row = await getDb().query.documents.findFirst({ where: eq(documents.id, id) });
    return row ?? null;
  },

  async listByWorkspace(workspaceId: string): Promise<Document[]> {
    return getDb().query.documents.findMany({
      where: eq(documents.workspaceId, workspaceId),
      orderBy: [desc(documents.createdAt)],
    });
  },

  async findBySha(workspaceId: string, sha256: string): Promise<Document | null> {
    const row = await getDb().query.documents.findFirst({
      where: and(eq(documents.workspaceId, workspaceId), eq(documents.sha256, sha256)),
    });
    return row ?? null;
  },

  async countByWorkspace(workspaceId: string): Promise<number> {
    const [row] = await getDb().select({ n: count() }).from(documents).where(eq(documents.workspaceId, workspaceId));
    return Number(row?.n ?? 0);
  },

  async setStatus(id: string, status: DocumentStatus, failure?: { code: string; message: string }): Promise<void> {
    await getDb()
      .update(documents)
      .set({
        status,
        failureCode: failure?.code ?? null,
        failureMessage: failure?.message ?? null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id));
  },

  async update(id: string, patch: Partial<Pick<Document, "kind" | "pageCount" | "docType">>): Promise<void> {
    await getDb().update(documents).set({ ...patch, updatedAt: new Date() }).where(eq(documents.id, id));
  },

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await getDb()
      .delete(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)))
      .returning({ id: documents.id });
    return rows.length > 0;
  },
};
```

```ts
// src/lib/repo/pipeline-runs.ts
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { pipelineRuns } from "@/lib/db/schema";

export type PipelineRun = typeof pipelineRuns.$inferSelect;

export const pipelineRunsRepo = {
  async start(documentId: string, stage: string, jobId: string | null): Promise<PipelineRun> {
    const [row] = await getDb().insert(pipelineRuns).values({ documentId, stage, jobId }).returning();
    return row;
  },

  async finish(
    runId: string,
    status: "succeeded" | "failed" | "skipped",
    meta: Record<string, unknown> = {},
    error?: string,
  ): Promise<void> {
    const db = getDb();
    const run = await db.query.pipelineRuns.findFirst({ where: eq(pipelineRuns.id, runId) });
    const finishedAt = new Date();
    await db
      .update(pipelineRuns)
      .set({
        status,
        finishedAt,
        durationMs: run ? finishedAt.getTime() - run.startedAt.getTime() : null,
        meta,
        error: error ?? null,
      })
      .where(eq(pipelineRuns.id, runId));
  },

  async hasSucceeded(documentId: string, stage: string): Promise<boolean> {
    const row = await getDb().query.pipelineRuns.findFirst({
      where: and(eq(pipelineRuns.documentId, documentId), eq(pipelineRuns.stage, stage), eq(pipelineRuns.status, "succeeded")),
    });
    return Boolean(row);
  },

  async listByDocument(documentId: string): Promise<PipelineRun[]> {
    return getDb().query.pipelineRuns.findMany({
      where: eq(pipelineRuns.documentId, documentId),
      orderBy: [asc(pipelineRuns.startedAt)],
    });
  },
};
```

```ts
// src/lib/repo/audit.ts
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export type AuditEntry = {
  workspaceId: string;
  actorSessionId: string;
  action: string;
  targetType: string;
  targetId?: string;
  meta?: Record<string, unknown>;
};

export const auditRepo = {
  async log(entry: AuditEntry): Promise<void> {
    await getDb().insert(auditLog).values({ ...entry, meta: entry.meta ?? {} });
  },
};
```

```ts
// src/lib/repo/index.ts
export { workspacesRepo } from "./workspaces";
export { documentsRepo } from "./documents";
export { pipelineRunsRepo } from "./pipeline-runs";
export { auditRepo } from "./audit";
```

- [ ] **Step 4: Run the test**

Run: `pnpm test:integration -- repo-isolation`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: workspace-scoped repositories for documents, runs, and audit"
```

---

### Task 7: File intake utilities and the blob store

**Files:**
- Create: `src/lib/files/detect-type.ts`, `src/lib/files/hash.ts`, `src/lib/files/sanitize.ts`, `src/lib/blob/types.ts`, `src/lib/blob/local-fs.ts`, `src/lib/blob/vercel.ts`, `src/lib/blob/index.ts`
- Test: `tests/unit/files.test.ts`, `tests/unit/local-blob.test.ts`

**Interfaces:**
- Produces: `detectFileType(bytes): SupportedMime | null` where `SupportedMime = "application/pdf" | "image/png" | "image/jpeg"`; `extensionFor(mime)`; `sha256Hex(bytes): string`; `sanitizeFilename(name): string`; `BlobStore` interface `{ put(key, bytes, contentType): Promise<void>; get(key): Promise<{ bytes: Uint8Array; contentType: string } | null>; delete(key): Promise<void>; probe(): Promise<boolean> }`; `getBlobStore(): BlobStore`; `assertSafeKey(key)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/files.test.ts
import { describe, expect, it } from "vitest";
import { detectFileType, extensionFor } from "@/lib/files/detect-type";
import { sha256Hex } from "@/lib/files/hash";
import { sanitizeFilename } from "@/lib/files/sanitize";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("detectFileType", () => {
  it("recognises PDF, PNG and JPEG by magic bytes", () => {
    expect(detectFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });
  it("rejects anything else, including a renamed text file", () => {
    expect(detectFileType(new TextEncoder().encode("hello world, not a pdf"))).toBeNull();
    expect(detectFileType(new Uint8Array(0))).toBeNull();
  });
  it("maps mime to extension", () => {
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("sha256Hex", () => {
  it("is stable and hex encoded", () => {
    const a = sha256Hex(new TextEncoder().encode("abc"));
    expect(a).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("sanitizeFilename", () => {
  it("strips paths and control characters and caps length", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\inv oice.PDF")).toBe("inv oice.PDF");
    expect(sanitizeFilename("bad\u0000name\n.pdf")).toBe("badname.pdf");
    expect(sanitizeFilename("x".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120);
    expect(sanitizeFilename("")).toBe("document");
  });
});
```

```ts
// tests/unit/local-blob.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalFsBlobStore } from "@/lib/blob/local-fs";
import { assertSafeKey } from "@/lib/blob/types";

const dir = mkdtempSync(path.join(os.tmpdir(), "vouch-blob-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("LocalFsBlobStore", () => {
  const store = new LocalFsBlobStore(dir);
  it("round-trips bytes and content type", async () => {
    await store.put("ws1/abc.pdf", new TextEncoder().encode("%PDF-1.4 fake"), "application/pdf");
    const got = await store.get("ws1/abc.pdf");
    expect(got?.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(got!.bytes)).toBe("%PDF-1.4 fake");
    await store.delete("ws1/abc.pdf");
    expect(await store.get("ws1/abc.pdf")).toBeNull();
  });
  it("probes successfully", async () => {
    expect(await store.probe()).toBe(true);
  });
});

describe("assertSafeKey", () => {
  it("rejects traversal and absolute keys", () => {
    expect(() => assertSafeKey("../x")).toThrow();
    expect(() => assertSafeKey("/etc/passwd")).toThrow();
    expect(() => assertSafeKey("ws/../../x")).toThrow();
    expect(() => assertSafeKey("ws1/abc.pdf")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:unit -- files local-blob`
Expected: FAIL, missing modules.

- [ ] **Step 3: Write the file utilities**

```ts
// src/lib/files/detect-type.ts
export type SupportedMime = "application/pdf" | "image/png" | "image/jpeg";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

export function detectFileType(bytes: Uint8Array): SupportedMime | null {
  if (startsWith(bytes, PDF)) return "application/pdf";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  return null;
}

export function extensionFor(mime: SupportedMime): "pdf" | "png" | "jpg" {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
  }
}
```

```ts
// src/lib/files/hash.ts
import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

```ts
// src/lib/files/sanitize.ts
const MAX = 120;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return "document";
  if (cleaned.length <= MAX) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX - ext.length) + ext;
}
```

- [ ] **Step 4: Write the blob store**

```ts
// src/lib/blob/types.ts
export type BlobObject = { bytes: Uint8Array; contentType: string };

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  probe(): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe blob key: ${key}`);
}
```

```ts
// src/lib/blob/local-fs.ts
import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type BlobObject, type BlobStore } from "./types";

export class LocalFsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<BlobObject | null> {
    const file = this.resolve(key);
    try {
      const [bytes, meta] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, "utf8")]);
      return { bytes: new Uint8Array(bytes), contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async probe(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root);
      return true;
    } catch {
      return false;
    }
  }
}
```

```ts
// src/lib/blob/vercel.ts
import { del, get, list, put } from "@vercel/blob";
import { assertSafeKey, type BlobObject, type BlobStore } from "./types";

export class VercelBlobStore implements BlobStore {
  constructor(private readonly token: string) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await put(key, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      token: this.token,
    });
  }

  async get(key: string): Promise<BlobObject | null> {
    assertSafeKey(key);
    const result = await get(key, { access: "private", token: this.token, useCache: false });
    if (!result) return null;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    const contentType = (result.blob as { contentType?: string }).contentType ?? "application/octet-stream";
    return { bytes, contentType };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await del(key, { token: this.token });
  }

  async probe(): Promise<boolean> {
    try {
      await list({ limit: 1, token: this.token });
      return true;
    } catch {
      return false;
    }
  }
}
```

If `get()` returns a different shape in the installed `@vercel/blob` version, adapt `get` in this class only; nothing else touches the SDK. Test the class manually against a real store in Task 13, since there is no local emulator.

```ts
// src/lib/blob/index.ts
import path from "node:path";
import { env } from "@/lib/env";
import { LocalFsBlobStore } from "./local-fs";
import type { BlobStore } from "./types";
import { VercelBlobStore } from "./vercel";

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  store ??= env.BLOB_READ_WRITE_TOKEN
    ? new VercelBlobStore(env.BLOB_READ_WRITE_TOKEN)
    : new LocalFsBlobStore(path.join(env.LOCAL_DATA_DIR, "blobs"));
  return store;
}

export type { BlobStore } from "./types";
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:unit -- files local-blob`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: file type detection, hashing, filename sanitising, and blob store"
```

---

### Task 8: Job queue

**Files:**
- Create: `src/lib/repo/jobs.ts`, `src/lib/queue/claim.ts`
- Test: `tests/integration/queue.test.ts`

**Interfaces:**
- Produces: `jobsRepo.enqueue({ workspaceId, documentId, kind })`, `jobsRepo.getById(id)`, `jobsRepo.latestForDocument(documentId)`, `jobsRepo.complete(id)`, `jobsRepo.fail(id, error)` which requeues with backoff or marks dead, `jobsRepo.requeue(id)` for manual retry, `jobsRepo.countQueued()`; `claimJobs({ runnerId, limit, perWorkspace, global }): Promise<Job[]>`; `sweepStale(thresholdMs): Promise<number>`; constants `JOB_LIMITS = { perWorkspace: 2, global: 5, maxAttempts: 3, staleMs: 6 * 60_000 }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/queue.test.ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startGuestSession } from "@/lib/auth/session";
import { dbFlavour, getDb } from "@/lib/db/client";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";
import { JOB_LIMITS, claimJobs, sweepStale } from "@/lib/queue/claim";

async function docInNewWorkspace() {
  const { info } = await startGuestSession();
  const doc = await documentsRepo.create({
    workspaceId: info.workspaceId,
    originalFilename: "a.pdf",
    mime: "application/pdf",
    byteSize: 1,
    sha256: crypto.randomUUID(),
    blobKey: `${info.workspaceId}/a.pdf`,
  });
  return { workspaceId: info.workspaceId, documentId: doc.id };
}

describe("job queue", () => {
  it("claims queued jobs oldest first and marks them running", async () => {
    const a = await docInNewWorkspace();
    const j1 = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    const claimed = await claimJobs({ runnerId: "t", limit: 5, perWorkspace: 2, global: 5 });
    expect(claimed.map((j) => j.id)).toContain(j1.id);
    expect(claimed.find((j) => j.id === j1.id)?.status).toBe("running");
    expect(claimed.find((j) => j.id === j1.id)?.attempts).toBe(1);
    const again = await claimJobs({ runnerId: "t2", limit: 5, perWorkspace: 2, global: 5 });
    expect(again.map((j) => j.id)).not.toContain(j1.id);
  });

  it("respects the per-workspace cap", async () => {
    const a = await docInNewWorkspace();
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    const claimed = await claimJobs({ runnerId: "t", limit: 10, perWorkspace: 2, global: 50 });
    const mine = claimed.filter((j) => j.workspaceId === a.workspaceId);
    expect(mine).toHaveLength(2);
  });

  it("fails with backoff and dies after max attempts", async () => {
    const a = await docInNewWorkspace();
    const job = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    for (let attempt = 1; attempt <= JOB_LIMITS.maxAttempts; attempt++) {
      await getDb().execute(sql`update jobs set run_after = now() - interval '1 second' where id = ${job.id}`);
      const claimed = await claimJobs({ runnerId: "t", limit: 50, perWorkspace: 50, global: 50 });
      expect(claimed.map((j) => j.id)).toContain(job.id);
      await jobsRepo.fail(job.id, `boom ${attempt}`);
      const after = await jobsRepo.getById(job.id);
      if (attempt < JOB_LIMITS.maxAttempts) {
        expect(after?.status).toBe("queued");
        expect(after!.runAfter.getTime()).toBeGreaterThan(Date.now());
      } else {
        expect(after?.status).toBe("dead");
      }
    }
  });

  it("requeues stale running jobs", async () => {
    const a = await docInNewWorkspace();
    const job = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await claimJobs({ runnerId: "t", limit: 50, perWorkspace: 50, global: 50 });
    await getDb().execute(sql`update jobs set locked_at = now() - interval '10 minutes' where id = ${job.id}`);
    const swept = await sweepStale(JOB_LIMITS.staleMs);
    expect(swept).toBeGreaterThanOrEqual(1);
    expect((await jobsRepo.getById(job.id))?.status).toBe("queued");
  });

  it.skipIf(dbFlavour() === "pglite")("never double-claims under concurrency", async () => {
    const a = await docInNewWorkspace();
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) ids.add((await jobsRepo.enqueue({ ...a, kind: "process_document" })).id);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimJobs({ runnerId: `r${i}`, limit: 2, perWorkspace: 50, global: 50 })),
    );
    const claimed = results.flat().map((j) => j.id);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration -- queue`
Expected: FAIL, missing modules.

- [ ] **Step 3: Write the jobs repository and the claim logic**

```ts
// src/lib/repo/jobs.ts
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

export type Job = typeof jobs.$inferSelect;

export const JOB_LIMITS = { perWorkspace: 2, global: 5, maxAttempts: 3, staleMs: 6 * 60_000 } as const;

export function backoffMs(attempts: number): number {
  return 30_000 * 2 ** Math.max(0, attempts - 1);
}

export const jobsRepo = {
  async enqueue(input: { workspaceId: string; documentId: string | null; kind: string }): Promise<Job> {
    const [row] = await getDb()
      .insert(jobs)
      .values({ ...input, maxAttempts: JOB_LIMITS.maxAttempts })
      .returning();
    return row;
  },

  async getById(id: string): Promise<Job | null> {
    const row = await getDb().query.jobs.findFirst({ where: eq(jobs.id, id) });
    return row ?? null;
  },

  async latestForDocument(documentId: string): Promise<Job | null> {
    const row = await getDb().query.jobs.findFirst({
      where: eq(jobs.documentId, documentId),
      orderBy: [desc(jobs.createdAt)],
    });
    return row ?? null;
  },

  async complete(id: string): Promise<void> {
    await getDb()
      .update(jobs)
      .set({ status: "succeeded", lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  },

  /** Requeues with exponential backoff, or marks dead once attempts are exhausted. */
  async fail(id: string, error: string): Promise<Job | null> {
    const db = getDb();
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!job) return null;
    const dead = job.attempts >= job.maxAttempts;
    const [row] = await db
      .update(jobs)
      .set({
        status: dead ? "dead" : "queued",
        runAfter: dead ? job.runAfter : new Date(Date.now() + backoffMs(job.attempts)),
        lastError: error.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id))
      .returning();
    return row;
  },

  /** Manual retry from the UI. Resets attempts so the user gets a full budget again. */
  async requeue(id: string): Promise<void> {
    await getDb()
      .update(jobs)
      .set({ status: "queued", attempts: 0, runAfter: new Date(), lastError: null, lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  },

  async countQueued(): Promise<number> {
    const [row] = await getDb().select({ n: count() }).from(jobs).where(and(eq(jobs.status, "queued")));
    return Number(row?.n ?? 0);
  },
};
```

```ts
// src/lib/queue/claim.ts
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { JOB_LIMITS, type Job } from "@/lib/repo/jobs";

export { JOB_LIMITS };

type ClaimOptions = { runnerId: string; limit: number; perWorkspace: number; global: number };

type RawJob = {
  id: string;
  workspace_id: string;
  document_id: string | null;
  kind: string;
  status: Job["status"];
  attempts: number;
  max_attempts: number;
  run_after: string | Date;
  locked_at: string | Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function toJob(r: RawJob): Job {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    documentId: r.document_id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: new Date(r.run_after),
    lockedAt: r.locked_at ? new Date(r.locked_at) : null,
    lockedBy: r.locked_by,
    lastError: r.last_error,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/**
 * Claims up to `limit` queued jobs whose run_after has passed, oldest first, skipping rows
 * another claimer holds. The per-workspace and global caps are soft: two claimers racing
 * can overshoot by a claim, which is acceptable for a demo-scale system.
 */
export async function claimJobs(opts: ClaimOptions): Promise<Job[]> {
  const db = getDb();
  const result = await db.execute<RawJob>(sql`
    with candidate as (
      select j.id
      from jobs j
      where j.status = 'queued'
        and j.run_after <= now()
        and (select count(*) from jobs r where r.status = 'running') < ${opts.global}
        and (select count(*) from jobs r where r.status = 'running' and r.workspace_id = j.workspace_id) < ${opts.perWorkspace}
      order by j.created_at asc
      limit ${opts.limit}
      for update skip locked
    )
    update jobs
    set status = 'running',
        locked_at = now(),
        locked_by = ${opts.runnerId},
        attempts = jobs.attempts + 1,
        updated_at = now()
    from candidate
    where jobs.id = candidate.id
    returning jobs.*
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: RawJob[] }).rows) as RawJob[];
  return rows.map(toJob);
}

/** Returns running jobs whose lock is older than the threshold to the queue with backoff. */
export async function sweepStale(thresholdMs: number): Promise<number> {
  const db = getDb();
  const result = await db.execute<{ id: string }>(sql`
    update jobs
    set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
        run_after = now() + make_interval(secs => 30 * power(2, greatest(attempts - 1, 0))),
        last_error = coalesce(last_error, 'stale lock recovered'),
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where status = 'running'
      and locked_at < now() - make_interval(secs => ${Math.floor(thresholdMs / 1000)})
    returning id
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as unknown[];
  return rows.length;
}
```

Drizzle's `execute` returns an array on PGlite and a `{ rows }` object on node-postgres, which is why both shapes are handled.

- [ ] **Step 4: Run the tests**

Run: `pnpm test:integration -- queue`
Expected: 4 passed, 1 skipped on PGlite. With `TEST_DATABASE_URL` pointing at a real Postgres, 5 passed.

- [ ] **Step 5: Append a decisions entry and commit**

Append to `decisions.md`:

```markdown
## 2026-09-14: Postgres queue claims with skip-locked; caps are soft

**Decision.** Jobs live in a `jobs` table and are claimed with `FOR UPDATE SKIP LOCKED`, oldest first, with per-workspace and global caps checked inside the claim query.
**Alternatives.** Advisory locks to make the caps exact; a Redis-backed queue.
**Reasoning.** Skip-locked gives correct at-least-once claiming with no extra service. The caps are enforced by counting running rows in the same statement, which two racing claimers can overshoot by one; at demo scale that is harmless and the simpler query is easier to read and test.
**Cut.** Exact caps via advisory locks. Noted as the first change if the queue ever runs hot.
```

```bash
git add -A
git commit -m "feat: job queue with skip-locked claims, backoff, and stale recovery"
```

---

### Task 9: Pipeline core: types, mock model, risk, normalisers, extract and finalise stages, runner

**Files:**
- Create: `src/lib/logger.ts`, `src/lib/pipeline/types.ts`, `src/lib/pipeline/errors.ts`, `src/lib/pipeline/extract/schema.ts`, `src/lib/pipeline/extract/ground-truth.ts`, `src/lib/pipeline/extract/mock-provider.ts`, `src/lib/pipeline/extract/model.ts`, `src/lib/pipeline/risk.ts`, `src/lib/normalize/money.ts`, `src/lib/normalize/vendor.ts`, `src/lib/repo/extractions.ts`, `src/lib/repo/usage.ts`, `src/lib/repo/invoices.ts`, `src/lib/pipeline/stages/extract.ts`, `src/lib/pipeline/stages/finalise.ts`, `src/lib/pipeline/runner.ts`
- Test: `tests/unit/money.test.ts`, `tests/unit/vendor.test.ts`, `tests/unit/risk.test.ts`, `tests/integration/pipeline-mock.test.ts`

**Interfaces:**
- Consumes: `documentsRepo`, `pipelineRunsRepo`, `jobsRepo`, `getBlobStore()`, `llmMode`, `SupportedMime`.
- Produces: `ExtractionResult`, `extractionResultSchema`, `GroundTruth`, `groundTruthSchema`, `ModelProvider` interface, `getModelProvider()`, `setModelProviderForTests(p | null)`, `computeRisk(input)`, `riskBand(risk)`, `criticalityFor(fieldPath)`, `parseMoney(text)`, `vendorKey(name)`, `extractionsRepo.record(...)`, `extractionsRepo.latest(documentId)`, `usageRepo.record(...)`, `invoicesRepo.upsertFromExtraction(...)`, `invoicesRepo.getByDocument(workspaceId, documentId)`, `runJob(job)`, `STAGES`, `StageError`.

- [ ] **Step 1: Write the failing unit tests for the normalisers and risk**

```ts
// tests/unit/money.test.ts
import { describe, expect, it } from "vitest";
import { parseMoney } from "@/lib/normalize/money";

describe("parseMoney", () => {
  it.each([
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["1,23,456.00", "123456.00"],
    ["$1,234.56", "1234.56"],
    ["USD 12", "12.00"],
    ["(123.45)", "-123.45"],
    ["-5", "-5.00"],
    ["12,34", "12.34"],
    ["1,234", "1234.00"],
    ["1.234", "1234.00"],
    ["0.5", "0.50"],
    ["€ 99,90", "99.90"],
    ["₹1,50,000", "150000.00"],
    ["1'234.50", "1234.50"],
    ["1764.48", "1764.48"],
  ])("parses %s to %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });
  it("returns null when there are no digits", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});
```

```ts
// tests/unit/vendor.test.ts
import { describe, expect, it } from "vitest";
import { vendorKey } from "@/lib/normalize/vendor";

describe("vendorKey", () => {
  it("groups spellings of the same vendor", () => {
    expect(vendorKey("Acme Corp.")).toBe("acme");
    expect(vendorKey("ACME Corporation")).toBe("acme");
    expect(vendorKey("acme corp")).toBe("acme");
    expect(vendorKey("Halcyon Cloud Services Inc.")).toBe("halcyon cloud services");
    expect(vendorKey("Meridian Office Supplies Ltd")).toBe("meridian office supplies");
  });
  it("keeps distinct vendors distinct", () => {
    expect(vendorKey("Acme Logistics")).not.toBe(vendorKey("Acme Corp"));
  });
});
```

```ts
// tests/unit/risk.test.ts
import { describe, expect, it } from "vitest";
import { computeRisk, criticalityFor, riskBand } from "@/lib/pipeline/risk";

describe("risk", () => {
  it("is low for an exactly grounded clean money field", () => {
    const r = computeRisk({ groundingScore: 1, blockingIssues: 0, warningIssues: 0, modelConfidence: 0.95, criticality: 1 });
    expect(r).toBeLessThan(0.2);
    expect(riskBand(r)).toBe("low");
  });
  it("is high for an ungrounded money field", () => {
    const r = computeRisk({ groundingScore: 0, blockingIssues: 0, warningIssues: 0, modelConfidence: 0.95, criticality: 1 });
    expect(riskBand(r)).toBe("high");
  });
  it("a blocking issue pushes a grounded field to high", () => {
    const r = computeRisk({ groundingScore: 1, blockingIssues: 1, warningIssues: 0, modelConfidence: 0.95, criticality: 1 });
    expect(riskBand(r)).toBe("high");
  });
  it("warnings cap at two and scale with criticality", () => {
    const money = computeRisk({ groundingScore: 1, blockingIssues: 0, warningIssues: 5, modelConfidence: 1, criticality: 1 });
    const other = computeRisk({ groundingScore: 1, blockingIssues: 0, warningIssues: 5, modelConfidence: 1, criticality: 0.5 });
    expect(money).toBeCloseTo(0.5, 5);
    expect(other).toBeCloseTo(0.25, 5);
    expect(riskBand(money)).toBe("high");
    expect(riskBand(other)).toBe("medium");
  });
  it("assigns criticality by field path", () => {
    expect(criticalityFor("total")).toBe(1);
    expect(criticalityFor("lineItems.3.amount")).toBe(1);
    expect(criticalityFor("invoiceNumber")).toBe(0.8);
    expect(criticalityFor("issueDate")).toBe(0.8);
    expect(criticalityFor("lineItems.0.description")).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:unit -- money vendor risk`
Expected: FAIL, missing modules.

- [ ] **Step 3: Write the normalisers and risk**

```ts
// src/lib/normalize/money.ts
const CURRENCY = /[$€£₹¥]|\b(usd|eur|gbp|inr|jpy|aud|cad|chf|sgd|aed)\b/gi;

/**
 * Parses a money string in any common locale into a canonical "1234.56" string.
 * Returns null when the input has no digits.
 */
export function parseMoney(input: string): string | null {
  if (!input) return null;
  let s = input.replace(CURRENCY, "").replace(/\s+/g, "").replace(/'/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith("-") || /cr$/i.test(s)) {
    negative = true;
    s = s.replace(/-$/, "").replace(/cr$/i, "");
  }
  if (!/\d/.test(s)) return null;
  s = s.replace(/[^\d.,]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let integer = s;
  let fraction = "";

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const idx = decimalSep === "," ? lastComma : lastDot;
    integer = s.slice(0, idx);
    fraction = s.slice(idx + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const idx = lastComma >= 0 ? lastComma : lastDot;
    const after = s.slice(idx + 1);
    const count = s.split(sep).length - 1;
    const isThousands = after.length === 3 && (count > 1 || /^\d{1,3}$/.test(s.slice(0, idx)) || after.length === 3);
    if (isThousands && after.length === 3) {
      integer = s;
      fraction = "";
    } else {
      integer = s.slice(0, idx);
      fraction = after;
    }
  }

  integer = integer.replace(/[.,]/g, "");
  fraction = fraction.replace(/[.,]/g, "");
  if (!/^\d*$/.test(integer) || !/^\d*$/.test(fraction)) return null;
  const whole = integer === "" ? "0" : String(Number(integer));
  const cents = (fraction + "00").slice(0, 2);
  const roundedExtra = fraction.length > 2 ? Number(fraction[2]) >= 5 : false;
  let value = BigInt(whole) * 100n + BigInt(cents);
  if (roundedExtra) value += 1n;
  const str = value.toString().padStart(3, "0");
  const out = `${str.slice(0, -2)}.${str.slice(-2)}`;
  return negative && value !== 0n ? `-${out}` : out;
}
```

```ts
// src/lib/normalize/vendor.ts
const SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "pvt", "private",
  "plc", "sa", "ag", "bv", "srl", "sarl", "pty", "llp", "lp",
]);

export function vendorKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}
```

```ts
// src/lib/pipeline/risk.ts
export type RiskInput = {
  groundingScore: number;
  blockingIssues: number;
  warningIssues: number;
  modelConfidence: number;
  criticality: number;
};

export type RiskBand = "low" | "medium" | "high";

const MONEY = /^(subtotal|tax|shipping|discount|total)$|^lineItems\.\d+\.(amount|unitPrice)$/;
const IDENTITY = /^(vendorName|invoiceNumber|issueDate|dueDate|currency)$/;

export function criticalityFor(fieldPath: string): number {
  if (MONEY.test(fieldPath)) return 1;
  if (IDENTITY.test(fieldPath)) return 0.8;
  return 0.5;
}

export function computeRisk(i: RiskInput): number {
  const raw =
    (1 - i.groundingScore) +
    0.5 * i.blockingIssues +
    0.25 * Math.min(i.warningIssues, 2) +
    0.2 * (1 - i.modelConfidence);
  return Math.min(1, Math.max(0, raw * i.criticality));
}

export function riskBand(risk: number): RiskBand {
  if (risk < 0.2) return "low";
  if (risk < 0.5) return "medium";
  return "high";
}
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm test:unit -- money vendor risk`
Expected: all pass. If a `parseMoney` case fails, fix the heuristic rather than the expectation; the table is the contract.

- [ ] **Step 5: Write the pipeline types, schemas, and errors**

```ts
// src/lib/logger.ts
type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit("info", event, fields),
  warn: (event: string, fields: Fields = {}) => emit("warn", event, fields),
  error: (event: string, fields: Fields = {}) => emit("error", event, fields),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

```ts
// src/lib/pipeline/extract/schema.ts
import { z } from "zod";

export const scalarSchema = z.object({
  value: z.string().nullable(),
  sourceText: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1),
});

export const docTypeValues = ["invoice", "receipt", "credit_note", "other"] as const;

export const fieldNames = [
  "vendorName",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "currency",
  "subtotal",
  "tax",
  "shipping",
  "discount",
  "total",
] as const;
export type FieldName = (typeof fieldNames)[number];

export const lineItemSchema = z.object({
  description: scalarSchema,
  quantity: scalarSchema,
  unitPrice: scalarSchema,
  amount: scalarSchema,
});

export const extractionResultSchema = z.object({
  docType: z.object({ value: z.enum(docTypeValues), confidence: z.number().min(0).max(1), reason: z.string() }),
  fields: z.object(Object.fromEntries(fieldNames.map((f) => [f, scalarSchema])) as Record<FieldName, typeof scalarSchema>),
  lineItems: z.array(lineItemSchema),
  notes: z.string().nullable(),
});

export type ExtractedScalar = z.infer<typeof scalarSchema>;
export type ExtractedLineItem = z.infer<typeof lineItemSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const PROMPT_VERSION = "mock-1";
```

```ts
// src/lib/pipeline/extract/ground-truth.ts
import { z } from "zod";
import { docTypeValues, fieldNames } from "./schema";

const gtScalar = z
  .object({
    value: z.string().nullable(),
    display: z.string().nullable().optional(),
    page: z.number().int().positive().optional(),
  })
  .nullable();

export const groundTruthSchema = z.object({
  name: z.string(),
  docType: z.enum(docTypeValues),
  fields: z.object(Object.fromEntries(fieldNames.map((f) => [f, gtScalar])) as Record<(typeof fieldNames)[number], typeof gtScalar>),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.string(),
      unitPrice: z.string(),
      amount: z.string(),
      display: z.object({ quantity: z.string().optional(), unitPrice: z.string().optional(), amount: z.string().optional() }).optional(),
      page: z.number().int().positive().optional(),
    }),
  ),
  expectedIssues: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type GroundTruth = z.infer<typeof groundTruthSchema>;

export const manifestSchema = z.array(
  z.object({
    name: z.string(),
    file: z.string(),
    mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    sha256: z.string().length(64),
    pages: z.number().int().positive(),
    kind: z.enum(["pdf_text", "pdf_scan", "image"]),
  }),
);
export type Manifest = z.infer<typeof manifestSchema>;
```

```ts
// src/lib/pipeline/types.ts
import type { SupportedMime } from "@/lib/files/detect-type";
import type { Document } from "@/lib/repo/documents";
import type { ExtractionResult } from "./extract/schema";

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
};

export type ModelInput = { bytes: Uint8Array; mime: SupportedMime; sha256: string; filename: string };

export interface ModelProvider {
  readonly name: string;
  extract(input: ModelInput): Promise<{ result: ExtractionResult; usage: ModelUsage; raw: unknown }>;
}

export type StageName = "parse" | "extract" | "ground" | "validate" | "reconcile" | "finalise";

export type StageState = { extraction?: ExtractionResult };

export type StageContext = {
  documentId: string;
  workspaceId: string;
  jobId: string;
  document: Document;
  state: StageState;
};

export type StageOutcome = { halt?: boolean; meta?: Record<string, unknown> };

export type Stage = { name: StageName; run(ctx: StageContext): Promise<StageOutcome> };
```

```ts
// src/lib/pipeline/errors.ts
export class StageError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    detail?: string,
  ) {
    super(detail ?? userMessage);
    this.name = "StageError";
  }
}

export function toFailure(err: unknown): { code: string; message: string } {
  if (err instanceof StageError) return { code: err.code, message: err.userMessage };
  return { code: "internal", message: "Processing failed. Try again." };
}
```

- [ ] **Step 6: Write the mock provider and the provider factory**

```ts
// src/lib/pipeline/extract/mock-provider.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelInput, ModelProvider, ModelUsage } from "@/lib/pipeline/types";
import { groundTruthSchema, manifestSchema, type GroundTruth } from "./ground-truth";
import { extractionResultSchema, fieldNames, type ExtractionResult } from "./schema";

export type GroundTruthLookup = (sha256: string) => Promise<GroundTruth | null>;

const SAMPLES_DIR = path.join(process.cwd(), "samples");

/** Default lookup: samples/manifest.json maps sha256 to a ground-truth file. */
export const manifestLookup: GroundTruthLookup = async (sha256) => {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(path.join(SAMPLES_DIR, "manifest.json"), "utf8");
  } catch {
    return null;
  }
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const entry = manifest.find((m) => m.sha256 === sha256);
  if (!entry) return null;
  const gtRaw = await readFile(path.join(SAMPLES_DIR, "ground-truth", `${entry.name}.json`), "utf8");
  return groundTruthSchema.parse(JSON.parse(gtRaw));
};

export function groundTruthToExtraction(gt: GroundTruth): ExtractionResult {
  const fields = Object.fromEntries(
    fieldNames.map((name) => {
      const f = gt.fields[name];
      return [
        name,
        f
          ? { value: f.value, sourceText: f.display ?? f.value, page: f.page ?? 1, confidence: 0.9 }
          : { value: null, sourceText: null, page: null, confidence: 0.9 },
      ];
    }),
  ) as ExtractionResult["fields"];

  const lineItems = gt.lineItems.map((li) => ({
    description: { value: li.description, sourceText: li.description, page: li.page ?? 1, confidence: 0.9 },
    quantity: { value: li.quantity, sourceText: li.display?.quantity ?? li.quantity, page: li.page ?? 1, confidence: 0.9 },
    unitPrice: { value: li.unitPrice, sourceText: li.display?.unitPrice ?? li.unitPrice, page: li.page ?? 1, confidence: 0.9 },
    amount: { value: li.amount, sourceText: li.display?.amount ?? li.amount, page: li.page ?? 1, confidence: 0.9 },
  }));

  return extractionResultSchema.parse({
    docType: {
      value: gt.docType,
      confidence: 0.95,
      reason: gt.docType === "other" ? "This document is not an invoice." : "Sample ground truth.",
    },
    fields,
    lineItems,
    notes: gt.notes ?? null,
  });
}

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  constructor(private readonly lookup: GroundTruthLookup = manifestLookup) {}

  async extract(input: ModelInput) {
    const started = Date.now();
    const gt = await this.lookup(input.sha256);
    const result: ExtractionResult = gt
      ? groundTruthToExtraction(gt)
      : extractionResultSchema.parse({
          docType: {
            value: "other",
            confidence: 1,
            reason: "Mock mode only recognises the bundled sample documents. Set ANTHROPIC_API_KEY to extract your own files.",
          },
          fields: Object.fromEntries(fieldNames.map((f) => [f, { value: null, sourceText: null, page: null, confidence: 1 }])),
          lineItems: [],
          notes: null,
        });
    const usage: ModelUsage = { model: "mock", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: Date.now() - started };
    return { result, usage, raw: { source: gt ? "ground-truth" : "unknown", sha256: input.sha256 } };
  }
}
```

```ts
// src/lib/pipeline/extract/model.ts
import { llmMode } from "@/lib/env";
import type { ModelProvider } from "@/lib/pipeline/types";
import { MockModelProvider } from "./mock-provider";

let override: ModelProvider | null = null;

export function setModelProviderForTests(provider: ModelProvider | null): void {
  override = provider;
}

export function getModelProvider(): ModelProvider {
  if (override) return override;
  if (llmMode === "mock") return new MockModelProvider();
  throw new Error(`LLM_MODE=${llmMode} is not available in this build. Set LLM_MODE=mock.`);
}
```

The live provider arrives in the pipeline plan and replaces the thrown error with the Claude implementation.

- [ ] **Step 7: Write the extraction, usage, and invoice repositories**

```ts
// src/lib/repo/extractions.ts
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { extractions } from "@/lib/db/schema";
import { extractionResultSchema, type ExtractionResult } from "@/lib/pipeline/extract/schema";

export type Extraction = typeof extractions.$inferSelect;

export const extractionsRepo = {
  async record(input: {
    documentId: string;
    kind: "initial" | "reconcile";
    model: string;
    promptVersion: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    latencyMs: number;
    result: ExtractionResult;
    raw: unknown;
  }): Promise<Extraction> {
    const { result, ...rest } = input;
    const [row] = await getDb()
      .insert(extractions)
      .values({ ...rest, raw: { result, providerRaw: input.raw } })
      .returning();
    return row;
  },

  async latest(documentId: string): Promise<{ row: Extraction; result: ExtractionResult } | null> {
    const row = await getDb().query.extractions.findFirst({
      where: eq(extractions.documentId, documentId),
      orderBy: [desc(extractions.createdAt)],
    });
    if (!row) return null;
    const parsed = extractionResultSchema.safeParse((row.raw as { result?: unknown }).result);
    return parsed.success ? { row, result: parsed.data } : null;
  },
};
```

```ts
// src/lib/repo/usage.ts
import { getDb } from "@/lib/db/client";
import { usageLedger } from "@/lib/db/schema";

export const usageRepo = {
  async record(input: {
    workspaceId: string;
    documentId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costMicros: number;
  }): Promise<void> {
    await getDb().insert(usageLedger).values(input);
  },
};
```

```ts
// src/lib/repo/invoices.ts
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invoices, lineItems, type InvoiceFields, type LineItemMeta } from "@/lib/db/schema";

export type Invoice = typeof invoices.$inferSelect;
export type LineItem = typeof lineItems.$inferSelect;

export type UpsertInvoiceInput = {
  documentId: string;
  workspaceId: string;
  docType: Invoice["docType"];
  header: Pick<Invoice, "vendorName" | "vendorKey" | "invoiceNumber" | "issueDate" | "dueDate" | "currency" | "subtotal" | "tax" | "shipping" | "discount" | "total">;
  fields: InvoiceFields;
  lineItems: Array<{ idx: number; description: string | null; quantity: string | null; unitPrice: string | null; amount: string | null; meta: LineItemMeta }>;
};

export const invoicesRepo = {
  async upsertFromExtraction(input: UpsertInvoiceInput): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .insert(invoices)
        .values({
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          docType: input.docType,
          ...input.header,
          fields: input.fields,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: invoices.documentId,
          set: { docType: input.docType, ...input.header, fields: input.fields, updatedAt: new Date() },
        });
      await tx.delete(lineItems).where(eq(lineItems.documentId, input.documentId));
      if (input.lineItems.length > 0) {
        await tx.insert(lineItems).values(input.lineItems.map((li) => ({ ...li, documentId: input.documentId })));
      }
    });
  },

  async getByDocument(workspaceId: string, documentId: string): Promise<{ invoice: Invoice; lineItems: LineItem[] } | null> {
    const db = getDb();
    const invoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.workspaceId, workspaceId), eq(invoices.documentId, documentId)),
    });
    if (!invoice) return null;
    const items = await db.query.lineItems.findMany({ where: eq(lineItems.documentId, documentId), orderBy: (t, { asc }) => [asc(t.idx)] });
    return { invoice, lineItems: items };
  },
};
```

- [ ] **Step 8: Write the extract and finalise stages and the runner**

```ts
// src/lib/pipeline/stages/extract.ts
import { getBlobStore } from "@/lib/blob";
import type { SupportedMime } from "@/lib/files/detect-type";
import { StageError } from "@/lib/pipeline/errors";
import { getModelProvider } from "@/lib/pipeline/extract/model";
import { PROMPT_VERSION } from "@/lib/pipeline/extract/schema";
import type { Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { usageRepo } from "@/lib/repo/usage";

export const extractStage: Stage = {
  name: "extract",
  async run(ctx) {
    const blob = await getBlobStore().get(ctx.document.blobKey);
    if (!blob) throw new StageError("blob_missing", "The stored file could not be read.");

    const provider = getModelProvider();
    const { result, usage, raw } = await provider.extract({
      bytes: blob.bytes,
      mime: ctx.document.mime as SupportedMime,
      sha256: ctx.document.sha256,
      filename: ctx.document.originalFilename,
    });

    await extractionsRepo.record({
      documentId: ctx.documentId,
      kind: "initial",
      model: usage.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      latencyMs: usage.latencyMs,
      result,
      raw,
    });
    await usageRepo.record({
      workspaceId: ctx.workspaceId,
      documentId: ctx.documentId,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costMicros: 0,
    });

    if (result.docType.value === "other") {
      await documentsRepo.update(ctx.documentId, { docType: "other" });
      await documentsRepo.setStatus(ctx.documentId, "rejected", { code: "not_an_invoice", message: result.docType.reason });
      return { halt: true, meta: { docType: "other", reason: result.docType.reason } };
    }

    await documentsRepo.update(ctx.documentId, { docType: result.docType.value });
    ctx.state.extraction = result;
    return { meta: { docType: result.docType.value, lineItems: result.lineItems.length, model: usage.model, latencyMs: usage.latencyMs } };
  },
};
```

```ts
// src/lib/pipeline/stages/finalise.ts
import type { FieldMeta, InvoiceFields, LineItemMeta } from "@/lib/db/schema";
import { parseMoney } from "@/lib/normalize/money";
import { vendorKey } from "@/lib/normalize/vendor";
import { StageError } from "@/lib/pipeline/errors";
import { fieldNames, type ExtractedScalar, type ExtractionResult } from "@/lib/pipeline/extract/schema";
import { computeRisk, criticalityFor } from "@/lib/pipeline/risk";
import type { Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { invoicesRepo } from "@/lib/repo/invoices";

const MONEY_FIELDS = ["subtotal", "tax", "shipping", "discount", "total"] as const;

/** Field metadata before grounding runs: no location, so risk reflects only confidence and criticality. */
export function fieldMetaFrom(path: string, s: ExtractedScalar): FieldMeta {
  return {
    value: s.value,
    sourceText: s.sourceText,
    page: s.page,
    bbox: null,
    groundingScore: 0,
    groundingMethod: "none",
    modelConfidence: s.confidence,
    risk: computeRisk({ groundingScore: 0, blockingIssues: 0, warningIssues: 0, modelConfidence: s.confidence, criticality: criticalityFor(path) }),
    status: "pending",
    correctedAt: null,
  };
}

function money(s: ExtractedScalar): string | null {
  return s.value ? parseMoney(s.value) : null;
}

function isoDate(s: ExtractedScalar): string | null {
  if (!s.value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s.value) ? s.value : null;
}

export function buildInvoice(result: ExtractionResult) {
  const fields: InvoiceFields = {};
  for (const name of fieldNames) fields[name] = fieldMetaFrom(name, result.fields[name]);

  const lineItems = result.lineItems.map((li, idx) => {
    const meta: LineItemMeta = {
      description: fieldMetaFrom(`lineItems.${idx}.description`, li.description),
      quantity: fieldMetaFrom(`lineItems.${idx}.quantity`, li.quantity),
      unitPrice: fieldMetaFrom(`lineItems.${idx}.unitPrice`, li.unitPrice),
      amount: fieldMetaFrom(`lineItems.${idx}.amount`, li.amount),
    };
    return {
      idx,
      description: li.description.value,
      quantity: li.quantity.value ? parseMoney(li.quantity.value)?.replace(/(\.\d{2})$/, "$100") ?? null : null,
      unitPrice: li.unitPrice.value ? parseMoney(li.unitPrice.value)?.replace(/(\.\d{2})$/, "$100") ?? null : null,
      amount: money(li.amount),
      meta,
    };
  });

  const vendorName = result.fields.vendorName.value;
  const header = {
    vendorName,
    vendorKey: vendorName ? vendorKey(vendorName) : null,
    invoiceNumber: result.fields.invoiceNumber.value,
    issueDate: isoDate(result.fields.issueDate),
    dueDate: isoDate(result.fields.dueDate),
    currency: result.fields.currency.value?.toUpperCase() ?? null,
    subtotal: money(result.fields.subtotal),
    tax: money(result.fields.tax),
    shipping: money(result.fields.shipping),
    discount: money(result.fields.discount),
    total: money(result.fields.total),
  };
  // A money value the model returned but we could not parse is a guaranteed review item.
  for (const f of MONEY_FIELDS) {
    if (result.fields[f].value && header[f] === null) fields[f].risk = 1;
  }

  return { header, fields, lineItems };
}

export const finaliseStage: Stage = {
  name: "finalise",
  async run(ctx) {
    const result = ctx.state.extraction ?? (await extractionsRepo.latest(ctx.documentId))?.result;
    if (!result) throw new StageError("no_extraction", "No extraction is available for this document.");
    const docType = result.docType.value === "other" ? "invoice" : result.docType.value;
    const built = buildInvoice(result);
    await invoicesRepo.upsertFromExtraction({
      documentId: ctx.documentId,
      workspaceId: ctx.workspaceId,
      docType,
      header: built.header,
      fields: built.fields,
      lineItems: built.lineItems,
    });
    await documentsRepo.setStatus(ctx.documentId, "needs_review");
    return { meta: { fields: Object.keys(built.fields).length, lineItems: built.lineItems.length } };
  },
};
```

Quantities and unit prices are stored with four decimals; the `replace` above appends two zeros to the two-decimal money string, which is exact for these values.

```ts
// src/lib/pipeline/runner.ts
import { errorMessage, log } from "@/lib/logger";
import { toFailure } from "@/lib/pipeline/errors";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { finaliseStage } from "@/lib/pipeline/stages/finalise";
import type { Stage, StageContext } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo, type Job } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

export const STAGES: Stage[] = [extractStage, finaliseStage];

export async function runJob(job: Job, stages: Stage[] = STAGES): Promise<void> {
  if (!job.documentId) {
    await jobsRepo.complete(job.id);
    return;
  }
  const document = await documentsRepo.getByIdUnscoped(job.documentId);
  if (!document) {
    await jobsRepo.complete(job.id);
    return;
  }
  await documentsRepo.setStatus(document.id, "processing");
  const ctx: StageContext = { documentId: document.id, workspaceId: document.workspaceId, jobId: job.id, document, state: {} };

  try {
    for (const stage of stages) {
      if (await pipelineRunsRepo.hasSucceeded(document.id, stage.name)) continue;
      const run = await pipelineRunsRepo.start(document.id, stage.name, job.id);
      try {
        const out = await stage.run(ctx);
        await pipelineRunsRepo.finish(run.id, "succeeded", out.meta ?? {});
        if (out.halt) break;
      } catch (err) {
        await pipelineRunsRepo.finish(run.id, "failed", {}, errorMessage(err));
        throw err;
      }
    }
    await jobsRepo.complete(job.id);
    log.info("job.succeeded", { jobId: job.id, documentId: document.id });
  } catch (err) {
    const failed = await jobsRepo.fail(job.id, errorMessage(err));
    const failure = toFailure(err);
    if (failed?.status === "dead") {
      await documentsRepo.setStatus(document.id, "failed", failure);
      log.error("job.dead", { jobId: job.id, documentId: document.id, error: errorMessage(err) });
    } else {
      await documentsRepo.setStatus(document.id, "queued");
      log.warn("job.retry", { jobId: job.id, documentId: document.id, attempts: failed?.attempts, error: errorMessage(err) });
    }
  }
}
```

- [ ] **Step 9: Write the integration test for the mock pipeline**

```ts
// tests/integration/pipeline-mock.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { getDb } from "@/lib/db/client";
import { sha256Hex } from "@/lib/files/hash";
import { MockModelProvider } from "@/lib/pipeline/extract/mock-provider";
import { setModelProviderForTests } from "@/lib/pipeline/extract/model";
import type { GroundTruth } from "@/lib/pipeline/extract/ground-truth";
import { runJob } from "@/lib/pipeline/runner";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake invoice bytes");
const sha = sha256Hex(pdfBytes);

const gt: GroundTruth = {
  name: "test-invoice",
  docType: "invoice",
  fields: {
    vendorName: { value: "Halcyon Cloud Services Inc.", page: 1 },
    invoiceNumber: { value: "HCS-2026-0417", page: 1 },
    issueDate: { value: "2026-08-03", display: "Aug 3, 2026", page: 1 },
    dueDate: { value: "2026-09-02", display: "Sep 2, 2026", page: 1 },
    currency: { value: "USD", page: 1 },
    subtotal: { value: "1630.00", display: "1,630.00", page: 1 },
    tax: { value: "134.48", display: "134.48", page: 1 },
    shipping: null,
    discount: null,
    total: { value: "1764.48", display: "1,764.48", page: 1 },
  },
  lineItems: [
    { description: "Pro plan, August 2026", quantity: "1", unitPrice: "1200.00", amount: "1200.00", display: { unitPrice: "1,200.00", amount: "1,200.00" } },
    { description: "Additional seats", quantity: "4", unitPrice: "45.00", amount: "180.00" },
    { description: "Priority support", quantity: "1", unitPrice: "250.00", amount: "250.00" },
  ],
  expectedIssues: [],
};

async function seed(kind: "invoice" | "other") {
  const { info } = await startGuestSession();
  const blobKey = `${info.workspaceId}/${sha}.pdf`;
  await getBlobStore().put(blobKey, pdfBytes, "application/pdf");
  const doc = await documentsRepo.create({
    workspaceId: info.workspaceId,
    originalFilename: "test.pdf",
    mime: "application/pdf",
    byteSize: pdfBytes.length,
    sha256: sha,
    blobKey,
  });
  const job = await jobsRepo.enqueue({ workspaceId: info.workspaceId, documentId: doc.id, kind: "process_document" });
  setModelProviderForTests(new MockModelProvider(async () => ({ ...gt, docType: kind })));
  return { info, doc, job };
}

afterEach(() => setModelProviderForTests(null));

describe("mock pipeline", () => {
  it("extracts, finalises, and is idempotent on re-run", async () => {
    const { info, doc, job } = await seed("invoice");
    await runJob(job);
    expect((await documentsRepo.getByIdUnscoped(doc.id))?.status).toBe("needs_review");
    const stored = await invoicesRepo.getByDocument(info.workspaceId, doc.id);
    expect(stored?.invoice.total).toBe("1764.48");
    expect(stored?.invoice.vendorKey).toBe("halcyon cloud services");
    expect(stored?.lineItems).toHaveLength(3);
    expect(stored?.lineItems[1].quantity).toBe("4.0000");
    expect(stored?.invoice.fields.total.groundingMethod).toBe("none");
    expect((await jobsRepo.getById(job.id))?.status).toBe("succeeded");

    const runsBefore = (await pipelineRunsRepo.listByDocument(doc.id)).length;
    await jobsRepo.requeue(job.id);
    await runJob((await jobsRepo.getById(job.id))!);
    expect((await pipelineRunsRepo.listByDocument(doc.id)).length).toBe(runsBefore);
    expect((await documentsRepo.getByIdUnscoped(doc.id))?.status).toBe("needs_review");
  });

  it("rejects documents the model classifies as not an invoice", async () => {
    const { doc, job } = await seed("other");
    await runJob(job);
    const after = await documentsRepo.getByIdUnscoped(doc.id);
    expect(after?.status).toBe("rejected");
    expect(after?.failureCode).toBe("not_an_invoice");
    const stages = (await pipelineRunsRepo.listByDocument(doc.id)).map((r) => r.stage);
    expect(stages).toEqual(["extract"]);
  });

  it("retries a failing stage and marks the document failed when attempts run out", async () => {
    const { doc, job } = await seed("invoice");
    setModelProviderForTests({
      name: "boom",
      extract: async () => {
        throw new Error("model exploded");
      },
    });
    for (let i = 0; i < 3; i++) {
      await getDb().execute(sql`update jobs set run_after = now() - interval '1 second' where id = ${job.id}`);
      const { claimJobs } = await import("@/lib/queue/claim");
      const [claimed] = await claimJobs({ runnerId: "t", limit: 1, perWorkspace: 5, global: 5 });
      await runJob(claimed);
    }
    expect((await jobsRepo.getById(job.id))?.status).toBe("dead");
    const after = await documentsRepo.getByIdUnscoped(doc.id);
    expect(after?.status).toBe("failed");
    expect(after?.failureMessage).toBe("Processing failed. Try again.");
  });
});
```

- [ ] **Step 10: Run the integration test**

Run: `pnpm test:integration -- pipeline-mock`
Expected: 3 passed.

- [ ] **Step 11: Append decisions entries and commit**

Append to `decisions.md`:

```markdown
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
```

```bash
git add -A
git commit -m "feat: pipeline runner with mock model, risk, normalisers, extract and finalise stages"
```

---

### Task 10: Sample generator and ground truth

**Files:**
- Create: `samples/templates/clean-digital.html`, `samples/templates/mismatch-total.html`, `samples/templates/not-an-invoice.html`, `samples/ground-truth/clean-digital.json`, `samples/ground-truth/mismatch-total.json`, `samples/ground-truth/not-an-invoice.json`, `samples/generate.ts`
- Generated and committed: `samples/out/*.pdf`, `samples/manifest.json`
- Test: `tests/unit/samples-manifest.test.ts`

**Interfaces:**
- Consumes: `groundTruthSchema`, `manifestSchema`, `sha256Hex`.
- Produces: `samples/manifest.json` entries `{ name, file, mime, sha256, pages, kind }` used by the mock provider and the samples route. The remaining five samples from spec 19 are added in the pipeline plan alongside OCR.

- [ ] **Step 1: Install the Chromium used to render PDFs**

```bash
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write the templates**

Shared styling sits at the top of each file so every template is self-contained.

```html
<!-- samples/templates/clean-digital.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice HCS-2026-0417</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #111; margin: 48px; font-size: 12px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.5px; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .muted { color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ddd; }
  th { font-size: 11px; text-transform: uppercase; color: #666; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; width: 260px; margin-top: 16px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 6px; }
  .totals .grand { font-weight: bold; border-top: 2px solid #111; font-size: 14px; }
  .footer { margin-top: 40px; color: #666; font-size: 11px; }
</style></head>
<body>
  <div class="row">
    <div>
      <h1>Halcyon Cloud Services Inc.</h1>
      <div class="muted">1200 Harbor Blvd, Suite 400<br>Seattle, WA 98101, United States<br>billing@halcyoncloud.example</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:bold">INVOICE</div>
      <div>Invoice number: <strong>HCS-2026-0417</strong></div>
      <div>Issue date: Aug 3, 2026</div>
      <div>Due date: Sep 2, 2026</div>
      <div>Currency: USD</div>
    </div>
  </div>
  <div style="margin-top:28px">
    <div class="muted">Bill to</div>
    <div><strong>Northgate Robotics Pvt. Ltd.</strong><br>14 Residency Road, Bengaluru 560025, India</div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td>Pro plan, August 2026</td><td class="num">1</td><td class="num">1,200.00</td><td class="num">1,200.00</td></tr>
      <tr><td>Additional seats</td><td class="num">4</td><td class="num">45.00</td><td class="num">180.00</td></tr>
      <tr><td>Priority support</td><td class="num">1</td><td class="num">250.00</td><td class="num">250.00</td></tr>
    </tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>1,630.00</span></div>
    <div><span>Sales tax (8.25%)</span><span>134.48</span></div>
    <div class="grand"><span>Total due</span><span>USD 1,764.48</span></div>
  </div>
  <div class="footer">Payment terms: Net 30. Please reference the invoice number with your payment. Thank you for your business.</div>
</body></html>
```

```html
<!-- samples/templates/mismatch-total.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice MOS/INV/88213</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #222; margin: 56px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0; }
  .band { background: #f0ede6; padding: 12px 16px; margin: 20px 0; display: flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 6px; border-bottom: 1px solid #ccc; text-align: left; }
  td.num, th.num { text-align: right; }
  .totals { width: 280px; margin-left: auto; margin-top: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 6px; }
  .totals .grand { font-weight: bold; border-top: 1px solid #222; }
  .note { margin-top: 36px; font-size: 11px; color: #555; }
</style></head>
<body>
  <h1>Meridian Office Supplies Ltd.</h1>
  <div>Unit 7, Riverside Industrial Estate, Manchester M17 1AB, United Kingdom</div>
  <div class="band">
    <div><strong>Tax invoice</strong><br>No. MOS/INV/88213</div>
    <div>Invoice date: 21/07/2026<br>Payment due: 20/08/2026</div>
    <div>Customer: Brightwater Dental Group<br>Account: BW-2231</div>
  </div>
  <table>
    <thead><tr><th>Item</th><th class="num">Quantity</th><th class="num">Unit price (USD)</th><th class="num">Line total</th></tr></thead>
    <tbody>
      <tr><td>Copier paper A4, 80gsm, box of 5 reams</td><td class="num">12</td><td class="num">38.50</td><td class="num">462.00</td></tr>
      <tr><td>Toner cartridge TN-2420</td><td class="num">3</td><td class="num">89.00</td><td class="num">267.00</td></tr>
      <tr><td>Delivery</td><td class="num">1</td><td class="num">25.00</td><td class="num">25.00</td></tr>
    </tbody>
  </table>
  <div class="totals">
    <div><span>Net amount</span><span>754.00</span></div>
    <div><span>VAT 5%</span><span>37.70</span></div>
    <div class="grand"><span>Amount payable</span><span>719.70</span></div>
  </div>
  <div class="note">All amounts in USD. Bank transfer to Meridian Office Supplies Ltd, sort code 40-11-22, account 31456789. Queries: accounts@meridianoffice.example</div>
</body></html>
```

The printed total 719.70 is a digit transposition of the correct 791.70. Validation must flag it and suggest the swap.

```html
<!-- samples/templates/not-an-invoice.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Account statement</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #111; margin: 48px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 6px; border-bottom: 1px solid #ddd; text-align: left; }
  td.num, th.num { text-align: right; }
</style></head>
<body>
  <h1>First Meridian Bank</h1>
  <div>Account statement for period 01 Aug 2026 to 31 Aug 2026</div>
  <div>Account holder: Northgate Robotics Pvt. Ltd. &nbsp; Account number: ****4471</div>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
    <tbody>
      <tr><td>01 Aug 2026</td><td>Opening balance</td><td class="num"></td><td class="num"></td><td class="num">48,210.55</td></tr>
      <tr><td>04 Aug 2026</td><td>Halcyon Cloud Services</td><td class="num">1,764.48</td><td class="num"></td><td class="num">46,446.07</td></tr>
      <tr><td>12 Aug 2026</td><td>Customer payment, Invoice 2231</td><td class="num"></td><td class="num">12,500.00</td><td class="num">58,946.07</td></tr>
      <tr><td>19 Aug 2026</td><td>Payroll</td><td class="num">22,300.00</td><td class="num"></td><td class="num">36,646.07</td></tr>
      <tr><td>31 Aug 2026</td><td>Closing balance</td><td class="num"></td><td class="num"></td><td class="num">36,646.07</td></tr>
    </tbody>
  </table>
  <p>This statement is issued for information. It is not a request for payment.</p>
</body></html>
```

- [ ] **Step 3: Write the ground truth files**

```json
// samples/ground-truth/clean-digital.json
{
  "name": "clean-digital",
  "docType": "invoice",
  "fields": {
    "vendorName": { "value": "Halcyon Cloud Services Inc.", "page": 1 },
    "invoiceNumber": { "value": "HCS-2026-0417", "page": 1 },
    "issueDate": { "value": "2026-08-03", "display": "Aug 3, 2026", "page": 1 },
    "dueDate": { "value": "2026-09-02", "display": "Sep 2, 2026", "page": 1 },
    "currency": { "value": "USD", "page": 1 },
    "subtotal": { "value": "1630.00", "display": "1,630.00", "page": 1 },
    "tax": { "value": "134.48", "display": "134.48", "page": 1 },
    "shipping": null,
    "discount": null,
    "total": { "value": "1764.48", "display": "1,764.48", "page": 1 }
  },
  "lineItems": [
    { "description": "Pro plan, August 2026", "quantity": "1", "unitPrice": "1200.00", "amount": "1200.00", "display": { "unitPrice": "1,200.00", "amount": "1,200.00" } },
    { "description": "Additional seats", "quantity": "4", "unitPrice": "45.00", "amount": "180.00" },
    { "description": "Priority support", "quantity": "1", "unitPrice": "250.00", "amount": "250.00" }
  ],
  "expectedIssues": []
}
```

```json
// samples/ground-truth/mismatch-total.json
{
  "name": "mismatch-total",
  "docType": "invoice",
  "fields": {
    "vendorName": { "value": "Meridian Office Supplies Ltd.", "page": 1 },
    "invoiceNumber": { "value": "MOS/INV/88213", "page": 1 },
    "issueDate": { "value": "2026-07-21", "display": "21/07/2026", "page": 1 },
    "dueDate": { "value": "2026-08-20", "display": "20/08/2026", "page": 1 },
    "currency": { "value": "USD", "page": 1 },
    "subtotal": { "value": "754.00", "display": "754.00", "page": 1 },
    "tax": { "value": "37.70", "display": "37.70", "page": 1 },
    "shipping": null,
    "discount": null,
    "total": { "value": "719.70", "display": "719.70", "page": 1 }
  },
  "lineItems": [
    { "description": "Copier paper A4, 80gsm, box of 5 reams", "quantity": "12", "unitPrice": "38.50", "amount": "462.00" },
    { "description": "Toner cartridge TN-2420", "quantity": "3", "unitPrice": "89.00", "amount": "267.00" },
    { "description": "Delivery", "quantity": "1", "unitPrice": "25.00", "amount": "25.00" }
  ],
  "expectedIssues": ["V003"],
  "notes": "Printed total is a digit transposition of 791.70."
}
```

```json
// samples/ground-truth/not-an-invoice.json
{
  "name": "not-an-invoice",
  "docType": "other",
  "fields": {
    "vendorName": null, "invoiceNumber": null, "issueDate": null, "dueDate": null, "currency": null,
    "subtotal": null, "tax": null, "shipping": null, "discount": null, "total": null
  },
  "lineItems": [],
  "expectedIssues": ["V011"],
  "notes": "Bank statement page."
}
```

- [ ] **Step 4: Write the generator**

```ts
// samples/generate.ts
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { groundTruthSchema, type Manifest } from "../src/lib/pipeline/extract/ground-truth";
import { sha256Hex } from "../src/lib/files/hash";

const ROOT = path.resolve("samples");
const TEMPLATES = path.join(ROOT, "templates");
const OUT = path.join(ROOT, "out");
const GT = path.join(ROOT, "ground-truth");

async function renderPdf(html: string): Promise<Uint8Array> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}

/** Pins metadata so re-rendering unchanged HTML yields byte-identical files where Chromium allows it. */
async function normalise(bytes: Uint8Array): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fixed = new Date("2026-01-01T00:00:00Z");
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  doc.setProducer("Vouch samples");
  doc.setCreator("Vouch samples");
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, pages: doc.getPageCount() };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest: Manifest = [];
  const templates = (await readdir(TEMPLATES)).filter((f) => f.endsWith(".html")).sort();
  for (const file of templates) {
    const name = file.replace(/\.html$/, "");
    const gtRaw = await readFile(path.join(GT, `${name}.json`), "utf8");
    groundTruthSchema.parse(JSON.parse(gtRaw));
    const html = await readFile(path.join(TEMPLATES, file), "utf8");
    const { bytes, pages } = await normalise(await renderPdf(html));
    const outName = `${name}.pdf`;
    await writeFile(path.join(OUT, outName), bytes);
    manifest.push({ name, file: outName, mime: "application/pdf", sha256: sha256Hex(bytes), pages, kind: "pdf_text" });
    console.log(`rendered ${outName} (${pages} page${pages === 1 ? "" : "s"}, ${bytes.length} bytes)`);
  }
  await writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${manifest.length} samples`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Write the manifest test**

```ts
// tests/unit/samples-manifest.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/files/hash";
import { groundTruthSchema, manifestSchema } from "@/lib/pipeline/extract/ground-truth";

const root = path.resolve("samples");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")));

describe("samples manifest", () => {
  it("lists at least the three foundation samples", () => {
    const names = manifest.map((m) => m.name);
    for (const n of ["clean-digital", "mismatch-total", "not-an-invoice"]) expect(names).toContain(n);
  });
  for (const entry of manifest) {
    it(`${entry.name}: file hash matches and ground truth parses`, () => {
      const bytes = readFileSync(path.join(root, "out", entry.file));
      expect(sha256Hex(new Uint8Array(bytes))).toBe(entry.sha256);
      const gt = groundTruthSchema.parse(JSON.parse(readFileSync(path.join(root, "ground-truth", `${entry.name}.json`), "utf8")));
      expect(gt.name).toBe(entry.name);
    });
  }
});
```

- [ ] **Step 6: Generate, test, and commit**

```bash
pnpm samples:generate
pnpm test:unit -- samples-manifest
```

Expected: three PDFs in `samples/out/`, a `manifest.json`, and the test passes. Open a PDF to eyeball it. Commit the outputs together with the manifest; they must always change together.

```bash
git add -A
git commit -m "feat: sample invoice generator with ground truth and manifest"
```

---

### Task 11: API routes: upload, list, detail, delete, retry, file, status, samples, workspace, health

**Files:**
- Create: `src/lib/api/respond.ts`, `src/lib/api/same-origin.ts`, `src/lib/api/documents.ts`, `src/lib/pipeline/ingest.ts`, `src/lib/queue/drain.ts`, `src/app/api/documents/route.ts`, `src/app/api/documents/[id]/route.ts`, `src/app/api/documents/[id]/file/route.ts`, `src/app/api/documents/[id]/retry/route.ts`, `src/app/api/workspace/status/route.ts`, `src/app/api/workspace/samples/route.ts`, `src/app/api/workspace/route.ts`, `src/app/api/health/route.ts`
- Modify: `next.config.ts`, `src/lib/auth/session.ts` (add `requireSessionFor(request)`)
- Test: `tests/integration/api-documents.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `handle(fn)` route wrapper, `json(data, status?)`, `assertSameOrigin(request)`, `requireSessionFor(request)`, `summarise(doc)`, `listSummaries(workspaceId)`, `DocumentSummary`, `ingestFile(input): Promise<IngestOutcome>`, `drain({ runnerId, reason })`, `scheduleDrain(reason)`, JSON shapes `DocumentSummary`, `DocumentDetail`, `WorkspaceStatus`, `IngestOutcome`, `LIMITS`.

- [ ] **Step 1: Write the failing API test**

```ts
// tests/integration/api-documents.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { drain } from "@/lib/queue/drain";
import { GET as listDocuments, POST as upload } from "@/app/api/documents/route";
import { GET as detail } from "@/app/api/documents/[id]/route";
import { POST as loadSamples } from "@/app/api/workspace/samples/route";
import { GET as status } from "@/app/api/workspace/status/route";

process.env.VOUCH_DISABLE_AUTO_DRAIN = "true";

let cookie: string;
beforeAll(async () => {
  const { headers } = await startGuestSession();
  cookie = headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
});

const base = "http://localhost:3000";
const sameOrigin = { cookie: "", origin: base, "sec-fetch-site": "same-origin" };

function req(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers({ ...sameOrigin, cookie, ...(init.headers as Record<string, string>) });
  return new Request(base + pathname, { ...init, headers });
}

describe("documents API", () => {
  it("rejects an upload without a session", async () => {
    const form = new FormData();
    form.set("files", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "a.pdf", { type: "application/pdf" }));
    const res = await upload(new Request(base + "/api/documents", { method: "POST", body: form, headers: { origin: base } }));
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin mutations", async () => {
    const res = await upload(req("/api/documents", { method: "POST", body: new FormData(), headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("accepts a PDF, rejects a fake, and reports duplicates", async () => {
    const pdf = readFileSync(path.resolve("samples/out/clean-digital.pdf"));
    const form = new FormData();
    form.append("files", new File([pdf], "clean.pdf", { type: "application/pdf" }));
    form.append("files", new File([new TextEncoder().encode("not a pdf at all")], "fake.pdf", { type: "application/pdf" }));
    const res = await upload(req("/api/documents", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ kind: string; code?: string; document?: { id: string } }> };
    expect(body.results[0].kind).toBe("accepted");
    expect(body.results[1].kind).toBe("rejected");
    expect(body.results[1].code).toBe("unsupported_type");

    const dupForm = new FormData();
    dupForm.append("files", new File([pdf], "clean-again.pdf", { type: "application/pdf" }));
    const dup = await upload(req("/api/documents", { method: "POST", body: dupForm }));
    const dupBody = (await dup.json()) as { results: Array<{ kind: string; existingId?: string }> };
    expect(dupBody.results[0].kind).toBe("duplicate");
    expect(dupBody.results[0].existingId).toBe(body.results[0].document!.id);

    await drain({ runnerId: "test", reason: "test" });
    const detailRes = await detail(req(`/api/documents/${body.results[0].document!.id}`), {
      params: Promise.resolve({ id: body.results[0].document!.id }),
    });
    const detailBody = (await detailRes.json()) as { document: { status: string }; invoice: { total: string } | null; trace: unknown[] };
    expect(detailBody.document.status).toBe("needs_review");
    expect(detailBody.invoice?.total).toBe("1764.48");
    expect(detailBody.trace.length).toBeGreaterThan(0);
  });

  it("loads samples once and reports status counts", async () => {
    const first = await loadSamples(req("/api/workspace/samples", { method: "POST" }));
    expect(first.status).toBe(200);
    const second = await loadSamples(req("/api/workspace/samples", { method: "POST" }));
    const secondBody = (await second.json()) as { results: Array<{ kind: string }> };
    expect(secondBody.results.every((r) => r.kind === "duplicate")).toBe(true);
    await drain({ runnerId: "test", reason: "test" });
    const st = await status(req("/api/workspace/status"));
    const stBody = (await st.json()) as { counts: Record<string, number>; inFlight: unknown[] };
    expect(stBody.counts.needs_review).toBeGreaterThanOrEqual(2);
    expect(stBody.counts.rejected).toBeGreaterThanOrEqual(1);
    const list = await listDocuments(req("/api/documents"));
    const listBody = (await list.json()) as { documents: Array<{ status: string }> };
    expect(listBody.documents.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- api-documents`
Expected: FAIL, missing route modules.

- [ ] **Step 3: Write the API helpers and extend the session module**

```ts
// src/lib/api/respond.ts
import { ZodError } from "zod";
import { ApiError } from "./errors";
import { errorMessage, log } from "@/lib/logger";

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** Wraps a route handler so thrown errors become consistent JSON responses. */
export function handle<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
      }
      if (err instanceof ZodError) {
        return json({ error: { code: "invalid_request", message: "The request was not valid.", details: err.issues } }, 400);
      }
      const id = crypto.randomUUID();
      log.error("request.failed", { id, url: request.url, error: errorMessage(err) });
      return json({ error: { code: "internal", message: `Something went wrong. Reference ${id}.` } }, 500);
    }
  };
}
```

```ts
// src/lib/api/same-origin.ts
import { forbidden } from "./errors";

/** Blocks cross-site mutations. Same-origin fetches send sec-fetch-site: same-origin; tests and curl send none. */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden();
  const origin = request.headers.get("origin");
  if (origin) {
    const expected = new URL(request.url).host;
    let actual: string;
    try {
      actual = new URL(origin).host;
    } catch {
      throw forbidden();
    }
    if (actual !== expected) throw forbidden();
  }
}
```

Add to `src/lib/auth/session.ts`:

```ts
export async function requireSessionFor(request: Request): Promise<SessionInfo> {
  const info = await sessionFromHeaders(request.headers);
  if (!info) throw unauthorized();
  return info;
}
```

- [ ] **Step 4: Write ingest and drain**

```ts
// src/lib/pipeline/ingest.ts
import { getBlobStore } from "@/lib/blob";
import { detectFileType, extensionFor } from "@/lib/files/detect-type";
import { sha256Hex } from "@/lib/files/hash";
import { sanitizeFilename } from "@/lib/files/sanitize";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo, type Document } from "@/lib/repo/documents";
import { jobsRepo, type Job } from "@/lib/repo/jobs";

export const LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxFilesPerRequest: 5,
  maxDocumentsPerWorkspace: 25,
} as const;

export type IngestOutcome =
  | { kind: "accepted"; filename: string; document: Document; job: Job }
  | { kind: "duplicate"; filename: string; existingId: string }
  | { kind: "rejected"; filename: string; code: "too_large" | "unsupported_type" | "workspace_full" | "empty"; message: string };

export async function ingestFile(input: {
  workspaceId: string;
  actorSessionId: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<IngestOutcome> {
  const filename = sanitizeFilename(input.filename);
  if (input.bytes.length === 0) return { kind: "rejected", filename, code: "empty", message: "The file is empty." };
  if (input.bytes.length > LIMITS.maxFileBytes) {
    return { kind: "rejected", filename, code: "too_large", message: "Files must be 10 MB or smaller." };
  }
  const mime = detectFileType(input.bytes);
  if (!mime) {
    return { kind: "rejected", filename, code: "unsupported_type", message: "Only PDF, PNG and JPEG files are supported." };
  }
  const sha256 = sha256Hex(input.bytes);
  const existing = await documentsRepo.findBySha(input.workspaceId, sha256);
  if (existing) return { kind: "duplicate", filename, existingId: existing.id };

  const count = await documentsRepo.countByWorkspace(input.workspaceId);
  if (count >= LIMITS.maxDocumentsPerWorkspace) {
    return { kind: "rejected", filename, code: "workspace_full", message: "This workspace holds 25 documents. Delete some to add more." };
  }

  const blobKey = `${input.workspaceId}/${sha256}.${extensionFor(mime)}`;
  await getBlobStore().put(blobKey, input.bytes, mime);
  const document = await documentsRepo.create({
    workspaceId: input.workspaceId,
    originalFilename: filename,
    mime,
    byteSize: input.bytes.length,
    sha256,
    blobKey,
    kind: mime === "application/pdf" ? "unknown" : "image",
  });
  const job = await jobsRepo.enqueue({ workspaceId: input.workspaceId, documentId: document.id, kind: "process_document" });
  await auditRepo.log({
    workspaceId: input.workspaceId,
    actorSessionId: input.actorSessionId,
    action: "document.uploaded",
    targetType: "document",
    targetId: document.id,
    meta: { filename, mime, byteSize: input.bytes.length },
  });
  return { kind: "accepted", filename, document, job };
}
```

```ts
// src/lib/queue/drain.ts
import { after } from "next/server";
import { errorMessage, log } from "@/lib/logger";
import { runJob } from "@/lib/pipeline/runner";
import { JOB_LIMITS, claimJobs, sweepStale } from "@/lib/queue/claim";

const DEADLINE_MS = 240_000;

export async function drain(opts: { runnerId: string; reason: string }): Promise<{ claimed: number; swept: number }> {
  const started = Date.now();
  const swept = await sweepStale(JOB_LIMITS.staleMs);
  let claimed = 0;
  while (Date.now() - started < DEADLINE_MS) {
    const jobs = await claimJobs({ runnerId: opts.runnerId, limit: 1, perWorkspace: JOB_LIMITS.perWorkspace, global: JOB_LIMITS.global });
    if (jobs.length === 0) break;
    claimed += jobs.length;
    for (const job of jobs) await runJob(job);
  }
  log.info("drain.done", { reason: opts.reason, claimed, swept, ms: Date.now() - started });
  return { claimed, swept };
}

/**
 * Runs a drain after the current response. Inside a Next request this uses after();
 * outside one (tests, scripts) it runs in the background unless auto-drain is disabled.
 */
export function scheduleDrain(reason: string): void {
  if (process.env.VOUCH_DISABLE_AUTO_DRAIN === "true") return;
  const run = () => drain({ runnerId: `${reason}:${crypto.randomUUID().slice(0, 8)}`, reason }).catch((err) => log.error("drain.failed", { reason, error: errorMessage(err) }));
  try {
    after(run);
  } catch {
    void run();
  }
}
```

- [ ] **Step 5: Write the routes**

```ts
// src/lib/api/documents.ts
import { documentsRepo, type Document } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";

export type DocumentSummary = {
  id: string;
  filename: string;
  status: Document["status"];
  kind: Document["kind"];
  docType: Document["docType"];
  pageCount: number | null;
  byteSize: number;
  createdAt: string;
  failureCode: string | null;
  failureMessage: string | null;
  attempts: number | null;
};

/** JSON shape of a document for lists and detail. Lives outside the route module because Next only allows handler exports there. */
export async function summarise(doc: Document): Promise<DocumentSummary> {
  const job = await jobsRepo.latestForDocument(doc.id);
  return {
    id: doc.id,
    filename: doc.originalFilename,
    status: doc.status,
    kind: doc.kind,
    docType: doc.docType,
    pageCount: doc.pageCount,
    byteSize: doc.byteSize,
    createdAt: doc.createdAt.toISOString(),
    failureCode: doc.failureCode,
    failureMessage: doc.failureMessage,
    attempts: job?.attempts ?? null,
  };
}

export async function listSummaries(workspaceId: string): Promise<DocumentSummary[]> {
  const docs = await documentsRepo.listByWorkspace(workspaceId);
  return Promise.all(docs.map(summarise));
}
```

```ts
// src/app/api/documents/route.ts
import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { ApiError } from "@/lib/api/errors";
import { listSummaries, summarise, type DocumentSummary } from "@/lib/api/documents";
import { requireSessionFor } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { ingestFile, LIMITS, type IngestOutcome } from "@/lib/pipeline/ingest";
import { scheduleDrain } from "@/lib/queue/drain";

export const maxDuration = 300;

export const GET = handle(async (request) => {
  const session = await requireSessionFor(request);
  return json({ documents: await listSummaries(session.workspaceId) });
});

export const POST = handle(async (request) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  if (!env.UPLOADS_ENABLED) throw new ApiError(503, "uploads_disabled", "Uploads are paused right now. Try again later.");

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "no_files", "Choose at least one file.");
  if (files.length > LIMITS.maxFilesPerRequest) throw new ApiError(400, "too_many_files", "Upload at most 5 files at a time.");

  const results: Array<IngestOutcome | { kind: "accepted"; filename: string; document: DocumentSummary }> = [];
  for (const file of files) {
    const outcome = await ingestFile({
      workspaceId: session.workspaceId,
      actorSessionId: session.sessionId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    results.push(outcome.kind === "accepted" ? { kind: "accepted", filename: outcome.filename, document: await summarise(outcome.document) } : outcome);
  }
  if (results.some((r) => r.kind === "accepted")) scheduleDrain("upload");
  return json({ results });
});
```

```ts
// src/app/api/documents/[id]/route.ts
import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { summarise } from "@/lib/api/documents";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (request, { params }) => {
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  const stored = await invoicesRepo.getByDocument(session.workspaceId, id);
  const trace = await pipelineRunsRepo.listByDocument(id);
  return json({
    document: await summarise(doc),
    invoice: stored?.invoice ?? null,
    lineItems: stored?.lineItems ?? [],
    issues: [],
    trace: trace.map((r) => ({ stage: r.stage, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, durationMs: r.durationMs, error: r.error, meta: r.meta })),
  });
});

export const DELETE = handle<Ctx>(async (request, { params }) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  await getBlobStore().delete(doc.blobKey);
  await documentsRepo.delete(session.workspaceId, id);
  await auditRepo.log({ workspaceId: session.workspaceId, actorSessionId: session.sessionId, action: "document.deleted", targetType: "document", targetId: id });
  return json({ ok: true });
});
```

```ts
// src/app/api/documents/[id]/file/route.ts
import { handle } from "@/lib/api/respond";
import { notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { documentsRepo } from "@/lib/repo/documents";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (request, { params }) => {
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  const blob = await getBlobStore().get(doc.blobKey);
  if (!blob) throw notFound("File");
  const safeName = doc.originalFilename.replace(/["\r\n]/g, "");
  return new Response(blob.bytes, {
    headers: {
      "content-type": blob.contentType,
      "content-length": String(blob.bytes.byteLength),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
```

```ts
// src/app/api/documents/[id]/retry/route.ts
import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { ApiError, notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { scheduleDrain } from "@/lib/queue/drain";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (request, { params }) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  if (doc.status !== "failed" && doc.status !== "rejected") {
    throw new ApiError(409, "not_retryable", "Only failed or rejected documents can be retried.");
  }
  const job = await jobsRepo.latestForDocument(id);
  if (job) await jobsRepo.requeue(job.id);
  else await jobsRepo.enqueue({ workspaceId: session.workspaceId, documentId: id, kind: "process_document" });
  await documentsRepo.setStatus(id, "queued");
  scheduleDrain("retry");
  return json({ ok: true });
});
```

```ts
// src/app/api/workspace/status/route.ts
import { json, handle } from "@/lib/api/respond";
import { requireSessionFor } from "@/lib/auth/session";
import { scheduleDrain } from "@/lib/queue/drain";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";

export const maxDuration = 300;

export type WorkspaceStatus = {
  counts: Record<string, number>;
  inFlight: Array<{ id: string; filename: string; status: string }>;
  queuedJobs: number;
};

export const GET = handle(async (request) => {
  const session = await requireSessionFor(request);
  const docs = await documentsRepo.listByWorkspace(session.workspaceId);
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.status] = (counts[d.status] ?? 0) + 1;
  const inFlight = docs.filter((d) => d.status === "queued" || d.status === "processing").map((d) => ({ id: d.id, filename: d.originalFilename, status: d.status }));
  const queuedJobs = await jobsRepo.countQueued();
  if (queuedJobs > 0 || inFlight.length > 0) scheduleDrain("status-poll");
  const body: WorkspaceStatus = { counts, inFlight, queuedJobs };
  return json(body);
});
```

```ts
// src/app/api/workspace/samples/route.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { requireSessionFor } from "@/lib/auth/session";
import { manifestSchema } from "@/lib/pipeline/extract/ground-truth";
import { ingestFile, type IngestOutcome } from "@/lib/pipeline/ingest";
import { scheduleDrain } from "@/lib/queue/drain";

export const maxDuration = 300;

const SAMPLES = path.join(process.cwd(), "samples");

export const POST = handle(async (request) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(SAMPLES, "manifest.json"), "utf8")));
  const results: IngestOutcome[] = [];
  for (const entry of manifest) {
    const bytes = new Uint8Array(await readFile(path.join(SAMPLES, "out", entry.file)));
    results.push(await ingestFile({ workspaceId: session.workspaceId, actorSessionId: session.sessionId, filename: entry.file, bytes }));
  }
  if (results.some((r) => r.kind === "accepted")) scheduleDrain("samples");
  return json({ results: results.map((r) => (r.kind === "accepted" ? { kind: r.kind, filename: r.filename, documentId: r.document.id } : r)) });
});
```

```ts
// src/app/api/workspace/route.ts
import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo } from "@/lib/repo/documents";
import { workspacesRepo } from "@/lib/repo/workspaces";

export const DELETE = handle(async (request) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const docs = await documentsRepo.listByWorkspace(session.workspaceId);
  const blobs = getBlobStore();
  for (const d of docs) await blobs.delete(d.blobKey);
  await auditRepo.log({ workspaceId: session.workspaceId, actorSessionId: session.sessionId, action: "workspace.deleted", targetType: "workspace", targetId: session.workspaceId, meta: { documents: docs.length } });
  await workspacesRepo.deleteCascade(session.workspaceId);
  return json({ ok: true });
});
```

```ts
// src/app/api/health/route.ts
import { sql } from "drizzle-orm";
import { json } from "@/lib/api/respond";
import { getBlobStore } from "@/lib/blob";
import { dbFlavour, ensureDbReady, getDb } from "@/lib/db/client";
import { llmMode } from "@/lib/env";

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    await ensureDbReady();
    await getDb().execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }
  checks.blob = (await getBlobStore().probe()) ? "ok" : "fail";
  const ok = Object.values(checks).every((v) => v === "ok");
  return json(
    { ok, checks, database: dbFlavour(), llmMode, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" },
    ok ? 200 : 503,
  );
}
```

Add to `next.config.ts` so the samples ship with the serverless bundle:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**": ["./samples/manifest.json", "./samples/out/**", "./samples/ground-truth/**"],
  },
};

export default nextConfig;
```

- [ ] **Step 6: Run the test**

Run: `pnpm test:integration -- api-documents`
Expected: 4 passed.

- [ ] **Step 7: Run everything and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A
git commit -m "feat: document, workspace, and health API routes with ingest and drain"
```

---

### Task 12: Dashboard: upload, samples, status list, polling, announcements, end-to-end and axe tests

**Files:**
- Create: `src/lib/api-client.ts`, `src/hooks/use-documents.ts`, `src/hooks/use-workspace-status.ts`, `src/hooks/use-upload.ts`, `src/components/documents/drop-zone.tsx`, `src/components/documents/status-chip.tsx`, `src/components/documents/document-list.tsx`, `src/components/documents/empty-state.tsx`, `src/components/documents/dashboard.tsx`, `playwright.config.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/dashboard.spec.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `DocumentSummary`, `WorkspaceStatus`, `IngestOutcome` shapes from Task 11; `useAnnouncer` from Task 3.
- Produces: `api` client object; `useDocuments()`, `useWorkspaceStatus()`, `useUpload()`, `useLoadSamples()`, `useRetry()`, `useDelete()` hooks; `<Dashboard initialDocuments />`.

- [ ] **Step 1: Write the API client and hooks**

```ts
// src/lib/api-client.ts
import type { DocumentSummary } from "@/lib/api/documents";
import type { IngestOutcome } from "@/lib/pipeline/ingest";
import type { WorkspaceStatus } from "@/app/api/workspace/status/route";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, { ...init, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiClientError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export type UploadResult =
  | { kind: "accepted"; filename: string; document: DocumentSummary }
  | Exclude<IngestOutcome, { kind: "accepted" }>;

export const api = {
  listDocuments: () => request<{ documents: DocumentSummary[] }>("/api/documents"),
  status: () => request<WorkspaceStatus>("/api/workspace/status"),
  upload: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return request<{ results: UploadResult[] }>("/api/documents", { method: "POST", body: form });
  },
  loadSamples: () => request<{ results: Array<{ kind: string; filename: string }> }>("/api/workspace/samples", { method: "POST" }),
  retry: (id: string) => request<{ ok: true }>(`/api/documents/${id}/retry`, { method: "POST" }),
  remove: (id: string) => request<{ ok: true }>(`/api/documents/${id}`, { method: "DELETE" }),
};
```

```ts
// src/hooks/use-documents.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DocumentSummary } from "@/lib/api/documents";

export const documentsKey = ["documents"] as const;

export function anyInFlight(docs: DocumentSummary[] | undefined): boolean {
  return Boolean(docs?.some((d) => d.status === "queued" || d.status === "processing"));
}

export function useDocuments(initialDocuments?: DocumentSummary[]) {
  return useQuery({
    queryKey: documentsKey,
    queryFn: async () => (await api.listDocuments()).documents,
    initialData: initialDocuments,
    refetchInterval: (query) => (anyInFlight(query.state.data) ? 2000 : false),
  });
}
```

```ts
// src/hooks/use-workspace-status.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useWorkspaceStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["workspace-status"],
    queryFn: api.status,
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });
}
```

```ts
// src/hooks/use-upload.ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { documentsKey } from "./use-documents";

export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.upload,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}

export function useLoadSamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.loadSamples,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}

export function useRetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.retry,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}

export function useDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.remove,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}
```

- [ ] **Step 2: Write the components**

```tsx
// src/components/documents/status-chip.tsx
import { AlertTriangle, Ban, Check, Clock, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "@/lib/api/documents";

const MAP: Record<DocumentSummary["status"], { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  queued: { label: "Queued", icon: Clock, className: "bg-secondary text-muted-foreground" },
  processing: { label: "Extracting", icon: Loader2, className: "bg-secondary text-foreground" },
  needs_review: { label: "Needs review", icon: Eye, className: "bg-warning-bg text-warning" },
  verified: { label: "Verified", icon: Check, className: "bg-success-bg text-success" },
  failed: { label: "Failed", icon: AlertTriangle, className: "bg-danger-bg text-danger" },
  rejected: { label: "Rejected", icon: Ban, className: "bg-danger-bg text-danger" },
};

export function statusLabel(status: DocumentSummary["status"]): string {
  return MAP[status].label;
}

export function StatusChip({ status }: { status: DocumentSummary["status"] }) {
  const { label, icon: Icon, className } = MAP[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 font-mono text-xs", className)}>
      <Icon className={cn("size-3.5", status === "processing" && "motion-safe:animate-spin")} aria-hidden="true" />
      {label}
    </span>
  );
}
```

```tsx
// src/components/documents/drop-zone.tsx
"use client";
import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

export type LocalRejection = { filename: string; message: string };

type Props = {
  onFiles: (files: File[], rejected: LocalRejection[]) => void;
  busy?: boolean;
};

export function splitFiles(list: File[]): { ok: File[]; rejected: LocalRejection[] } {
  const ok: File[] = [];
  const rejected: LocalRejection[] = [];
  for (const f of list.slice(0, MAX_FILES)) {
    if (f.size > MAX_BYTES) rejected.push({ filename: f.name, message: "Larger than 10 MB." });
    else ok.push(f);
  }
  for (const f of list.slice(MAX_FILES)) rejected.push({ filename: f.name, message: "More than 5 files at once." });
  return { ok, rejected };
}

export function DropZone({ onFiles, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  function handle(list: FileList | null) {
    if (!list) return;
    const { ok, rejected } = splitFiles(Array.from(list));
    onFiles(ok, rejected);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border-strong bg-surface p-6 text-center transition-colors",
        dragging && "border-brand bg-secondary",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handle(e.dataTransfer.files);
      }}
    >
      <Upload className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm">Drop invoices here, or</p>
      <Button
        type="button"
        className="mt-3 rounded-pill"
        disabled={busy}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
      >
        Choose files
      </Button>
      <p id={hintId} className="mt-3 font-mono text-xs text-muted-foreground">
        PDF, PNG or JPEG. Up to 5 files, 10 MB each.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label="Choose invoice files"
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
```

```tsx
// src/components/documents/empty-state.tsx
import { Button } from "@/components/ui/button";

export function EmptyState({ onLoadSamples, loading }: { onLoadSamples: () => void; loading: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface p-8 text-center">
      <p className="font-mono text-xs text-muted-foreground">Nothing here yet</p>
      <h2 className="mt-2 text-lg font-semibold tracking-tight">No invoices yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Load a few messy sample invoices to see extraction, source highlighting and validation in action, or upload your own.
      </p>
      <Button type="button" className="mt-5 rounded-pill" onClick={onLoadSamples} disabled={loading}>
        {loading ? "Loading samples" : "Load sample invoices"}
      </Button>
    </div>
  );
}
```

```tsx
// src/components/documents/document-list.tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentSummary } from "@/lib/api/documents";
import { StatusChip } from "./status-chip";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

type Props = {
  documents: DocumentSummary[];
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
};

export function DocumentList({ documents, onRetry, onDelete }: Props) {
  const [pending, setPending] = useState<DocumentSummary | null>(null);
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Uploaded documents and their processing status</caption>
          <thead className="text-left font-mono text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3">Document</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 tabular">Size</th>
              <th scope="col" className="px-4 py-3">Uploaded</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link href={`/documents/${d.id}`} className="font-medium hover:underline">
                    {d.filename}
                  </Link>
                  {d.failureMessage ? <p className="mt-1 text-xs text-danger">{d.failureMessage}</p> : null}
                </td>
                <td className="px-4 py-3"><StatusChip status={d.status} /></td>
                <td className="px-4 py-3 font-mono text-xs tabular">{formatBytes(d.byteSize)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatWhen(d.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {d.status === "failed" || d.status === "rejected" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onRetry(d.id)} aria-label={`Retry ${d.filename}`}>
                        Retry
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPending(d)} aria-label={`Delete ${d.filename}`}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pending?.filename}?</DialogTitle>
            <DialogDescription>This removes the file and everything extracted from it. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pending) onDelete(pending.id);
                setPending(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

```tsx
// src/components/documents/dashboard.tsx
"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAnnouncer } from "@/components/layout/live-announcer";
import { Skeleton } from "@/components/ui/skeleton";
import { anyInFlight, useDocuments } from "@/hooks/use-documents";
import { useDelete, useLoadSamples, useRetry, useUpload } from "@/hooks/use-upload";
import type { DocumentSummary } from "@/lib/api/documents";
import { ApiClientError, type UploadResult } from "@/lib/api-client";
import { DocumentList } from "./document-list";
import { DropZone, type LocalRejection } from "./drop-zone";
import { EmptyState } from "./empty-state";
import { statusLabel } from "./status-chip";

function describeResults(results: UploadResult[], local: LocalRejection[]): string {
  const accepted = results.filter((r) => r.kind === "accepted").length;
  const duplicates = results.filter((r) => r.kind === "duplicate").length;
  const rejected = [...results.filter((r) => r.kind === "rejected"), ...local];
  const parts: string[] = [];
  if (accepted) parts.push(`${accepted} file${accepted === 1 ? "" : "s"} uploaded`);
  if (duplicates) parts.push(`${duplicates} already in your workspace`);
  if (rejected.length) parts.push(`${rejected.length} rejected`);
  return parts.join(", ") || "Nothing uploaded";
}

export function Dashboard({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const { announce } = useAnnouncer();
  const documents = useDocuments(initialDocuments);
  const upload = useUpload();
  const samples = useLoadSamples();
  const retry = useRetry();
  const remove = useDelete();
  const previous = useRef<Map<string, DocumentSummary["status"]>>(new Map());

  useEffect(() => {
    const docs = documents.data ?? [];
    for (const d of docs) {
      const before = previous.current.get(d.id);
      if (before && before !== d.status && !anyInFlightStatus(d.status)) {
        announce(`${d.filename}: ${statusLabel(d.status)}`);
      }
      previous.current.set(d.id, d.status);
    }
  }, [documents.data, announce]);

  function onError(err: unknown) {
    const message = err instanceof ApiClientError ? err.message : "Something went wrong. Try again.";
    toast.error(message);
    announce(message, "assertive");
  }

  function onFiles(files: File[], local: LocalRejection[]) {
    for (const r of local) toast.error(`${r.filename}: ${r.message}`);
    if (files.length === 0) return;
    upload.mutate(files, {
      onSuccess: ({ results }) => {
        const summary = describeResults(results, local);
        toast.success(summary);
        announce(summary);
        for (const r of results) if (r.kind === "rejected") toast.error(`${r.filename}: ${r.message}`);
      },
      onError,
    });
  }

  const docs = documents.data ?? [];
  const busy = upload.isPending || samples.isPending;

  return (
    <section aria-labelledby="documents-heading" className="space-y-6">
      <div>
        <p className="font-mono text-xs text-muted-foreground">01 / Documents</p>
        <h1 id="documents-heading" className="mt-2 text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Drop vendor invoices here. Each one is extracted, checked, and queued for a quick review where every value shows its source.
        </p>
      </div>
      <DropZone onFiles={onFiles} busy={busy} />
      {documents.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : docs.length === 0 ? (
        <EmptyState
          loading={samples.isPending}
          onLoadSamples={() =>
            samples.mutate(undefined, {
              onSuccess: ({ results }) => {
                const n = results.filter((r) => r.kind === "accepted").length;
                const msg = n ? `${n} sample invoices loaded` : "Samples are already in your workspace";
                toast.success(msg);
                announce(msg);
              },
              onError,
            })
          }
        />
      ) : (
        <DocumentList
          documents={docs}
          onRetry={(id) => retry.mutate(id, { onError })}
          onDelete={(id) => remove.mutate(id, { onSuccess: () => announce("Document deleted"), onError })}
        />
      )}
      {anyInFlight(docs) ? (
        <p className="font-mono text-xs text-muted-foreground">Processing. This page updates automatically.</p>
      ) : null}
    </section>
  );
}

function anyInFlightStatus(status: DocumentSummary["status"]): boolean {
  return status === "queued" || status === "processing";
}
```

- [ ] **Step 3: Replace `src/app/page.tsx` with the server component**

```tsx
// src/app/page.tsx
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/documents/dashboard";
import { listSummaries } from "@/lib/api/documents";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/api/session/start?next=/");
  const initialDocuments = await listSummaries(session.workspaceId);
  return <Dashboard initialDocuments={initialDocuments} />;
}
```

- [ ] **Step 4: Write the Playwright config, global setup, and the end-to-end test**

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? `pnpm start -p ${PORT}` : `pnpm dev -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PGLITE_DATA_DIR: ".data/e2e/pglite",
      LOCAL_DATA_DIR: ".data/e2e",
      LLM_MODE: "mock",
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: "e2e-secret-at-least-sixteen-chars",
    },
  },
});
```

```ts
// tests/e2e/global-setup.ts
import { rm } from "node:fs/promises";

export default async function globalSetup() {
  await rm(".data/e2e", { recursive: true, force: true });
}
```

```ts
// tests/e2e/dashboard.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test("bootstraps a guest, loads samples, and shows processing results", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();

    await page.getByRole("button", { name: "Load sample invoices" }).click();
    const rows = page.getByRole("row").filter({ hasText: ".pdf" });
    await expect(rows).toHaveCount(3);

    await expect(page.getByText("Needs review")).toHaveCount(2, { timeout: 60_000 });
    await expect(page.getByText("Rejected")).toHaveCount(1);
    await expect(page.getByText("This document is not an invoice.")).toBeVisible();
  });

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 5: Run lint, typecheck, and the end-to-end suite**

```bash
pnpm typecheck && pnpm lint
pnpm test:e2e
```

Expected: 3 passed. If axe reports a violation, fix the component rather than the test. Rejected sample rows show the model's reason as the failure message under the filename.

- [ ] **Step 6: Append a decisions entry and commit**

Append to `decisions.md`:

```markdown
## 2026-09-14: Polling over server-sent events for job status

**Decision.** The dashboard polls the documents list every two seconds while anything is in flight and stops when nothing is.
**Alternatives.** Server-sent events; WebSockets.
**Reasoning.** Polling reuses the same JSON endpoint and TanStack Query cache the rest of the page uses, needs no connection management, and the poll doubles as the queue's drain trigger on the Hobby plan where cron cannot run every minute. Documents take seconds, not milliseconds, so two-second latency is invisible.
**Cut.** A streaming channel. Worth revisiting only if the review screen needs sub-second updates.
```

```bash
git add -A
git commit -m "feat: documents dashboard with upload, samples, polling, and e2e coverage"
```

---

### Task 13: Continuous integration and first deployment

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `vercel.json`
- Modify: `README.md` (add the live URL once known)

**Interfaces:**
- Produces: a green CI on every push; a production URL; Neon and Blob provisioned inside Sagar's Vercel project.

Every step marked **STOP: needs Sagar** creates or authenticates something on his accounts. Pause, state the exact command and what it creates, and wait for a yes.

- [ ] **Step 1: Write the CI workflow and Dependabot config**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
env:
  BETTER_AUTH_SECRET: ci-secret-at-least-sixteen-chars
  LLM_MODE: mock
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 12 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: vouch_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/vouch_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 12 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 12 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e
        env: { CI: "true" }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report, retention-days: 7 }
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 12 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --prod --audit-level high
```

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types: ["minor", "patch"]
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly }
```

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm db:migrate && pnpm build"
}
```

Commit these before pushing so the first push runs CI:

```bash
git add -A
git commit -m "ci: lint, typecheck, unit, integration on Postgres, e2e, and audit"
```

- [ ] **Step 2: STOP: needs Sagar. Create the public GitHub repository and push**

What it creates: a public repository `vouch` under the `SagarRajput-7` account, with `main` pushed.

```bash
gh repo create vouch --public --source=. --remote=origin --push --description "Invoices you can vouch for. Messy vendor invoices become a verified, queryable ledger where every value shows its source."
```

Then open the Actions tab and confirm all four jobs pass. Fix anything red before continuing.

- [ ] **Step 3: STOP: needs Sagar. Log in to Vercel and link the project**

Sagar runs the login himself so the browser handshake happens on his account:

```
! vercel login
```

Then, with his yes, link the directory to a new project on his personal scope:

```bash
vercel link --yes
```

What it creates: a Vercel project named `vouch` and a `.vercel/` folder locally, which is already gitignored by the CLI.

- [ ] **Step 4: STOP: needs Sagar. Provision Neon through the Marketplace and a Blob store**

Cost: both free within the limits recorded in the spec. What it creates: a Neon project owned by the Vercel account with its connection string injected as project environment variables, and a private Blob store with its token injected.

```bash
vercel integration add neon
vercel blob store add vouch-files
vercel env ls
```

If the Neon step hands off to the browser, Sagar completes it there and then re-runs `vercel env ls`. Neon may inject `DATABASE_URL` directly or under another name such as `POSTGRES_URL`; if only the latter exists, add an alias so the app's variable is set:

```bash
vercel env add DATABASE_URL production
```

pasting the pooled connection string from `vercel env pull`.

- [ ] **Step 5: STOP: needs Sagar. Set the remaining production environment variables**

```bash
openssl rand -base64 32   # use the output for BETTER_AUTH_SECRET
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production        # https://<project>.vercel.app for now
vercel env add LLM_MODE production               # mock, until the Anthropic key is added in the pipeline plan
vercel env add BUDGET_DAILY_USD production       # 3
vercel env add UPLOADS_ENABLED production        # true
openssl rand -base64 32   # use the output for CRON_SECRET
vercel env add CRON_SECRET production
vercel env pull .env.local
```

`.env.local` is gitignored and lets `pnpm dev` run against the real Neon and Blob when wanted.

- [ ] **Step 6: STOP: needs Sagar. Deploy to production and smoke test**

```bash
vercel deploy --prod
```

Then:

1. Open `https://<project>.vercel.app/api/health` and confirm `"ok": true` with `"database": "postgres"` and `"blob": "ok"`.
2. Open the root in a private window, confirm the guest redirect lands on the dashboard, click Load sample invoices, and watch the three documents reach Needs review and Rejected.
3. Upload a PDF from your machine; confirm it is stored, processed by the mock, and rejected with the message about the missing API key.
4. Check the Vercel function logs for the `drain.done` and `job.succeeded` lines.

If the private-blob read fails on Vercel, adjust only `VercelBlobStore.get` in `src/lib/blob/vercel.ts` to the SDK's actual return shape and redeploy.

- [ ] **Step 7: STOP: needs Sagar. Connect Git for automatic deployments**

```bash
vercel git connect
```

What it does: every push to `main` deploys to production and every pull request gets a preview URL. The CI workflow still gates merges.

- [ ] **Step 8: Record the URL and commit**

Add the production URL under a "Live" heading in `README.md`, then:

```bash
git add README.md
git commit -m "docs: add live URL"
git push
```

---

## Plan self-review

**Spec coverage in this plan.** Section 4 architecture and stack (Tasks 1, 4, 11); section 5 data model in full (Task 4); section 6 stages extract and finalise with checkpoints and the model provider interface (Task 9); section 7 risk (Task 9); section 9 queue with claiming, backoff, stale sweep, and drain triggers including the Hobby cron constraint (Tasks 8, 11); section 10 guest sessions, workspace lifetime, isolation test (Tasks 5, 6); section 11 same-origin checks, magic-byte detection, size caps, safe filenames and keys, private blob delivery, audit log, dependency audit (Tasks 7, 11, 13); section 12 routes for documents, retry, file, status, samples, workspace, health (Task 11); section 13 dashboard, polling, announcements (Task 12); section 14 tokens and theme (Task 3); section 15 skip link, landmarks, labels, live regions, axe in CI (Tasks 3, 12); section 17 trace rows, structured logs, health (Tasks 6, 9, 11); section 18 file, page-count placeholder, document, per-request limits (Task 11); section 19 three of eight samples and the manifest (Task 10); section 20 unit, integration on PGlite and Postgres, e2e, axe (throughout); section 21 zero-service local setup (Tasks 1, 4, 7); section 22 CI and deployment (Task 13); section 23 decisions.md as a running log (every task).

**Deferred to later plans, by design.** Pipeline plan: parse with pdf text, OCR and rasterisation, the live Claude provider, grounding, validation, reconcile, page counts and kinds, the remaining five samples, recorded extractions. Review plan: the review screen, corrections, verification, keyboard model, trace drawer, how-it-works. Ledger plan: filters, search, cursor pagination, export. Hardening plan: rate limits, budget cap, uploads kill switch behaviour in the UI, CSP and security headers, cleanup cron, Google sign-in, threat model document. Quality plan: eval script, load test, Lighthouse CI, screen-reader pass. Docs plan: README, architecture, accessibility notes, final decisions pass.

**Type consistency checks applied.** `summarise` and `DocumentSummary` live in `src/lib/api/documents.ts`, not in the route file, because Next only allows handler exports from route modules. `requireSessionFor(request)` is the API entry point and `getSession()` the page entry point. `claimJobs` takes `{ runnerId, limit, perWorkspace, global }` everywhere. `IngestOutcome` is the single upload result shape shared by the route, the samples loader, and the client.
