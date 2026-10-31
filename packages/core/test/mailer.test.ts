import { describe, expect, it } from "@effect/vitest"
import { EmailIdempotencyKey, EmailServiceUnavailable } from "@parley/domain"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TxtLookup } from "../src/mail/dmarc.ts"
import { Mailer } from "../src/mail/mailer.ts"
import { ProviderPacing } from "../src/services/provider-pacing.ts"

/**
 * A fake Resend that answers domain requests for acme.com with `status` and records what was
 * asked. Its links go through the link subdomain when `tracked`; a PATCH turns that on, and
 * `failPatch` makes it fail. Asking for a check moves the domain to `afterCheck`.
 */
const fakeResend = (
  initial: string,
  options: { tracked?: boolean; linkStatus?: string; afterCheck?: string; failPatch?: boolean } = {},
) => {
  const calls: Array<string> = []
  let status = initial
  let tracked = options.tracked ?? true
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`)
    if (init?.method === "PATCH") {
      if (options.failPatch) return new Response("unavailable", { status: 503 })
      expect(JSON.parse(String(init.body))).toEqual({
        tracking_subdomain: "links",
        click_tracking: true,
        open_tracking: false,
      })
      tracked = true
    }
    if (url.pathname.endsWith("/verify")) status = options.afterCheck ?? status
    const link = { record: "Tracking", type: "CNAME", name: "links.acme.com", value: "links1.resend-dns.com" }
    return new Response(
      JSON.stringify({
        id: "d_1",
        name: "acme.com",
        status,
        tracking_subdomain: tracked ? "links" : null,
        click_tracking: tracked,
        records: tracked ? [{ ...link, status: options.linkStatus ?? status }] : [],
      }),
      { status: 200 },
    )
  }
  return { calls, fetch }
}

/** TXT DNS records by name, in place of real DNS. */
const fakeDns = (records: Readonly<Record<string, ReadonlyArray<string>>> = {}) =>
  Effect.provideService(TxtLookup, async (name) => {
    const found = records[name]
    if (!found) throw new Error(`no TXT records for ${name}`)
    return found
  })

const useProvider = <A, E, R>(
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  effect: Effect.Effect<A, E, R>,
  wait: Effect.Effect<void, EmailServiceUnavailable> = Effect.void,
  dns: Readonly<Record<string, ReadonlyArray<string>>> = {},
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
    fakeDns(dns),
  )

const verifyDomain = Effect.gen(function* () {
  return yield* (yield* Mailer).domains.verify("d_1")
})

const suggested = {
  type: "TXT",
  name: "_dmarc.acme.com",
  value: "v=DMARC1; p=quarantine;",
  priority: null,
  status: "pending",
}

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
  it.effect("keeps checking a verified domain until its link subdomain is seen, and it stays verified", () => {
    // Right after a check is asked for, Resend can report a verified domain as pending.
    const resend = fakeResend("verified", { linkStatus: "pending", afterCheck: "pending" })
    return useProvider(
      resend.fetch,
      Effect.gen(function* () {
        const domain = yield* (yield* Mailer).domains.verify("d_1")
        expect(resend.calls).toEqual(["GET /domains/d_1", "POST /domains/d_1/verify", "GET /domains/d_1"])
        expect(domain.status).toBe("verified")
      }),
    )
  })
  it.effect("sends links through the link subdomain of a domain added before it (D170)", () => {
    const resend = fakeResend("verified", { tracked: false })
    return useProvider(
      resend.fetch,
      Effect.gen(function* () {
        const domain = yield* (yield* Mailer).domains.verify("d_1")
        expect(resend.calls).toEqual([
          "GET /domains/d_1",
          "PATCH /domains/d_1",
          "POST /domains/d_1/verify",
          "GET /domains/d_1",
        ])
        expect(domain.records.map((record) => record.name)).toEqual(["links.acme.com", "_dmarc.acme.com"])
      }),
    )
  })
  it.effect("adds a domain with its link subdomain, and suggests a DMARC record (D170)", () => {
    const resend = fakeResend("pending", { tracked: false })
    return useProvider(
      resend.fetch,
      Effect.gen(function* () {
        const domain = yield* (yield* Mailer).domains.create("acme.com")
        expect(resend.calls).toEqual(["POST /domains", "PATCH /domains/d_1", "GET /domains/d_1"])
        expect(domain.records.at(-1)).toEqual(suggested)
      }),
    )
  })
  it.effect("returns a domain Resend added even if turning on its link subdomain fails", () => {
    const resend = fakeResend("pending", { tracked: false, failPatch: true })
    return useProvider(
      resend.fetch,
      Effect.gen(function* () {
        const domain = yield* (yield* Mailer).domains.create("acme.com")
        expect(domain.providerId).toBe("d_1")
        expect(domain.records).toEqual([suggested])
      }),
    )
  })
  it.effect("shows a published DMARC record, the domain's own or its organization's, instead of ours", () =>
    Effect.gen(function* () {
      const own = fakeResend("verified")
      const ownDomain = yield* useProvider(own.fetch, verifyDomain, Effect.void, {
        "_dmarc.acme.com": ["v=DMARC1; p=reject;"],
      })
      expect(ownDomain.records.at(-1)).toMatchObject({
        name: "_dmarc.acme.com",
        value: "v=DMARC1; p=reject;",
        status: "verified",
      })
      const subdomain = fakeResend("verified")
      const inherited = yield* useProvider(
        async (input, init) => {
          const response = await subdomain.fetch(input, init)
          const body = (await response.json()) as Record<string, unknown>
          return new Response(JSON.stringify({ ...body, name: "mail.acme.com" }))
        },
        verifyDomain,
        Effect.void,
        { "_dmarc.acme.com": ["v=spf1 nothing", "v=DMARC1; p=none;"] },
      )
      expect(inherited.records.at(-1)).toMatchObject({
        name: "_dmarc.acme.com",
        value: "v=DMARC1; p=none;",
        status: "verified",
      })
    }),
  )
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
