import { createHash } from "node:crypto"
import { NodePgPool } from "@parley/db"
import { DatabaseUnavailable, RequestsTooFrequent } from "@parley/domain"
import { Context, Duration, Effect, Layer } from "effect"
import { RateLimiterMemory, RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible"

/** A short, fixed-length stand-in for a long part of a key, such as an email address (keys are at most 255 characters). */
export const digest = (value: string) => createHash("sha256").update(value).digest("base64url")

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
      const pool = yield* NodePgPool
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
            try: () => limiterFor(limit, window).consume(key),
            catch: (cause) =>
              cause instanceof RateLimiterRes
                ? new RequestsTooFrequent({ retryAfter: Duration.millis(cause.msBeforeNext) })
                : new DatabaseUnavailable({ cause }),
          }).pipe(Effect.asVoid, Effect.catchTag("DatabaseUnavailable", Effect.die)),
      }
    }),
  )
}
