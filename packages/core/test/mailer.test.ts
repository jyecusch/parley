import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { Mailer } from "../src/mail/mailer.ts"

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

const withResend = (status: string) => {
  const resend = fakeResend(status)
  const layer = Mailer.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ RESEND_API_KEY: "re_test" }))),
  )
  return { resend, layer }
}

describe("Mailer with Resend", () => {
  it.effect("leaves a verified sending domain alone instead of starting a new DNS check", () => {
    const { resend, layer } = withResend("verified")
    const original = globalThis.fetch
    globalThis.fetch = resend.fetch as typeof fetch
    return Effect.gen(function* () {
      const mailer = yield* Mailer
      const domain = yield* mailer.domains.verify("d_1")
      expect(domain.status).toBe("verified")
      expect(resend.calls).toEqual(["GET /domains/d_1"])
    }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(() => (globalThis.fetch = original))))
  })

  it.effect("asks Resend to check the DNS records of a domain that isn't verified yet", () => {
    const { resend, layer } = withResend("pending")
    const original = globalThis.fetch
    globalThis.fetch = resend.fetch as typeof fetch
    return Effect.gen(function* () {
      const mailer = yield* Mailer
      const domain = yield* mailer.domains.verify("d_1")
      expect(domain.status).toBe("pending")
      expect(resend.calls).toEqual(["GET /domains/d_1", "POST /domains/d_1/verify", "GET /domains/d_1"])
    }).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(() => (globalThis.fetch = original))))
  })
})
