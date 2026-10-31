import { PgClient } from "@effect/sql-pg"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { Cause, Config, Context, Effect, Layer, Option } from "effect"
import { SqlClient, SqlError } from "effect/sql"
import { NodePgPool } from "./node-pg-pool.ts"
import { authRelations } from "./schema/auth.ts"

export type Db = PgDrizzle.EffectPgDatabase<typeof authRelations>

/** Database runs native Drizzle Effects on the current fiber's SQL transaction. */
export class Database extends Context.Service<
  Database,
  {
    readonly query: <A>(
      build: (db: Db) => Effect.Effect<A, EffectDrizzleQueryError>,
    ) => Effect.Effect<A, SqlError.SqlError>
    readonly transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError.SqlError, R>
  }
>()("@parley/db/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const db = yield* PgDrizzle.makeWithDefaults({ relations: authRelations, paramsInErrors: false })
      const query = <A>(build: (db: Db) => Effect.Effect<A, EffectDrizzleQueryError>) =>
        Effect.suspend(() => build(db)).pipe(
          Effect.catchTag("EffectDrizzleQueryError", (error) => {
            const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
            return Option.isSome(failure) && SqlError.isSqlError(failure.value)
              ? Effect.fail(failure.value)
              : Effect.die(error)
          }),
          Effect.withSpan("Database.query"),
        )
      return { query, transaction: sql.withTransaction }
    }),
  )
}

/** PgLive owns the native Effect PostgreSQL pool and its statement timeout. */
export const PgLive = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  startupParameters: Config.withDefault(Config.Int("DATABASE_STATEMENT_TIMEOUT_MS"), 30_000).pipe(
    Config.map((ms) => ({ statement_timeout: String(ms) })),
  ),
})

export const DatabaseLive = Layer.mergeAll(Database.layer.pipe(Layer.provideMerge(PgLive)), NodePgPool.layer)
