import { describe, expect, it } from "@effect/vitest"
import { type ApiKeyId, type ContactId, createContact, type Permission, type TeamId, type UserId } from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect, Schema } from "effect"
import { BetterAuth, CoreLive, classifyDecodeError, implementations, type Principal } from "../src/index.ts"

const promise = <A>(thunk: () => Promise<A>) => Effect.tryPromise(thunk).pipe(Effect.orDie)

/** Two users, two teams. Jane owns Acme; Bob owns Globex. */
const Fixture = Effect.gen(function* () {
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
  const session = (userId: string, name: string): Principal => ({
    _tag: "UserSession",
    userId: userId as UserId,
    name: DisplayName.fromRecord(name),
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
    janeReadOnlyKey: apiKey(jane.user.id, acme?.id ?? "", ["records:read"]),
    janeKeyForGlobex: apiKey(jane.user.id, globex?.id ?? "", ["records:read", "records:write"]),
  }
})

const run = implementations

describe("contacts operations", () => {
  it.effect("create, read, update, delete and restore, with activity attributed to the principal", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const created = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Sam",
        lastName: "Lee",
        emails: [{ address: "Sam@Northwind.io" as never }],
      })
      expect(created.displayName).toBe("Sam Lee")
      expect(created.emails).toEqual([{ address: "sam@northwind.io", isPrimary: true }])

      const updated = yield* run["contacts.update"](f.jane, {
        teamId: f.acme,
        contactId: created.id,
        lastName: "Leigh",
      })
      expect(updated.displayName).toBe("Sam Leigh")

      const page = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: "northwind" })
      expect(page.items.map((c) => c.id)).toContain(created.id)

      const deleted = yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: created.id })
      expect(deleted.deletedAt).not.toBeNull()
      const gone = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: created.id }).pipe(Effect.flip)
      expect(gone._tag).toBe("ContactNotFound")

      // Deleting released the email, so it can be reused...
      const reuser = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        emails: [{ address: "sam@northwind.io" as never }],
      })
      // ...which blocks restoring the original until it's freed again.
      const blocked = yield* run["contacts.restore"](f.jane, { teamId: f.acme, contactId: created.id }).pipe(
        Effect.flip,
      )
      expect(blocked._tag).toBe("ContactEmailTaken")
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: reuser.id })
      const restored = yield* run["contacts.restore"](f.jane, { teamId: f.acme, contactId: created.id })
      expect(restored.deletedAt).toBeNull()
      // Restoring a live contact is idempotent (D67).
      const again = yield* run["contacts.restore"](f.jane, { teamId: f.acme, contactId: created.id })
      expect(again.id).toBe(created.id)

      const activity = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: created.id })
      expect(activity.map((a) => a.kind)).toEqual(["created", "updated", "deleted", "restored"])
      expect(activity[0]?.actorName).toBe("Jane")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("rejects a duplicate email with ContactEmailTaken naming the existing contact", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const first = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Priya",
        emails: [{ address: "priya@helio.co" as never }],
      })
      const error = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        emails: [{ address: "PRIYA@helio.co" as never }],
      }).pipe(Effect.flip)
      expect(error._tag).toBe("ContactEmailTaken")
      if (error._tag === "ContactEmailTaken") {
        expect(error.existing).toBe(first.id)
        expect(error.userMessage).toBe(
          "priya@helio.co is already used by Priya in Acme. Open Priya to update it there, or use a different email.",
        )
      }
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("never reveals another team's contacts or teams", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const secret = yield* run["contacts.create"](f.bob, { teamId: f.globex, firstName: "Hidden" })
      // Jane asks for Globex's contact through Acme: not found, as if it didn't exist (D37).
      const crossTeam = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: secret.id }).pipe(Effect.flip)
      expect(crossTeam._tag).toBe("ContactNotFound")
      // Jane asks Globex directly: not a member, and the same answer as a team that doesn't exist (D35).
      const other = yield* run["contacts.list"](f.jane, { teamId: f.globex }).pipe(Effect.flip)
      const missing = yield* run["contacts.list"](f.jane, { teamId: "no-such-team" as TeamId }).pipe(Effect.flip)
      expect(other._tag).toBe("NotATeamMember")
      expect(missing._tag).toBe("NotATeamMember")
      expect(other.userMessage).toBe(missing.userMessage)
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("limits API keys to their scopes and their team", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const list = yield* run["contacts.list"](f.janeReadOnlyKey, { teamId: f.acme })
      expect(Array.isArray(list.items)).toBe(true)
      const write = yield* run["contacts.create"](f.janeReadOnlyKey, { teamId: f.acme, firstName: "Nope" }).pipe(
        Effect.flip,
      )
      expect(write._tag).toBe("ApiKeyScopeExcludes")
      expect(write.userMessage).toBe(
        "This API key can't change contacts and companies in Acme. Whoever created the API key can create one that can.",
      )
      const wrongTeam = yield* run["contacts.list"](f.janeKeyForGlobex, { teamId: f.acme }).pipe(Effect.flip)
      expect(wrongTeam._tag).toBe("ApiKeyNotValidForTeam")
      const teams = yield* run["teams.list"](f.janeReadOnlyKey, {})
      expect(teams.map((t) => t.id)).toEqual([f.acme])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("rejects input in our own words, field by field", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const empty = yield* run["contacts.create"](f.jane, { teamId: f.acme }).pipe(Effect.flip)
      expect(empty._tag).toBe("InputRejected")
      expect(empty.userMessage).toBe("Add a name or an email so you can find this contact again.")

      const decodeFailure = yield* Schema.decodeUnknownEffect(createContact.input)(
        { teamId: f.acme, firstName: "", emails: [{ address: "not-an-email" }], phones: [{ number: "0400" }] },
        { errors: "all" },
      ).pipe(Effect.flip)
      const error = classifyDecodeError(decodeFailure)
      expect(error.problems.map((p) => [p.field, p.problem, p.userMessage])).toEqual([
        ["firstName", "too-short", "First name is too short."],
        ["emails.0.address", "invalid-format", "Email isn't in a valid format."],
        ["phones.0.number", "invalid-format", "Phone isn't in a valid format."],
      ])
      expect(error.userMessage).toBe("3 fields need fixing before this can be saved.")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("keeps ids opaque: an unknown id is simply not found", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const error = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: "not-a-uuid" as ContactId }).pipe(
        Effect.flip,
      )
      expect(error._tag).toBe("ContactNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )
})
