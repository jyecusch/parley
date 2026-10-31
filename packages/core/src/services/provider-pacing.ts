import { NodePgPool } from "@parley/db"
import { EmailServiceUnavailable } from "@parley/domain"
import { Config, Context, Duration, Effect, Layer } from "effect"
import { RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible"

/** All Resend requests share the account's allowance across servers. Database failures stop sending. */
export class ProviderPacing extends Context.Service<
  ProviderPacing,
  { readonly wait: Effect.Effect<void, EmailServiceUnavailable> }
>()("@parley/core/ProviderPacing") {
  static readonly layer = Layer.effect(
    ProviderPacing,
    Effect.gen(function* () {
      const pool = yield* NodePgPool
      const rate = yield* Config.withDefault(Config.Int("EMAIL_BATCHES_PER_SECOND"), 2).pipe(Effect.orDie)
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
