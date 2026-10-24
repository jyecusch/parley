import { DatabaseUnavailable, RequestsTooFrequent } from "@parley/domain"
import { Config, Context, Duration, Effect, Layer, Redacted } from "effect"
import pg from "pg"
import { RateLimiterMemory, RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible"

/**
 * Counts requests per key in fixed windows (D157), with rate-limiter-flexible. Counts live in
 * Postgres (`rate_limits`), so every server shares them; if the database can't be reached, each
 * server counts in memory until it can. Process tier: the keys name their own team, connection or
 * link, so nothing is shared between them. A Redis store is a drop-in swap if Postgres gets busy.
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /** Counts one request for `key`, or fails once `limit` is used up in the current window. */
    readonly take: (key: string, limit: number, window: Duration.Duration) => Effect.Effect<void, RequestsTooFrequent>
  }
>()("@parley/core/RateLimiter") {
  static readonly layer = Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const url = yield* Config.Redacted("DATABASE_URL").pipe(Effect.orDie)
      // Its own small pool: Effect's SQL client doesn't hand out its connections.
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new pg.Pool({ connectionString: Redacted.value(url), max: 4 })),
        (opened) => Effect.tryPromise(() => opened.end()).pipe(Effect.ignore),
      )
      // One limiter per limit and window; the table is shared, keys are prefixed by both.
      const limiters = new Map<string, RateLimiterPostgres>()
      const limiterFor = (limit: number, window: Duration.Duration) => {
        const duration = Math.max(1, Math.ceil(Duration.toSeconds(window)))
        const name = `${limit}/${duration}`
        let limiter = limiters.get(name)
        if (!limiter) {
          limiter = new RateLimiterPostgres({
            storeClient: pool,
            tableName: "rate_limits",
            tableCreated: true,
            keyPrefix: name,
            points: limit,
            duration,
            // One limiter clears finished windows now and then; the rest needn't.
            clearExpiredByTimeout: limiters.size === 0,
            insuranceLimiter: new RateLimiterMemory({ keyPrefix: name, points: limit, duration }),
          })
          limiters.set(name, limiter)
        }
        return limiter
      }
      return {
        take: (key, limit, window) =>
          // consume rejects with a RateLimiterRes when the limit is used up. A database outage falls
          // back to the in-memory limiter instead, so any other rejection is a bug: a defect.
          Effect.tryPromise({
            try: () =>
              limiterFor(limit, window)
                .consume(key)
                .then(
                  () => undefined,
                  (refused: unknown) => {
                    if (refused instanceof RateLimiterRes) return refused
                    throw refused
                  },
                ),
            catch: (cause) => new DatabaseUnavailable({ cause }),
          }).pipe(
            Effect.orDie,
            Effect.flatMap((refused) =>
              refused
                ? Effect.fail(new RequestsTooFrequent({ retryAfter: Duration.millis(refused.msBeforeNext) }))
                : Effect.void,
            ),
          ),
      }
    }),
  )
}
