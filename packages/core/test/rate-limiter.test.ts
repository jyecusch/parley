import { describe, expect, it } from "@effect/vitest"
import { NodePgPool } from "@parley/db"
import type { RequestsTooFrequent } from "@parley/domain"
import { ConfigProvider, Duration, Effect, Layer } from "effect"
import { RateLimiter } from "../src/index.ts"

describe("rate limiter", () => {
  it.effect("allows up to the limit in a window, then says when to try again", () =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter
      const key = `test:${crypto.randomUUID()}`
      for (let i = 0; i < 3; i++) yield* limiter.take(key, 3, Duration.minutes(1))
      const refused = yield* limiter.take(key, 3, Duration.minutes(1)).pipe(Effect.flip)
      expect(refused._tag).toBe("RequestsTooFrequent")
      expect(Duration.toSeconds(refused.retryAfter)).toBeGreaterThan(0)
      // Other keys have their own allowance.
      yield* limiter.take(`${key}:other`, 3, Duration.minutes(1))
    }).pipe(Effect.provide(RateLimiter.layer.pipe(Layer.provide(NodePgPool.layer)))),
  )

  it.effect("shares counts between servers, since they live in Postgres (D157)", () =>
    Effect.gen(function* () {
      const key = `test:${crypto.randomUUID()}`
      // Two separately built limiters stand in for two servers.
      const take = Effect.gen(function* () {
        const limiter = yield* RateLimiter
        yield* limiter.take(key, 2, Duration.minutes(1))
      })
      const server = (effect: Effect.Effect<void, RequestsTooFrequent, RateLimiter>) =>
        effect.pipe(Effect.provide(Layer.fresh(RateLimiter.layer.pipe(Layer.provide(NodePgPool.layer)))))
      yield* server(take)
      yield* server(take)
      const refused = yield* server(take).pipe(Effect.flip)
      expect(refused._tag).toBe("RequestsTooFrequent")
    }),
  )
  it.effect("keeps the application limit in memory when Postgres is unavailable", () =>
    Effect.gen(function* () {
      const limiter = yield* RateLimiter
      const key = `test:${crypto.randomUUID()}`
      yield* limiter.take(key, 1, Duration.minutes(1))
      const refused = yield* limiter.take(key, 1, Duration.minutes(1)).pipe(Effect.flip)
      expect(refused._tag).toBe("RequestsTooFrequent")
    }).pipe(
      Effect.provide(
        RateLimiter.layer.pipe(
          Layer.provide(NodePgPool.layer),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ DATABASE_URL: "postgres://parley:parley@localhost:1/unavailable" }),
            ),
          ),
        ),
      ),
    ),
  )
})
