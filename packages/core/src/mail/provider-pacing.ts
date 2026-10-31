import { EmailServiceUnavailable } from "@parley/domain"
import { Config, Context, Duration, Effect, Layer, Redacted } from "effect"
import pg from "pg"
import { RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible"

/** All Resend requests share the account's allowance across servers. Database failures stop sending. */
export class ProviderPacing extends Context.Service<
  ProviderPacing,
  { readonly wait: Effect.Effect<void, EmailServiceUnavailable> }
>()("@parley/core/ProviderPacing") {
  static readonly layer = Layer.effect(
    ProviderPacing,
    Effect.gen(function* () {
      const url = yield* Config.Redacted("DATABASE_URL").pipe(Effect.orDie)
      const rate = yield* Config.withDefault(Config.Int("EMAIL_BATCHES_PER_SECOND"), 2).pipe(Effect.orDie)
      const runFork = Effect.runForkWith(yield* Effect.context<never>())
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pool = new pg.Pool({ connectionString: Redacted.value(url), max: 2 })
          pool.on("error", (cause) => runFork(Effect.logWarning("provider pacing connection lost", cause)))
          return pool
        }),
        (pool) => Effect.tryPromise(() => pool.end()).pipe(Effect.ignore),
      )
      const limiter = new RateLimiterPostgres({
        storeClient: pool,
        tableName: "rate_limits",
        tableCreated: true,
        keyPrefix: "resend-account",
        points: Math.max(1, rate),
        duration: 1,
        clearExpiredByTimeout: false,
      })
      const wait = Effect.gen(function* () {
        for (;;) {
          const refused = yield* Effect.tryPromise({
            try: () =>
              limiter.consume("requests").then(
                () => undefined,
                (cause: unknown) => {
                  if (cause instanceof RateLimiterRes) return cause
                  throw cause
                },
              ),
            catch: (cause) => new EmailServiceUnavailable({ cause }),
          })
          if (!refused) return
          yield* Effect.sleep(Duration.millis(Math.max(1, refused.msBeforeNext)))
        }
      })
      return { wait }
    }),
  )
}
