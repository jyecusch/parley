import {
  type DatabaseUnavailable,
  type Member,
  MemberNotFound,
  OwnerChangeNeedsOwner,
  type Role,
  ServiceAccountCannotBeOwner,
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

const MemberInTeamProver = defineProof("MemberInTeam")

/**
 * Person U is a member of team T, and the principal may change or remove them: with members:manage,
 * or (for removal) because U is the principal leaving. Changing an owner, or making one, takes an owner.
 */
export interface MemberInTeam<T, U> extends Proof<"MemberInTeam", [T, U]> {
  readonly team: Named<T, TeamId>
  readonly user: Named<U, UserId>
  readonly teamName: DisplayName
  readonly found: Member
}

/** Whether the principal is an owner in full, including whoever connected an agent acting as one (D94). */
/** An owner, and not an agent connected by someone who isn't one. */
export const isOwner = <P, T>(member: MemberOf<P, T>) =>
  member.role === "owner" && (member.connectedBy === undefined || member.connectedBy.role === "owner")

const locate = <P, T, U>(member: MemberOf<P, T>, user: Named<U, UserId>) =>
  Effect.gen(function* () {
    const members = yield* Members
    const found = yield* members.person(member.team.value, user.value)
    if (!found) return yield* new MemberNotFound({ team: member.teamName, userId: user.value })
    return found
  })

/** For a role change: members:manage, plus owner if an owner is involved on either side. */
export const proveMemberChangeable = <P, T, U>(
  access: CanManageMembers<P, T>,
  user: Named<U, UserId>,
  newRole: Role,
): Effect.Effect<
  MemberInTeam<T, U>,
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
    return { ...MemberInTeamProver.prove(member.team, user), team: member.team, user, teamName: member.teamName, found }
  })

/** For removal: members:manage (owner to remove an owner), or the principal leaving the team themselves. */
export const proveMemberRemovable = <P, T, U>(
  member: MemberOf<P, T>,
  access: CanManageMembers<P, T> | undefined,
  user: Named<U, UserId>,
): Effect.Effect<MemberInTeam<T, U>, MemberNotFound | OwnerChangeNeedsOwner | DatabaseUnavailable, Members> =>
  Effect.gen(function* () {
    const found = yield* locate(member, user)
    const leaving = user.value === member.principal.value.userId
    if (!leaving) {
      if (!access || (found.role === "owner" && !isOwner(member))) {
        return yield* new OwnerChangeNeedsOwner({ team: member.teamName })
      }
    }
    return { ...MemberInTeamProver.prove(member.team, user), team: member.team, user, teamName: member.teamName, found }
  })
