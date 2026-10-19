import { type createTeam, type listTeams, type OperationInput, SignInRequired, type Team } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { Members } from "../services/members.ts"
import { Teams } from "../services/teams.ts"

/** Lists teams the principal can work in. A user's API key is bound to one team (D19). */
export const list = (principal: Principal, _input: OperationInput<typeof listTeams>) =>
  Effect.gen(function* () {
    const members = yield* Members
    const teams = yield* members.teamsOf(principal.userId)
    const visible = principal._tag === "UserApiKey" ? teams.filter((team) => team.id === principal.teamId) : teams
    return visible.map((team): Team => ({ id: team.id, name: team.name, role: team.role }))
  })

/** Creates a team owned by the signed-in user, server-side (D17). */
export const create = (principal: Principal, input: OperationInput<typeof createTeam>) =>
  Effect.gen(function* () {
    if (principal._tag !== "UserSession") return yield* new SignInRequired({ action: "create a team" })
    const teams = yield* Teams
    return yield* teams.create(principal.userId, input.name)
  })
