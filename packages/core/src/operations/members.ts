import {
  type acceptInvitation,
  type createInvitation,
  EmailNotVerified,
  type getInvitation,
  type listInvitations,
  type listMembers,
  type OperationInput,
  OwnerChangeNeedsOwner,
  type removeMember,
  type revokeInvitation,
  SignInRequired,
  type updateMember,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberChangeable, proveMemberRemovable } from "../proofs/member-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanManageMembers } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Invitations } from "../services/invitations.ts"
import { Members } from "../services/members.ts"
import { Users } from "../services/users.ts"

export const list = (principal: Principal, input: OperationInput<typeof listMembers>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const members = yield* Members
      const member = yield* proveMemberOf(principal, team)
      return yield* members.people(member)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateMember>) =>
  named(principal, input.teamId, input.userId, (principal, team, user) =>
    Effect.gen(function* () {
      const members = yield* Members
      const member = yield* proveMemberOf(principal, team)
      const canManage = yield* proveCanManageMembers(member)
      const target = yield* proveMemberChangeable(canManage, user, input.role)
      return yield* members.changeRole(target, input.role, canManage)
    }),
  )

/** Removing someone else needs members:manage; leaving needs only membership. */
export const remove = (principal: Principal, input: OperationInput<typeof removeMember>) =>
  named(principal, input.teamId, input.userId, (principal, team, user) =>
    Effect.gen(function* () {
      const members = yield* Members
      const member = yield* proveMemberOf(principal, team)
      const leaving = input.userId === principal.value.userId
      const canManage = leaving ? undefined : yield* proveCanManageMembers(member)
      const target = yield* proveMemberRemovable(member, canManage, user)
      return yield* members.remove(target)
    }),
  )

export const listPending = (principal: Principal, input: OperationInput<typeof listInvitations>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const invitations = yield* Invitations
      const member = yield* proveMemberOf(principal, team)
      const canManage = yield* proveCanManageMembers(member)
      return yield* invitations.list(canManage)
    }),
  )

export const invite = (principal: Principal, input: OperationInput<typeof createInvitation>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const invitations = yield* Invitations
      const member = yield* proveMemberOf(principal, team)
      const canManage = yield* proveCanManageMembers(member)
      const role = input.role ?? "member"
      if (role === "owner" && member.role !== "owner") {
        return yield* new OwnerChangeNeedsOwner({ team: member.teamName })
      }
      return yield* invitations.create(canManage, input.email, role)
    }),
  )

export const revoke = (principal: Principal, input: OperationInput<typeof revokeInvitation>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const invitations = yield* Invitations
      const member = yield* proveMemberOf(principal, team)
      const canManage = yield* proveCanManageMembers(member)
      return yield* invitations.revoke(canManage, input.invitationId)
    }),
  )

/** The invitation is the proof here: it names the person, and only they may see or accept it. */
const recipient = (principal: Principal, action: "accept an invitation") =>
  Effect.gen(function* () {
    if (principal._tag !== "UserSession") return yield* new SignInRequired({ action })
    const users = yield* Users
    const user = yield* users.find(principal.userId)
    if (!user) return yield* Effect.die("signed-in user has no user record")
    return { id: principal.userId, email: user.email, emailVerified: user.emailVerified }
  })

export const get = (principal: Principal, input: OperationInput<typeof getInvitation>) =>
  Effect.gen(function* () {
    const invitations = yield* Invitations
    const users = yield* Users
    const user = yield* users.find(principal.userId)
    if (!user) return yield* Effect.die("principal has no user record")
    return yield* invitations.forRecipient(input.invitationId, user.email)
  })

export const accept = (principal: Principal, input: OperationInput<typeof acceptInvitation>) =>
  Effect.gen(function* () {
    const invitations = yield* Invitations
    const user = yield* recipient(principal, "accept an invitation")
    yield* invitations.forRecipient(input.invitationId, user.email)
    // The invitation names an address; only someone who proved they own it may take it.
    if (!user.emailVerified) return yield* new EmailNotVerified()
    return yield* invitations.accept(input.invitationId, user)
  })
