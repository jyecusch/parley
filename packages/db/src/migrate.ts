/**
 * Applies pending migrations from ./migrations, then exits. Production runs it before the server starts,
 * so a deploy brings the schema up to date; in development `bun run db:migrate` does the same with drizzle-kit.
 */
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url, max: 1 })
try {
  await migrate(drizzle(pool), { migrationsFolder: new URL("../migrations", import.meta.url).pathname })
  console.log("Migrations applied")
} finally {
  await pool.end()
}
