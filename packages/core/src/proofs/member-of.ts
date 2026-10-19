import {
  ApiKeyNotValidForTeam,
  ConnectionNotValidForTeam,
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

/** What limits a principal beyond its role, and so who can lift the limit. */
export type Ceiling =
  | { readonly _tag: "None" }
  | { readonly _tag: "ApiKey"; readonly scopes: ReadonlySet<Permission> }
  | { readonly _tag: "Connection"; readonly scopes: ReadonlySet<Permission> }

/** P is a current member of team T. Carries what the check found. */
export interface MemberOf<P, T> extends Proof<"MemberOf", [P, T]> {
  readonly principal: Named<P, Principal>
  readonly team: Named<T, TeamId>
  readonly teamName: DisplayName
  /** The role of whoever the principal acts as: a person or a service account. */
  readonly role: Role
  readonly rolePermissions: ReadonlySet<Permission>
  /** Set when a service account acts for someone: that person's role also limits it (D94). */
  readonly connectedBy: { readonly role: Role; readonly rolePermissions: ReadonlySet<Permission> } | undefined
  readonly ceiling: Ceiling
}

const ceilingOf = (principal: Principal): Ceiling => {
  switch (principal._tag) {
    case "UserSession":
      return { _tag: "None" }
    case "UserApiKey":
    case "ServiceAccountApiKey":
      return { _tag: "ApiKey", scopes: principal.scopes }
    case "UserConnection":
    case "ServiceAccountConnection":
      return { _tag: "Connection", scopes: principal.scopes }
  }
}

/** Whether the principal acts as a service account, which changes who an error tells you to ask. */
export const actsAsServiceAccount = (principal: Principal) =>
  principal._tag === "ServiceAccountApiKey" || principal._tag === "ServiceAccountConnection"

/**
 * The only function that knows principals come in kinds. Reduces them all to: which member
 * row, whose role also limits it, and which scope ceiling.
 */
export const proveMemberOf = <P, T>(
  principal: Named<P, Principal>,
  team: Named<T, TeamId>,
): Effect.Effect<
  MemberOf<P, T>,
  NotATeamMember | ApiKeyNotValidForTeam | ConnectionNotValidForTeam | DatabaseUnavailable,
  Members
> =>
  Effect.gen(function* () {
    const p = principal.value
    if (p._tag === "UserApiKey" && p.teamId !== team.value) {
      return yield* new ApiKeyNotValidForTeam({ teamId: team.value })
    }
    if ((p._tag === "UserConnection" || p._tag === "ServiceAccountConnection") && p.teamId !== team.value) {
      return yield* new ConnectionNotValidForTeam({ teamId: team.value })
    }
    const members = yield* Members
    const found = yield* members.lookup(team.value, p.userId)
    if (found._tag === "NotMember") {
      return yield* new NotATeamMember({ teamId: team.value, teamExists: found.teamExists })
    }
    let connectedBy: MemberOf<P, T>["connectedBy"]
    if (p._tag === "ServiceAccountConnection") {
      // The person who connected the agent must still be a member: leaving the team ends it.
      const connector = yield* members.lookup(team.value, p.connectedByUserId)
      if (connector._tag === "NotMember") {
        return yield* new NotATeamMember({ teamId: team.value, teamExists: connector.teamExists })
      }
      connectedBy = { role: connector.role, rolePermissions: ROLE_PERMISSIONS[connector.role] }
    }
    const proof: MemberOf<P, T> = {
      ...MemberOfProver.prove(principal, team),
      principal,
      team,
      teamName: DisplayName.fromRecord(found.teamName),
      role: found.role,
      rolePermissions: ROLE_PERMISSIONS[found.role],
      connectedBy,
      ceiling: ceilingOf(p),
    }
    return proof
  })
