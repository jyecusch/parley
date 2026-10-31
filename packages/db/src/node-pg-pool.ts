import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"
import pg from "pg"

/** NodePgPool provides a process-wide pg pool for libraries that require the node-postgres API. */
export class NodePgPool extends Context.Service<NodePgPool, pg.Pool>()("@parley/db/NodePgPool") {
  static readonly layer = Layer.effect(
    NodePgPool,
    Effect.gen(function* () {
      const url = yield* Config.Redacted("DATABASE_URL").pipe(Effect.orDie)
      const statementTimeout = yield* Config.withDefault(Config.Int("DATABASE_STATEMENT_TIMEOUT_MS"), 30_000).pipe(
        Effect.orDie,
      )
      const connectionTimeout = yield* Config.withDefault(
        Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), "DATABASE_CONNECTION_TIMEOUT_MS"),
        5_000,
      ).pipe(Effect.orDie)
      const queryTimeout = yield* Config.withDefault(
        Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), "DATABASE_QUERY_TIMEOUT_MS"),
        31_000,
      ).pipe(Effect.orDie)
      const runFork = Effect.runForkWith(yield* Effect.context<never>())
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pool = new pg.Pool({
            connectionString: Redacted.value(url),
            max: 5,
            connectionTimeoutMillis: connectionTimeout,
            query_timeout: queryTimeout,
            statement_timeout: statementTimeout,
          })
          pool.on("error", (cause) => runFork(Effect.logWarning("node-postgres connection lost", cause)))
          return pool
        }),
        (pool) => Effect.tryPromise(() => pool.end()).pipe(Effect.ignore),
      )
    }),
  )
}
