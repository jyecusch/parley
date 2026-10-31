/**
 * Applies pending migrations from ./migrations, then exits. Production runs it before the server starts,
 * so a deploy brings the schema up to date; in development `bun run db:migrate` does the same with drizzle-kit.
 */
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Effect, Schedule } from "effect"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 })

const readinessQuery = { text: "select 1", query_timeout: 5_000 } satisfies pg.QueryConfig &
  Pick<pg.ClientConfig, "query_timeout">

const waitForDatabase = Effect.tryPromise(() => pool.query(readinessQuery)).pipe(
  Effect.tapError(() => Effect.logInfo("Waiting for the database")),
  Effect.retry(Schedule.spaced("2 seconds")),
  Effect.timeout("2 minutes"),
)

try {
  await Effect.runPromise(waitForDatabase)
  await migrate(drizzle({ client: pool, paramsInErrors: false }), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  })
  console.log("Migrations applied")
} finally {
  await pool.end()
}
