import { describe, expect, it } from "@effect/vitest"
import type { InvitationId, UserId } from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { BetterAuth, CoreLive, Mailer, type Principal, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

const signUp = (name: string, email: string) =>
  Effect.gen(function* () {
    const auth = yield* BetterAuth
    const created = yield* Effect.tryPromise(() =>
      auth.api.signUpEmail({ body: { name, email, password: "correct-horse-battery" } }),
    ).pipe(Effect.orDie)
    const principal: Principal = {
      _tag: "UserSession",
      userId: created.user.id as UserId,
      name: DisplayName.fromRecord(name),
      sessionId: `test-${created.user.id}`,
    }
    return principal
  })

describe("members and invitations", () => {
  it.effect("invites by email, accepts, changes roles, and always keeps an owner", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const mailer = yield* Mailer
      const email = `max-${crypto.randomUUID().slice(0, 8)}@example.com`
      const invitation = yield* run["invitations.create"](f.jane, { teamId: f.acme, email: email as never })
      expect(invitation).toMatchObject({
        email,
        role: "member",
        status: "pending",
        invitedBy: "Jane",
        teamName: "Acme",
      })
      const sent = (yield* mailer.outbox).find((message) => message.to === email)
      expect(sent?.subject).toBe("Jane invited you to Acme on Parley")
      expect(sent?.text).toContain(`/invite/${invitation.id}`)

      // Only the person it was sent to can see or accept it.
      const outsider = yield* run["invitations.get"](f.bob, { invitationId: invitation.id }).pipe(Effect.flip)
      expect(outsider._tag).toBe("InvitationForAnotherEmail")
      const max = yield* signUp("Max", email)
      const seen = yield* run["invitations.get"](max, { invitationId: invitation.id })
      expect(seen.teamName).toBe("Acme")
      const joined = yield* run["invitations.accept"](max, { invitationId: invitation.id })
      expect(joined).toMatchObject({ id: f.acme, role: "member" })
      const again = yield* run["invitations.accept"](max, { invitationId: invitation.id }).pipe(Effect.flip)
      expect(again).toMatchObject({ _tag: "InvitationExpired", used: true })
      const already = yield* run["invitations.create"](f.jane, { teamId: f.acme, email: email as never }).pipe(
        Effect.flip,
      )
      expect(already._tag).toBe("AlreadyAMember")

      const people = yield* run["members.list"](f.jane, { teamId: f.acme })
      expect(people.map((member) => [member.name, member.role])).toEqual([
        ["Jane", "owner"],
        ["Max", "member"],
      ])

      // A member can't manage members; an admin can't touch owners.
      const notAdmin = yield* run["members.update"](max, { teamId: f.acme, userId: max.userId, role: "admin" }).pipe(
        Effect.flip,
      )
      expect(notAdmin._tag).toBe("RoleLacksPermission")
      yield* run["members.update"](f.jane, { teamId: f.acme, userId: max.userId, role: "admin" })
      const selfPromote = yield* run["members.update"](max, { teamId: f.acme, userId: max.userId, role: "owner" }).pipe(
        Effect.flip,
      )
      expect(selfPromote._tag).toBe("OwnerChangeNeedsOwner")
      const removeOwner = yield* run["members.remove"](max, { teamId: f.acme, userId: f.jane.userId }).pipe(Effect.flip)
      expect(removeOwner._tag).toBe("OwnerChangeNeedsOwner")

      // The last owner can't step down or leave (D36).
      const lastOwner = yield* run["members.update"](f.jane, {
        teamId: f.acme,
        userId: f.jane.userId,
        role: "admin",
      }).pipe(Effect.flip)
      expect(lastOwner._tag).toBe("LastOwner")
      const leave = yield* run["members.remove"](f.jane, { teamId: f.acme, userId: f.jane.userId }).pipe(Effect.flip)
      expect(leave._tag).toBe("LastOwner")
      yield* run["members.update"](f.jane, { teamId: f.acme, userId: max.userId, role: "owner" })
      yield* run["members.remove"](f.jane, { teamId: f.acme, userId: f.jane.userId })
      const gone = yield* run["contacts.list"](f.jane, { teamId: f.acme }).pipe(Effect.flip)
      expect(gone._tag).toBe("NotATeamMember")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("revoked invitations stop working; only owners invite owners", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const email = `zoe-${crypto.randomUUID().slice(0, 8)}@example.com`
      const invitation = yield* run["invitations.create"](f.jane, {
        teamId: f.acme,
        email: email as never,
        role: "admin",
      })
      const pending = yield* run["invitations.list"](f.jane, { teamId: f.acme })
      expect(pending.map((entry) => entry.id)).toContain(invitation.id)
      yield* run["invitations.revoke"](f.jane, { teamId: f.acme, invitationId: invitation.id })
      const zoe = yield* signUp("Zoe", email)
      const revoked = yield* run["invitations.accept"](zoe, { invitationId: invitation.id }).pipe(Effect.flip)
      expect(revoked._tag).toBe("InvitationNotFound")
      const missing = yield* run["invitations.get"](zoe, { invitationId: crypto.randomUUID() as InvitationId }).pipe(
        Effect.flip,
      )
      expect(missing._tag).toBe("InvitationNotFound")
      const viaKey = yield* run["invitations.accept"](f.janeReadOnlyKey, { invitationId: invitation.id }).pipe(
        Effect.flip,
      )
      expect(viaKey._tag).toBe("SignInRequired")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("team settings and service accounts", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const renamed = yield* run["teams.update"](f.jane, { teamId: f.acme, name: "Acme Inc", gravatar: true })
      expect(renamed).toMatchObject({ name: "Acme Inc", gravatar: true, role: "owner" })
      const teams = yield* run["teams.list"](f.jane, {})
      expect(teams.find((team) => team.id === f.acme)).toMatchObject({ name: "Acme Inc", gravatar: true })
      const denied = yield* run["teams.update"](f.janeReadOnlyKey, { teamId: f.acme, name: "Nope" }).pipe(Effect.flip)
      expect(denied._tag).toBe("ApiKeyScopeExcludes")

      const bot = yield* run["serviceAccounts.create"](f.jane, { teamId: f.acme, name: "Sync bot" })
      const updated = yield* run["serviceAccounts.update"](f.jane, {
        teamId: f.acme,
        serviceAccountId: bot.id,
        name: "Import bot",
        role: "admin",
      })
      expect(updated).toMatchObject({ name: "Import bot", role: "admin" })
      yield* run["serviceAccounts.delete"](f.jane, { teamId: f.acme, serviceAccountId: bot.id })
      const left = yield* run["serviceAccounts.list"](f.jane, { teamId: f.acme })
      expect(left.map((account) => account.id)).not.toContain(bot.id)
      // People aren't service accounts, and vice versa.
      const notABot = yield* run["serviceAccounts.delete"](f.jane, {
        teamId: f.acme,
        serviceAccountId: f.jane.userId,
      }).pipe(Effect.flip)
      expect(notABot._tag).toBe("ServiceAccountNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )
})
