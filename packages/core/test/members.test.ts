import { describe, expect, it } from "@effect/vitest"
import type { InvitationId, UserId } from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { BetterAuth, CoreLive, Mailer, type Principal, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

/** Signs someone up and, unless told not to, follows the link in their verification email. */
const signUp = (name: string, email: string, verify = true) =>
  Effect.gen(function* () {
    const auth = yield* BetterAuth
    const mailer = yield* Mailer
    const created = yield* Effect.tryPromise(() =>
      auth.api.signUpEmail({ body: { name, email, password: "correct-horse-battery" } }),
    ).pipe(Effect.orDie)
    if (verify) {
      const sent = (yield* mailer.outbox).findLast((message) => message.to === email)
      const token = new URL(sent?.text.match(/https?:\/\/\S+/)?.[0] ?? "http://x").searchParams.get("token") ?? ""
      // verifyEmail isn't on our narrowed Auth type; tests call it the way the emailed link does.
      const api = auth.api as unknown as { verifyEmail: (input: { query: { token: string } }) => Promise<unknown> }
      yield* Effect.tryPromise(() => api.verifyEmail({ query: { token } })).pipe(Effect.orDie)
    }
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
        ["Sam", "member"],
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

  it.effect("only an owner can authorize an owner invitation", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* run["members.update"](f.jane, { teamId: f.acme, userId: f.sam.userId, role: "admin" })
      const email = `owner-${crypto.randomUUID()}@example.com`
      const refused = yield* run["invitations.create"](f.sam, {
        teamId: f.acme,
        email: email as never,
        role: "owner",
      }).pipe(Effect.flip)
      expect(refused._tag).toBe("OwnerChangeNeedsOwner")
      expect(yield* run["invitations.list"](f.jane, { teamId: f.acme })).toEqual([])
      const invited = yield* run["invitations.create"](f.jane, { teamId: f.acme, email: email as never, role: "owner" })
      expect(invited).toMatchObject({ email, role: "owner", status: "pending" })
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
      const owner = yield* run["members.update"](f.jane, { teamId: f.acme, userId: bot.id, role: "owner" }).pipe(
        Effect.flip,
      )
      // Service accounts aren't people, so member changes can't reach them at all.
      expect(["MemberNotFound", "ServiceAccountCannotBeOwner"]).toContain(owner._tag)
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

  it.effect("lists invitations only for a confirmed address; accepting from the link confirms it", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const email = `unconfirmed-${crypto.randomUUID().slice(0, 8)}@example.com`
      const invitation = yield* run["invitations.create"](f.jane, {
        teamId: f.acme,
        email: email as never,
        role: "admin",
      })
      const newcomer = yield* signUp("Newcomer", email, false)
      // Not confirmed yet: nothing is listed, so signing up with someone's address reveals nothing (D131).
      expect(yield* run["invitations.mine"](newcomer, {})).toEqual([])
      // The link went to this address, so accepting from it confirms the address (D130).
      const joined = yield* run["invitations.accept"](newcomer, { invitationId: invitation.id })
      expect(joined.id).toBe(f.acme)
      expect(yield* run["invitations.mine"](newcomer, {})).toEqual([])

      // A confirmed person sees what's pending, and can decline it.
      const other = `invited-${crypto.randomUUID().slice(0, 8)}@example.com`
      const second = yield* run["invitations.create"](f.jane, { teamId: f.acme, email: other as never, role: "member" })
      const invited = yield* signUp("Invited", other, true)
      expect((yield* run["invitations.mine"](invited, {})).map((entry) => entry.id)).toEqual([second.id])
      const declined = yield* run["invitations.decline"](invited, { invitationId: second.id })
      expect(declined.status).toBe("declined")
      expect(yield* run["invitations.mine"](invited, {})).toEqual([])
      const again = yield* run["invitations.decline"](invited, { invitationId: second.id }).pipe(Effect.flip)
      expect(again._tag).toBe("InvitationNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("an API key or agent can't make its person leave, or revoke their other credentials", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const leave = yield* run["members.remove"](f.janeReadOnlyKey, {
        teamId: f.acme,
        userId: f.jane.userId,
      }).pipe(Effect.flip)
      expect(leave).toMatchObject({ _tag: "SignInRequired", action: "leave a team" })
      const revoke = yield* run["apiKeys.revoke"](f.janeReadOnlyKey, {
        teamId: f.acme,
        apiKeyId: "some-other-key" as never,
      }).pipe(Effect.flip)
      expect(revoke).toMatchObject({ _tag: "SignInRequired", action: "revoke an API key" })
    }).pipe(Effect.provide(CoreLive)),
  )
})
