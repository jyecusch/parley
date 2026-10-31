import {
  type DatabaseUnavailable,
  type Member,
  MemberNotFound,
  OwnerChangeNeedsOwner,
  type Role,
  ServiceAccountCannotBeOwner,
  SignInRequired,
  type TeamId,
  type UserId,
} from "@parley/domain"
import type { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Members } from "../services/members.ts"
import { Users } from "../services/users.ts"
import type { MemberOf } from "./member-of.ts"
import type { CanManageMembers } from "./permissions.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const MemberChangeableProver = defineProof("MemberChangeable")
const MemberRemovableProver = defineProof("MemberRemovable")
const MemberInvitableProver = defineProof("MemberInvitable")

interface LocatedMember<T, U> {
  readonly team: Named<T, TeamId>
  readonly user: Named<U, UserId>
  readonly teamName: DisplayName
  readonly found: Member
}

/** MemberChangeable authorizes changing user U to newRole in team T as principal P. */
export interface MemberChangeable<P, T, U> extends Proof<"MemberChangeable", [P, T, U]>, LocatedMember<T, U> {
  readonly newRole: Role
}

/** MemberRemovable authorizes principal P to remove user U from team T, including leaving. */
export interface MemberRemovable<P, T, U> extends Proof<"MemberRemovable", [P, T, U]>, LocatedMember<T, U> {}

/** isOwner reports whether both the member and any user who connected their agent are owners. */
const isOwner = <P, T>(member: MemberOf<P, T>) =>
  member.role === "owner" && (member.connectedBy === undefined || member.connectedBy.role === "owner")

const locate = <P, T, U>(member: MemberOf<P, T>, user: Named<U, UserId>) =>
  Effect.gen(function* () {
    const members = yield* Members
    const found = yield* members.person(member.team.value, user.value)
    if (!found) return yield* new MemberNotFound({ team: member.teamName, userId: user.value })
    return found
  })

/** proveMemberChangeable checks that access permits changing user to newRole, including owner restrictions. */
export const proveMemberChangeable = <P, T, U>(
  access: CanManageMembers<P, T>,
  user: Named<U, UserId>,
  newRole: Role,
): Effect.Effect<
  MemberChangeable<P, T, U>,
  MemberNotFound | OwnerChangeNeedsOwner | ServiceAccountCannotBeOwner | DatabaseUnavailable,
  Members | Users
> =>
  Effect.gen(function* () {
    const member = access.member
    const found = yield* locate(member, user)
    if ((found.role === "owner" || newRole === "owner") && !isOwner(member)) {
      return yield* new OwnerChangeNeedsOwner({ team: member.teamName })
    }
    if (newRole === "owner" && (yield* (yield* Users).find(user.value))?.kind === "service-account") {
      return yield* new ServiceAccountCannotBeOwner()
    }
    return MemberChangeableProver.prove([member.principal, member.team, user], {
      team: member.team,
      user,
      teamName: member.teamName,
      found,
      newRole,
    })
  })

/** proveMemberRemovable checks access to remove user; leaving requires the member's signed-in session. */
export const proveMemberRemovable = <P, T, U>(
  member: MemberOf<P, T>,
  access: CanManageMembers<P, T> | undefined,
  user: Named<U, UserId>,
): Effect.Effect<
  MemberRemovable<P, T, U>,
  MemberNotFound | OwnerChangeNeedsOwner | SignInRequired | DatabaseUnavailable,
  Members
> =>
  Effect.gen(function* () {
    const leaving = user.value === member.principal.value.userId
    if (leaving && member.principal.value._tag !== "UserSession") {
      return yield* new SignInRequired({ action: "leave a team" })
    }
    const found = yield* locate(member, user)
    if (!leaving && (!access || (found.role === "owner" && !isOwner(member)))) {
      return yield* new OwnerChangeNeedsOwner({ team: member.teamName })
    }
    return MemberRemovableProver.prove([member.principal, member.team, user], {
      team: member.team,
      user,
      teamName: member.teamName,
      found,
    })
  })

/** MemberInvitable authorizes principal P to invite a user with role into team T. */
export interface MemberInvitable<P, T> extends Proof<"MemberInvitable", [P, T]> {
  readonly member: MemberOf<P, T>
  readonly role: Role
}

export const proveMemberInvitable = <P, T>(
  access: CanManageMembers<P, T>,
  role: Role,
): Effect.Effect<MemberInvitable<P, T>, OwnerChangeNeedsOwner> =>
  Effect.gen(function* () {
    const member = access.member
    if (role === "owner" && !isOwner(member)) return yield* new OwnerChangeNeedsOwner({ team: member.teamName })
    return MemberInvitableProver.prove([member.principal, member.team], { member, role })
  })
