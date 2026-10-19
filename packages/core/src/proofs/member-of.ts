import {
  ApiKeyNotValidForTeam,
  type DatabaseUnavailable,
  NotATeamMember,
  type Permission,
  ROLE_PERMISSIONS,
  type Role,
  type TeamId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { Members } from "../services/members.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const MemberOfProver = defineProof("MemberOf")

/** P is a current member of team T. Carries what the check found. */
export interface MemberOf<P, T> extends Proof<"MemberOf", [P, T]> {
  readonly principal: Named<P, Principal>
  readonly team: Named<T, TeamId>
  readonly teamName: DisplayName
  readonly role: Role
  readonly rolePermissions: ReadonlySet<Permission>
  /** The API key's ceiling. Effective permissions = role permissions ∩ scopes. */
  readonly scopes: ReadonlySet<Permission> | "unrestricted"
}

/**
 * The only function that knows principals come in kinds. Reduces all three to:
 * which member row, and which scope ceiling.
 */
export const proveMemberOf = <P, T>(
  principal: Named<P, Principal>,
  team: Named<T, TeamId>,
): Effect.Effect<MemberOf<P, T>, NotATeamMember | ApiKeyNotValidForTeam | DatabaseUnavailable, Members> =>
  Effect.gen(function* () {
    const p = principal.value
    if (p._tag === "UserApiKey" && p.teamId !== team.value) {
      return yield* new ApiKeyNotValidForTeam({ teamId: team.value })
    }
    const members = yield* Members
    const found = yield* members.lookup(team.value, p.userId)
    if (found._tag === "NotMember") {
      return yield* new NotATeamMember({ teamId: team.value, teamExists: found.teamExists })
    }
    const proof: MemberOf<P, T> = {
      ...MemberOfProver.prove(principal, team),
      principal,
      team,
      teamName: DisplayName.fromRecord(found.teamName),
      role: found.role,
      rolePermissions: ROLE_PERMISSIONS[found.role],
      scopes: p._tag === "UserSession" ? "unrestricted" : p.scopes,
    }
    return proof
  })
