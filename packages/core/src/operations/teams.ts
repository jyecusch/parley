import {
  type createTeam,
  type listTeams,
  type OperationInput,
  SignInRequired,
  type Team,
  type updateTeam,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanManageTeam } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { Members } from "../services/members.ts"
import { Teams } from "../services/teams.ts"

/** Lists teams the principal can work in. A user's API key and a connection are each bound to one team (D19, D92). */
export const list = (principal: Principal, _input: OperationInput<typeof listTeams>) =>
  Effect.gen(function* () {
    const members = yield* Members
    const teams = yield* members.teamsOf(principal.userId)
    const boundTo =
      principal._tag === "UserApiKey" ||
      principal._tag === "UserConnection" ||
      principal._tag === "ServiceAccountConnection"
        ? principal.teamId
        : null
    const visible = boundTo === null ? teams : teams.filter((team) => team.id === boundTo)
    return visible.map((team): Team => ({ id: team.id, name: team.name, role: team.role, gravatar: team.gravatar }))
  })

/** Creates a team owned by the signed-in user, server-side (D17). */
export const create = (principal: Principal, input: OperationInput<typeof createTeam>) =>
  Effect.gen(function* () {
    if (principal._tag !== "UserSession") return yield* new SignInRequired({ action: "create a team" })
    const teams = yield* Teams
    return yield* teams.create(principal.userId, input.name)
  })

export const update = (principal: Principal, input: OperationInput<typeof updateTeam>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const teams = yield* Teams
      const member = yield* proveMemberOf(principal, team)
      const canManage = yield* proveCanManageTeam(member)
      return yield* teams.update(canManage, input)
    }),
  )
