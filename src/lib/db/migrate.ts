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
