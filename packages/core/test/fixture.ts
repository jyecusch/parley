import type { ApiKeyId, Permission, TeamId, UserId } from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { BetterAuth, type Principal } from "../src/index.ts"

const promise = <A>(thunk: () => Promise<A>) => Effect.tryPromise(thunk).pipe(Effect.orDie)

/** Three users, two teams. Jane owns Acme; Bob owns Globex; Sam is a member of Acme. */
export const Fixture = Effect.gen(function* () {
  const auth = yield* BetterAuth
  const suffix = crypto.randomUUID().slice(0, 8)
  const signUp = (name: string) =>
    promise(() =>
      auth.api.signUpEmail({
        body: { name, email: `${name.toLowerCase()}-${suffix}@example.com`, password: "correct-horse-battery" },
      }),
    )
  const team = (name: string, userId: string) =>
    promise(() => auth.api.createOrganization({ body: { name, slug: `${name.toLowerCase()}-${suffix}`, userId } }))
  const jane = yield* signUp("Jane")
  const bob = yield* signUp("Bob")
  const acme = yield* team("Acme", jane.user.id)
  const globex = yield* team("Globex", bob.user.id)
  const sam = yield* signUp("Sam")
  // Better-Auth's addMember isn't on our narrowed Auth type; tests use it to seed a member directly.
  const api = auth.api as unknown as {
    addMember: (input: { body: { userId: string; organizationId: string; role: string } }) => Promise<unknown>
  }
  yield* promise(() => api.addMember({ body: { userId: sam.user.id, organizationId: acme?.id ?? "", role: "member" } }))
  const session = (userId: string, name: string): Principal => ({
    _tag: "UserSession",
    userId: userId as UserId,
    name: DisplayName.fromRecord(name),
    sessionId: `test-session-${userId}`,
  })
  const apiKey = (userId: string, teamId: string, scopes: ReadonlyArray<Permission>): Principal => ({
    _tag: "UserApiKey",
    userId: userId as UserId,
    name: DisplayName.fromRecord("Jane"),
    apiKeyId: "key_test" as ApiKeyId,
    apiKeyName: "Claude on my laptop",
    teamId: teamId as TeamId,
    scopes: new Set(scopes),
  })
  return {
    acme: (acme?.id ?? "") as TeamId,
    globex: (globex?.id ?? "") as TeamId,
    jane: session(jane.user.id, "Jane"),
    bob: session(bob.user.id, "Bob"),
    sam: session(sam.user.id, "Sam"),
    janeReadOnlyKey: apiKey(jane.user.id, acme?.id ?? "", ["records:read"]),
    janeKeyForGlobex: apiKey(jane.user.id, globex?.id ?? "", ["records:read", "records:write"]),
  }
})
