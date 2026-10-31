import {
  type acceptInvitation,
  type createInvitation,
  type declineInvitation,
  type getInvitation,
  type listInvitations,
  type listMembers,
  type myInvitations,
  type OperationInput,
  type removeMember,
  type revokeInvitation,
  SignInRequired,
  type updateMember,
} from "@parley/domain"
import { Effect } from "effect"
import { Mailer } from "../mail/mailer.ts"
import type { Principal } from "../principal.ts"
import { proveMemberChangeable, proveMemberInvitable, proveMemberRemovable } from "../proofs/member-changes.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanManageMembers } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Invitations } from "../services/invitations.ts"
import { MemberChanges } from "../services/member-changes.ts"
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
  named(principal, input.userId, (principal, user) =>
    Effect.gen(function* () {
      const changes = yield* MemberChanges
      const members = yield* Members
      return yield* changes.inTeam(input.teamId, (transaction) =>
        Effect.gen(function* () {
          const member = yield* proveMemberOf(principal, transaction.team)
          const canManage = yield* proveCanManageMembers(member)
          const target = yield* proveMemberChangeable(canManage, user, input.role)
          return yield* members.changeRole(transaction, target)
        }),
      )
    }),
  )

/** remove allows a signed-in user to leave; removing another member requires members:manage. */
export const remove = (principal: Principal, input: OperationInput<typeof removeMember>) =>
  named(principal, input.userId, (principal, user) =>
    Effect.gen(function* () {
      const changes = yield* MemberChanges
      const members = yield* Members
      return yield* changes.inTeam(input.teamId, (transaction) =>
        Effect.gen(function* () {
          const member = yield* proveMemberOf(principal, transaction.team)
          const target = yield* proveMemberRemovable(member, user)
          return yield* members.remove(transaction, target)
        }),
      )
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
  named(principal, (principal) =>
    Effect.gen(function* () {
      const changes = yield* MemberChanges
      const invitations = yield* Invitations
      const mailer = yield* Mailer
      const created = yield* changes.inTeam(input.teamId, (transaction) =>
        Effect.gen(function* () {
          const member = yield* proveMemberOf(principal, transaction.team)
          const canManage = yield* proveCanManageMembers(member)
          const invitation = yield* proveMemberInvitable(canManage, input.role ?? "member")
          return yield* invitations.create(transaction, invitation, input.email)
        }),
      )
      yield* mailer.send(created.email)
      return created.invitation
    }),
  )

export const revoke = (principal: Principal, input: OperationInput<typeof revokeInvitation>) =>
  named(principal, (principal) =>
    Effect.gen(function* () {
      const changes = yield* MemberChanges
      const invitations = yield* Invitations
      return yield* changes.inTeam(input.teamId, (transaction) =>
        Effect.gen(function* () {
          const member = yield* proveMemberOf(principal, transaction.team)
          const canManage = yield* proveCanManageMembers(member)
          return yield* invitations.revoke(transaction, canManage, input.invitationId)
        }),
      )
    }),
  )

/** The invitation is the proof here: it names the person, and only they may see or accept it. */
const recipient = (
  principal: Principal,
  action: "accept an invitation" | "see your invitations" | "decline an invitation",
) =>
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
    const users = yield* Users
    const user = yield* recipient(principal, "accept an invitation")
    yield* invitations.forRecipient(input.invitationId, user.email)
    // The invitation's link was sent to this address, so following it proves the person owns it,
    // as a confirmation link would (D130).
    if (!user.emailVerified) yield* users.markEmailVerified(user.id)
    return yield* invitations.accept(input.invitationId, user)
  })

/** Invitations waiting for the signed-in person, only once their address is confirmed (D131). */
export const mine = (principal: Principal, _input: OperationInput<typeof myInvitations>) =>
  Effect.gen(function* () {
    const invitations = yield* Invitations
    const user = yield* recipient(principal, "see your invitations")
    if (!user.emailVerified) return []
    return yield* invitations.pendingFor(user.email)
  })

export const decline = (principal: Principal, input: OperationInput<typeof declineInvitation>) =>
  Effect.gen(function* () {
    const invitations = yield* Invitations
    const user = yield* recipient(principal, "decline an invitation")
    return yield* invitations.decline(input.invitationId, user.email)
  })
