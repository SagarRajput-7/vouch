import { createEnv } from "@t3-oss/env-nextjs";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
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
  // `next build` always runs with NODE_ENV=production while it collects page data, which
  // imports route modules (and therefore constructs `auth`) without ever serving a real
  // request. NEXT_PHASE distinguishes that build step from an actual production server, so
  // the fallback secret is allowed there and this still throws for a real production boot.
  const isBuildPhase = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
  if (isProduction && !isBuildPhase)
    throw new Error("BETTER_AUTH_SECRET is required in production");
  return "vouch-development-secret-not-for-production";
}
