import { describe, expect, it } from "@effect/vitest"
import { Database, DatabaseLive, NodePgPool } from "@parley/db"
import { sql } from "drizzle-orm"
import { ConfigProvider, Context, Effect, Layer } from "effect"
import { ProviderPacing } from "../src/services/provider-pacing.ts"

describe("shared provider pacing", () => {
  it.live("shares one allowance between independently built server instances", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.query((d) => d.execute(sql`delete from rate_limits where key = 'resend-account:requests'`))
      const first = Context.get(yield* Layer.build(Layer.fresh(ProviderPacing.layer)), ProviderPacing)
      const second = Context.get(yield* Layer.build(Layer.fresh(ProviderPacing.layer)), ProviderPacing)
      const start = Date.now()
      yield* first.wait
      yield* second.wait
      yield* first.wait
      expect(Date.now() - start).toBeGreaterThanOrEqual(900)
    }).pipe(Effect.provide(DatabaseLive)),
  )

  it.live("fails closed when the shared database is unavailable", () =>
    Effect.gen(function* () {
      const pacing = yield* ProviderPacing
      const error = yield* pacing.wait.pipe(Effect.flip)
      expect(error._tag).toBe("EmailServiceUnavailable")
    }).pipe(
      Effect.provide(
        ProviderPacing.layer.pipe(
          Layer.provide(NodePgPool.layer),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                DATABASE_URL: "postgres://parley:parley@localhost:1/unavailable",
                EMAIL_BATCHES_PER_SECOND: "2",
              }),
            ),
          ),
        ),
      ),
    ),
  )
})
