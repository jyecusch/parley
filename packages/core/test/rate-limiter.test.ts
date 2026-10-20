import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect } from "effect"
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
    }).pipe(Effect.provide(RateLimiter.layer)),
  )
})
