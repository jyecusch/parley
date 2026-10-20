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

/** How long to wait for Postgres to accept connections, as when it starts alongside the app. */
const WAIT_MS = 120_000

const pool = new pg.Pool({ connectionString: url, max: 1 })

const waitForDatabase = async () => {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    try {
      await pool.query("select 1")
      return
    } catch (error) {
      const code = (error as { code?: string }).code ?? "unknown"
      if (Date.now() > deadline) throw error
      console.log(`Waiting for the database (${code})`)
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
  }
}

try {
  await waitForDatabase()
  await migrate(drizzle(pool), { migrationsFolder: new URL("../migrations", import.meta.url).pathname })
  console.log("Migrations applied")
} finally {
  await pool.end()
}
