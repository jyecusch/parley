import { describe, expect, it } from "@effect/vitest"
import { EmailIdempotencyKey, EmailServiceUnavailable } from "@parley/domain"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Mailer } from "../src/mail/mailer.ts"
import { ProviderPacing } from "../src/services/provider-pacing.ts"

/** A fake Resend that answers domain requests with `status` and records what was asked. */
const fakeResend = (status: string) => {
  const calls: Array<string> = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`)
    return new Response(JSON.stringify({ id: "d_1", status, records: [] }), { status: 200 })
  }
  return { calls, fetch }
}

const useProvider = <A, E, R>(
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  effect: Effect.Effect<A, E, R>,
  wait: Effect.Effect<void, EmailServiceUnavailable> = Effect.void,
) =>
  effect.pipe(
    Effect.provide(
      Mailer.layer.pipe(
        Layer.provide(Layer.succeed(ProviderPacing)({ wait })),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ RESEND_API_KEY: "re_test", EMAIL_FROM: "News <news@example.com>" }),
          ),
        ),
      ),
    ),
    Effect.provideService(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch),
  )

describe("Mailer with Resend", () => {
  it.effect("leaves a verified sending domain alone instead of starting a new DNS check", () => {
    const resend = fakeResend("verified")
    return useProvider(
      resend.fetch,
      Effect.gen(function* () {
        const domain = yield* (yield* Mailer).domains.verify("d_1")
        expect(domain.status).toBe("verified")
        expect(resend.calls).toEqual(["GET /domains/d_1"])
      }),
    )
  })
  it.effect("asks Resend to check the DNS records of a domain that isn't verified yet", () => {
    const resend = fakeResend("pending")
    return useProvider(
      resend.fetch,
      Effect.gen(function* () {
        const domain = yield* (yield* Mailer).domains.verify("d_1")
        expect(domain.status).toBe("pending")
        expect(resend.calls).toEqual(["GET /domains/d_1", "POST /domains/d_1/verify", "GET /domains/d_1"])
      }),
    )
  })
  for (const body of ["{}", "null", '{"id":""}', '{"id":"d_1","records":[{}]}'])
    it.effect(`rejects a malformed domain response: ${body}`, () =>
      useProvider(
        async () => new Response(body),
        Effect.gen(function* () {
          const error = yield* (yield* Mailer).domains.create("example.com").pipe(Effect.flip)
          expect(error._tag).toBe("EmailServiceUnavailable")
        }),
      ),
    )
})

const email = { to: "ada@example.com", subject: "Hello", html: "<p>Hello</p>", text: "Hello" }

describe("Mailer durable batches", () => {
  it.effect("sends the stored bytes and key unchanged on each retry", () => {
    const calls: RequestInit[] = []
    return useProvider(
      async (_, init) => {
        calls.push(init ?? {})
        return new Response(JSON.stringify({ data: [{ id: "email-1" }] }))
      },
      Effect.gen(function* () {
        const mailer = yield* Mailer
        const prepared = yield* mailer.prepareBatch([email])
        expect(JSON.parse(prepared.payload)[0].from).toBe("News <news@example.com>")
        const input = {
          ...prepared,
          idempotencyKey: Schema.decodeUnknownSync(EmailIdempotencyKey)(crypto.randomUUID()),
          count: 1,
          retryUntil: new Date(Date.now() + 60_000),
        }
        expect(yield* mailer.deliverBatch(input)).toEqual([{ providerId: "email-1" }])
        yield* mailer.deliverBatch(input)
        expect(calls.map((call) => call.body)).toEqual([prepared.payload, prepared.payload])
        expect(calls.map((call) => new Headers(call.headers).get("Idempotency-Key"))).toEqual([
          input.idempotencyKey,
          input.idempotencyKey,
        ])
      }),
    )
  })

  for (const body of ["{}", '{"data":[]}', '{"data":[{"id":""}]}', '{"data":[{},{}]}', "not JSON"])
    it.effect(`treats a malformed acceptance response as uncertain: ${body}`, () =>
      useProvider(
        async () => new Response(body),
        Effect.gen(function* () {
          const mailer = yield* Mailer
          const prepared = yield* mailer.prepareBatch([email])
          const error = yield* mailer
            .deliverBatch({
              ...prepared,
              idempotencyKey: Schema.decodeUnknownSync(EmailIdempotencyKey)(crypto.randomUUID()),
              count: 1,
              retryUntil: new Date(Date.now() + 60_000),
            })
            .pipe(Effect.flip)
          expect(error._tag).toBe("EmailDeliveryUnconfirmed")
        }),
      ),
    )

  it.effect("checks the retry deadline after waiting for the shared provider allowance", () => {
    let calls = 0
    const deadline = new Date(Date.now() + 60_000)
    return useProvider(
      async () => {
        calls++
        return new Response("{}")
      },
      Effect.gen(function* () {
        const mailer = yield* Mailer
        const prepared = yield* mailer.prepareBatch([email])
        const error = yield* mailer
          .deliverBatch({
            ...prepared,
            idempotencyKey: Schema.decodeUnknownSync(EmailIdempotencyKey)(crypto.randomUUID()),
            count: 1,
            retryUntil: deadline,
          })
          .pipe(Effect.flip)
        expect(error._tag).toBe("EmailBatchReplayUnsafe")
        expect(calls).toBe(0)
      }),
      Effect.sync(() => deadline.setTime(0)).pipe(Effect.asVoid),
    )
  })

  it.effect("refuses to replay a batch with a different provider credential", () => {
    let calls = 0
    return useProvider(
      async () => {
        calls++
        return new Response("{}")
      },
      Effect.gen(function* () {
        const mailer = yield* Mailer
        const prepared = yield* mailer.prepareBatch([email])
        const error = yield* mailer
          .deliverBatch({
            ...prepared,
            providerIdentity: "another-credential",
            idempotencyKey: Schema.decodeUnknownSync(EmailIdempotencyKey)(crypto.randomUUID()),
            count: 1,
            retryUntil: new Date(Date.now() + 60_000),
          })
          .pipe(Effect.flip)
        expect(error._tag).toBe("EmailBatchReplayUnsafe")
        expect(calls).toBe(0)
      }),
    )
  })
  it.effect("refuses an invalid idempotency key before dispatch even from an untyped caller", () => {
    let calls = 0
    return useProvider(
      async () => {
        calls++
        return new Response("{}")
      },
      Effect.gen(function* () {
        const mailer = yield* Mailer
        const prepared = yield* mailer.prepareBatch([email])
        const error = yield* mailer
          .deliverBatch({
            ...prepared,
            idempotencyKey: "" as EmailIdempotencyKey,
            count: 1,
            retryUntil: new Date(Date.now() + 60_000),
          })
          .pipe(Effect.flip)
        expect(error._tag).toBe("EmailBatchReplayUnsafe")
        expect(calls).toBe(0)
      }),
    )
  })
  it.effect("does not advertise replay after a foreground send has an unconfirmed outcome", () =>
    useProvider(
      async () => {
        throw new Error("Connection reset after acceptance")
      },
      Effect.gen(function* () {
        const error = yield* (yield* Mailer).sendBatch([email]).pipe(Effect.flip)
        expect(error._tag).toBe("EmailDeliveryUnconfirmed")
        expect(error.isRetryable).toBe(false)
      }),
    ),
  )
  it.effect("keeps pre-dispatch pacing failures retryable and never calls the provider", () => {
    let calls = 0
    return useProvider(
      async () => {
        calls++
        return new Response("{}")
      },
      Effect.gen(function* () {
        const error = yield* (yield* Mailer).send(email).pipe(Effect.flip)
        expect(error._tag).toBe("EmailServiceUnavailable")
        expect(error.isRetryable).toBe(true)
        expect(calls).toBe(0)
      }),
      Effect.fail(new EmailServiceUnavailable({ cause: "Database unavailable before dispatch" })),
    )
  })
  it.effect("rejects duplicate provider IDs with an accurate diagnostic", () =>
    useProvider(
      async () => new Response('{"data":[{"id":"same"},{"id":"same"}]}'),
      Effect.gen(function* () {
        const mailer = yield* Mailer
        const prepared = yield* mailer.prepareBatch([email, { ...email, to: "grace@example.com" }])
        const error = yield* mailer
          .deliverBatch({
            ...prepared,
            idempotencyKey: Schema.decodeUnknownSync(EmailIdempotencyKey)(crypto.randomUUID()),
            count: 2,
            retryUntil: new Date(Date.now() + 60_000),
          })
          .pipe(Effect.flip)
        expect(error._tag).toBe("EmailDeliveryUnconfirmed")
        if (error._tag === "EmailDeliveryUnconfirmed")
          expect(String((error.cause as EmailServiceUnavailable).cause)).toContain(
            "one distinct email ID per recipient",
          )
      }),
    ),
  )
})
