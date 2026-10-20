import { RequestsTooFrequent } from "@parley/domain"
import { Context, Duration, Effect, Layer } from "effect"

interface Window {
  count: number
  readonly endsAt: number
}

/**
 * Counts requests per key in fixed windows, in this process's memory. Process tier: the keys name
 * their own team, connection or link, so nothing is shared between them. With several servers each
 * counts separately, which multiplies the limits by the number of servers (R43 has the same caveat).
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /** Counts one request for `key`, or fails once `limit` is used up in the current window. */
    readonly take: (key: string, limit: number, window: Duration.Duration) => Effect.Effect<void, RequestsTooFrequent>
  }
>()("@parley/core/RateLimiter") {
  static readonly layer = Layer.sync(RateLimiter, () => {
    const windows = new Map<string, Window>()
    let sweptAt = Date.now()
    return {
      take: (key, limit, window) =>
        Effect.suspend(() => {
          const now = Date.now()
          // Forget finished windows now and then, so the map can't grow without end.
          if (now - sweptAt > 60_000) {
            for (const [name, entry] of windows) if (entry.endsAt <= now) windows.delete(name)
            sweptAt = now
          }
          const current = windows.get(key)
          const entry =
            current && current.endsAt > now ? current : { count: 0, endsAt: now + Duration.toMillis(window) }
          entry.count += 1
          windows.set(key, entry)
          return entry.count > limit
            ? Effect.fail(new RequestsTooFrequent({ retryAfter: Duration.millis(entry.endsAt - now) }))
            : Effect.void
        }),
    }
  })
}
