import { Config, Effect, Redacted } from "effect"
import pg from "pg"

/** Queue tests share a database; keep their workers from consuming another test's recipients. */
export const withBroadcastQueue = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const url = yield* Config.Redacted("DATABASE_URL").pipe(Effect.orDie)
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise(async () => {
        const client = new pg.Client({ connectionString: Redacted.value(url) })
        await client.connect()
        await client.query("select pg_advisory_lock(170031, 4)")
        return client
      }).pipe(Effect.orDie),
      () => Effect.scoped(effect),
      (client) => Effect.tryPromise(() => client.end()).pipe(Effect.orDie),
    )
  })
