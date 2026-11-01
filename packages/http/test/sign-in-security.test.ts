import { base32 } from "@better-auth/utils/base32"
import { createOTP } from "@better-auth/utils/otp"
import { afterAll, describe, expect, it } from "@effect/vitest"
import { CoreLive, Users } from "@parley/core"
import type { UserId } from "@parley/domain"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ApiRoutesLive, AuthRoutesLive, FailureResponsesLive, FileRoutesLive } from "../src/index.ts"

const AppLive = Layer.mergeAll(ApiRoutesLive, AuthRoutesLive, FileRoutesLive, FailureResponsesLive).pipe(
  Layer.provide(CoreLive),
  Layer.provide(HttpServer.layerServices),
)
const { handler, dispose } = HttpRouter.toWebHandler(AppLive, { disableLogger: true })
const runtime = ManagedRuntime.make(CoreLive)
afterAll(async () => {
  await dispose()
  await runtime.dispose()
})

const base = "http://localhost:3000"
const STRONG = "correct-horse-battery"

/** A browser of its own: it keeps the cookies the server sets, as one would. */
const browser = () => {
  const jar = new Map<string, string>()
  return async (path: string, body?: unknown) => {
    const response = await handler(
      new Request(`${base}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin: base,
          cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";")
      const at = pair.indexOf("=")
      const value = pair.slice(at + 1)
      if (/max-age=0/i.test(line) || value === "") jar.delete(pair.slice(0, at))
      else jar.set(pair.slice(0, at), value)
    }
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : undefined }
  }
}

/** A confirmed account, signed in, in its own browser. */
const account = async () => {
  const email = `sam-${crypto.randomUUID().slice(0, 8)}@example.com`
  const request = browser()
  const signedUp = await request("/sign-up/email", { name: "Sam Rivera", email, password: STRONG })
  expect(signedUp.status).toBe(200)
  await runtime.runPromise(
    Effect.gen(function* () {
      yield* (yield* Users).markEmailVerified(signedUp.body.user.id as UserId)
    }),
  )
  expect((await request("/sign-in/email", { email, password: STRONG })).status).toBe(200)
  return { email, request }
}

/** The code an authenticator app would show now, from the setup link it scanned. */
const codeFor = (totpURI: string) =>
  createOTP(new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get("secret") ?? ""))).totp()

describe("sign-in security (D172)", () => {
  it("refuses a new password below Good, at sign-up and when changing it", async () => {
    const request = browser()
    const weak = await request("/sign-up/email", {
      name: "Sam Rivera",
      email: `sam-${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: "Password1!",
    })
    expect(weak.status).toBe(400)
    expect(weak.body.code).toBe("PASSWORD_TOO_WEAK")

    const { email, request: signedIn } = await account()
    // Your own email address is an easy guess.
    const personal = await signedIn("/change-password", { currentPassword: STRONG, newPassword: `${email}1` })
    expect(personal.body.code).toBe("PASSWORD_TOO_WEAK")
    const changed = await signedIn("/change-password", {
      currentPassword: STRONG,
      newPassword: "tangerine otter lamp 47",
    })
    expect(changed.status).toBe(200)
  })

  it("asks for a code after the password once two-factor authentication is on", async () => {
    const { email, request } = await account()
    const setup = await request("/two-factor/enable", { password: STRONG })
    expect(setup.status).toBe(200)
    // Not on until a code from the app proves it's set up.
    expect((await request("/get-session")).body.user.twoFactorEnabled).toBe(false)
    expect((await request("/two-factor/verify-totp", { code: await codeFor(setup.body.totpURI) })).status).toBe(200)
    expect((await request("/get-session")).body.user.twoFactorEnabled).toBe(true)

    // A fresh browser: the password alone isn't enough.
    const other = browser()
    const password = await other("/sign-in/email", { email, password: STRONG })
    expect(password.body.twoFactorRedirect).toBe(true)
    expect((await other("/get-session")).body).toBeNull()
    expect((await other("/two-factor/verify-totp", { code: "000000" })).body.code).toBe("INVALID_CODE")
    expect((await other("/two-factor/verify-totp", { code: await codeFor(setup.body.totpURI) })).status).toBe(200)
    expect((await other("/get-session")).body.user.email).toBe(email)

    // A backup code works once.
    const [backup] = setup.body.backupCodes as Array<string>
    const lost = browser()
    await lost("/sign-in/email", { email, password: STRONG })
    expect((await lost("/two-factor/verify-backup-code", { code: backup })).status).toBe(200)
    const again = browser()
    await again("/sign-in/email", { email, password: STRONG })
    expect((await again("/two-factor/verify-backup-code", { code: backup })).body.code).toBe("INVALID_BACKUP_CODE")
  })
})
