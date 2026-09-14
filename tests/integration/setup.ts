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
