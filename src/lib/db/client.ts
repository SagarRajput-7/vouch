import { mkdirSync } from "node:fs";
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

/**
 * Ensures a PGlite on-disk data directory exists before PGlite opens it.
 * PGlite's Node fs backend does a non-recursive mkdir, so a fresh checkout's
 * missing parent (".data") crashes construction otherwise. ":memory:" is
 * returned untouched since there is no directory to create.
 */
export function ensurePgliteDir(dir: string): string {
  if (dir === ":memory:") return dir;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function create(): Db {
  if (env.DATABASE_URL) {
    holder.pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });
    holder.flavour = "postgres";
    return drizzleNode({ client: holder.pool, schema }) as unknown as Db;
  }
  const pgliteDir = ensurePgliteDir(env.PGLITE_DATA_DIR);
  holder.pglite = pgliteDir === ":memory:" ? new PGlite() : new PGlite(pgliteDir);
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
