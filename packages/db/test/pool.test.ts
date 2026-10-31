import { describe, expect, it } from "@effect/vitest"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { Database, DatabaseLive, NodePgPool } from "../src/index.ts"

const deadlines = ConfigProvider.layerAdd(
  ConfigProvider.fromUnknown({
    DATABASE_CONNECTION_TIMEOUT_MS: "500",
    DATABASE_QUERY_TIMEOUT_MS: "100",
  }),
  { asPrimary: true },
)

describe("database deadlines", () => {
  it.live("bounds waiting for a checked-out node-postgres connection", () =>
    Effect.gen(function* () {
      const pool = yield* NodePgPool
      for (let index = 0; index < (pool.options.max ?? 0); index++) {
        yield* Effect.acquireRelease(
          Effect.tryPromise(() => pool.connect()),
          (client) => Effect.sync(() => client.release()),
        )
      }
      const failure = yield* Effect.tryPromise(() => pool.connect().then((client) => client.release())).pipe(
        Effect.flip,
        Effect.timeout("2 seconds"),
      )
      expect(String(failure.cause)).toContain("timeout exceeded when trying to connect")
    }).pipe(Effect.scoped, Effect.provide(NodePgPool.layer.pipe(Layer.provide(deadlines)))),
  )

  it.live("bounds node-postgres queries and keeps the pool usable afterward", () =>
    Effect.gen(function* () {
      const pool = yield* NodePgPool
      const failure = yield* Effect.tryPromise(() => pool.query("select pg_sleep(5)")).pipe(
        Effect.flip,
        Effect.timeout("2 seconds"),
      )
      expect(String(failure.cause)).toContain("Query read timeout")
      const result = yield* Effect.tryPromise(() => pool.query("select 1 as value"))
      expect(result.rows).toEqual([{ value: 1 }])
    }).pipe(Effect.scoped, Effect.provide(NodePgPool.layer.pipe(Layer.provide(deadlines)))),
  )

  it.live("reports a native query deadline as a typed SQL timeout", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const failure = yield* db
        .query((database) => database.execute(sql`select pg_sleep(5)`))
        .pipe(Effect.flip, Effect.timeout("2 seconds"))
      expect(failure.reason._tag).toBe("StatementTimeoutError")
      const result = yield* db.query((database) => database.execute<{ value: number }>(sql`select 1 as value`))
      expect(result.rows).toEqual([{ value: 1 }])
    }).pipe(Effect.scoped, Effect.provide(DatabaseLive.pipe(Layer.provide(deadlines)))),
  )
})
