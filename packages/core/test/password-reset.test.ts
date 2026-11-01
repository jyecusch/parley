import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { BetterAuth, CoreLive, implementations as run } from "../src/index.ts"
import { Mailer } from "../src/mail/mailer.ts"
import { Fixture } from "./fixture.ts"

const BASE = process.env.PORTLESS_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

describe("resetting a forgotten password (D172)", () => {
  it.effect("emails a link that sets a good password once, and never for a service account", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const auth = yield* BetterAuth
      const mailer = yield* Mailer
      const request = (path: string, body?: unknown) =>
        Effect.tryPromise(async () => {
          const response = await auth.handler(
            new Request(`${BASE}/api/auth${path}`, {
              method: body === undefined ? "GET" : "POST",
              headers: { "content-type": "application/json", origin: BASE },
              redirect: "manual",
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
          )
          const text = await response.text()
          return {
            status: response.status,
            location: response.headers.get("location"),
            body: text.startsWith("{") ? JSON.parse(text) : undefined,
          }
        }).pipe(Effect.orDie)
      const sentTo = (to: string) =>
        mailer.outbox.pipe(Effect.map((sent) => sent.filter((message) => message.to === to)))
      // Jane's address, from the confirmation email her sign-up sent.
      const jane = (yield* mailer.outbox).findLast((message) => message.to.startsWith("jane-"))?.to ?? ""
      expect(jane).not.toBe("")

      expect((yield* request("/request-password-reset", { email: jane, redirectTo: "/reset-password" })).status).toBe(
        200,
      )
      const [message] = (yield* sentTo(jane)).filter((sent) => sent.subject === "Reset your Parley password")
      const link = message?.text.match(/https?:\/\/\S+\/reset-password\/\S+/)?.[0] ?? ""
      expect(link).not.toBe("")

      // The link checks the token, then opens the page with it.
      const opened = yield* request(new URL(link).pathname.replace("/api/auth", "") + new URL(link).search)
      const token = new URL(opened.location ?? "", BASE).searchParams.get("token") ?? ""
      expect(token).not.toBe("")

      const weak = yield* request("/reset-password", { token, newPassword: "Password1!" })
      expect(weak.body.code).toBe("PASSWORD_TOO_WEAK")
      // However the token arrives, Better-Auth checks it and the password goes through the same rule.
      const emptyBody = yield* request(`/reset-password?token=${token}`, { token: "", newPassword: "Password1!" })
      expect(emptyBody.body.code).toBe("PASSWORD_TOO_WEAK")
      expect((yield* request("/reset-password", { token, newPassword: "tangerine otter lamp 47" })).status).toBe(200)
      // Once only.
      const again = yield* request("/reset-password", { token, newPassword: "violet canyon spoon 81" })
      expect(again.body.code).toBe("INVALID_TOKEN")

      // A service account's address gets the same answer, and no email.
      const bot = yield* run["serviceAccounts.create"](f.jane, { teamId: f.acme, name: "Reset bot" })
      const botEmail = `${bot.id}@service-accounts.parley.invalid`
      expect(
        (yield* request("/request-password-reset", { email: botEmail, redirectTo: "/reset-password" })).status,
      ).toBe(200)
      expect(yield* sentTo(botEmail)).toEqual([])
    }).pipe(Effect.provide(CoreLive)),
  )
})
