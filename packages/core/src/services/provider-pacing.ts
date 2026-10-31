import { NodePgPool } from "@parley/db"
import { EmailSendingTooFast, EmailServiceUnavailable } from "@parley/domain"
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
      const wait: Effect.Effect<void, EmailServiceUnavailable> = Effect.tryPromise({
        try: () => limiter.consume("requests"),
        catch: (cause) =>
          cause instanceof RateLimiterRes
            ? new EmailSendingTooFast({ retryAfter: Duration.millis(Math.max(1, cause.msBeforeNext)) })
            : new EmailServiceUnavailable({ cause }),
      }).pipe(
        Effect.asVoid,
        Effect.catchTag("EmailSendingTooFast", (error) =>
          Effect.sleep(error.retryAfter).pipe(Effect.andThen(() => wait)),
        ),
      )
      return { wait }
    }),
  )
}
