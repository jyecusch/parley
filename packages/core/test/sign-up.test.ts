import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { domainMaySignUp, signUpDomainsOf } from "../src/auth/sign-up-policy.ts"
import { BetterAuth, CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("who may sign up (D163)", () => {
  it("reads the allowed domains: a list, any, or none", () => {
    const listed = signUpDomainsOf(" Nitric.io, @suga.app ,")
    expect(domainMaySignUp(listed, "sam@nitric.io")).toBe(true)
    expect(domainMaySignUp(listed, "SAM@SUGA.APP")).toBe(true)
    expect(domainMaySignUp(listed, "sam@gmail.com")).toBe(false)
    // A subdomain or a look-alike isn't the domain.
    expect(domainMaySignUp(listed, "sam@mail.nitric.io")).toBe(false)
    expect(domainMaySignUp(listed, "sam@nitric.io.evil.example")).toBe(false)
    expect(domainMaySignUp(signUpDomainsOf("*"), "sam@gmail.com")).toBe(true)
    expect(domainMaySignUp(signUpDomainsOf(""), "sam@nitric.io")).toBe(false)
  })

  // The tests' server allows example.com (vitest.config.ts).
  it.effect("refuses other domains unless invited, and nobody signs in before confirming", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const auth = yield* BetterAuth
      const tag = crypto.randomUUID().slice(0, 8)
      const signUp = (email: string) =>
        Effect.tryPromise({
          try: () => auth.api.signUpEmail({ body: { name: "Sam", email, password: "correct-horse-battery" } }),
          catch: (error) => error as { readonly body?: { readonly code?: string } },
        })
      const signIn = (email: string) =>
        Effect.tryPromise({
          // signInEmail isn't on our narrowed Auth type; the web app calls it the same way.
          try: () =>
            (
              auth.api as unknown as {
                signInEmail: (input: {
                  body: { email: string; password: string }
                }) => Promise<{ readonly token: string }>
              }
            ).signInEmail({ body: { email, password: "correct-horse-battery" } }),
          catch: (error) => error as { readonly body?: { readonly code?: string } },
        })

      const stranger = `sam-${tag}@elsewhere.test`
      // Refused the way Better-Auth answers an address that has an account: it looks like it
      // worked, and no account is made, so there's nothing to sign in to.
      yield* signUp(stranger)
      expect((yield* Effect.flip(signIn(stranger))).body?.code).toBe("INVALID_EMAIL_OR_PASSWORD")

      // An invitation lets that address make an account, which still has to confirm it.
      yield* run["invitations.create"](f.jane, { teamId: f.acme, email: stranger as never })
      yield* signUp(stranger)
      expect((yield* Effect.flip(signIn(stranger))).body?.code).toBe("EMAIL_NOT_VERIFIED")

      // On an allowed domain, signing up needs no invitation, and confirming still comes first.
      const colleague = `ana-${tag}@example.com`
      yield* signUp(colleague)
      expect((yield* Effect.flip(signIn(colleague))).body?.code).toBe("EMAIL_NOT_VERIFIED")
    }).pipe(Effect.provide(CoreLive)),
  )
})
