import { PgClient } from "@effect/sql-pg"
import { drizzle, type PgRemoteDatabase } from "drizzle-orm/pg-proxy"
import { Config, Context, Effect, Layer } from "effect"
import { SqlClient, SqlError } from "effect/sql"
import * as schema from "./schema/index.ts"

export type Db = PgRemoteDatabase<typeof schema>

/** Drizzle may wrap the driver's error; find the SqlError our driver callback rejected with. */
const findSqlError = (cause: unknown): SqlError.SqlError | undefined => {
  let current: unknown = cause
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (SqlError.isSqlError(current)) return current
    current = (current as { readonly cause?: unknown }).cause
  }
  return undefined
}

/**
 * Drizzle builds queries; Effect's SqlClient runs them (D82). Queries run on the current
 * fiber's connection, so they join an enclosing `transaction`.
 */
export class Database extends Context.Service<
  Database,
  {
    readonly query: <A>(build: (db: Db) => PromiseLike<A>) => Effect.Effect<A, SqlError.SqlError>
    readonly transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError.SqlError, R>
  }
>()("@parley/db/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const query = <A>(build: (db: Db) => PromiseLike<A>) =>
        Effect.flatMap(Effect.context<never>(), (context) =>
          Effect.callback<A, SqlError.SqlError>((resume) => {
            const run = Effect.runPromiseWith(context)
            const db = drizzle(
              async (text, params, method) => {
                const statement = sql.unsafe(text, params)
                const rows = await run(method === "all" ? statement.values : statement)
                return { rows: rows as Array<unknown> }
              },
              { schema },
            )
            build(db).then(
              (value) => resume(Effect.succeed(value)),
              (cause) => {
                const sqlError = findSqlError(cause)
                resume(sqlError ? Effect.fail(sqlError) : Effect.die(cause))
              },
            )
          }),
        ).pipe(Effect.withSpan("Database.query"))

      return { query, transaction: sql.withTransaction }
    }),
  )
}

/**
 * The Postgres pool, configured from DATABASE_URL. Process tier: built once. Every statement is cut
 * off after DATABASE_STATEMENT_TIMEOUT_MS (default 30s), so one team's expensive filter can't hold
 * the database for everyone else.
 */
export const PgLive = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  startupParameters: Config.withDefault(Config.Int("DATABASE_STATEMENT_TIMEOUT_MS"), 30_000).pipe(
    Config.map((ms) => ({ statement_timeout: String(ms) })),
  ),
})

export const DatabaseLive = Database.layer.pipe(Layer.provideMerge(PgLive))
