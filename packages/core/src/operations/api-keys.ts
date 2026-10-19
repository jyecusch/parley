import {
  type createApiKey,
  type listApiKeys,
  type OperationInput,
  type Permission,
  RoleLacksPermission,
  type revokeApiKey,
  SignInRequired,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveOwnApiKey } from "../proofs/own-api-key.ts"
import { named } from "../proofs/proof.ts"
import { ApiKeys } from "../services/api-keys.ts"

const DEFAULT_SCOPES: ReadonlyArray<Permission> = ["records:read"]

export const list = (principal: Principal, input: OperationInput<typeof listApiKeys>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const keys = yield* ApiKeys
      const member = yield* proveMemberOf(principal, team)
      return yield* keys.list(member)
    }),
  )

/**
 * Only a signed-in user mints API keys, so a leaked key can't mint more. A key can never
 * carry a permission its owner's role lacks.
 */
export const create = (principal: Principal, input: OperationInput<typeof createApiKey>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      if (principal.value._tag !== "UserSession") return yield* new SignInRequired({ action: "create an API key" })
      const keys = yield* ApiKeys
      const member = yield* proveMemberOf(principal, team)
      const scopes = [...new Set(input.scopes ?? DEFAULT_SCOPES)]
      const beyondRole = scopes.find((scope) => !member.rolePermissions.has(scope))
      if (beyondRole) {
        return yield* new RoleLacksPermission({ team: member.teamName, role: member.role, needed: beyondRole })
      }
      return yield* keys.create(member, { name: input.name, scopes, expiresInDays: input.expiresInDays })
    }),
  )

export const revoke = (principal: Principal, input: OperationInput<typeof revokeApiKey>) =>
  named(principal, input.teamId, input.apiKeyId, (principal, team, apiKey) =>
    Effect.gen(function* () {
      const keys = yield* ApiKeys
      const member = yield* proveMemberOf(principal, team)
      const target = yield* proveOwnApiKey(member, apiKey)
      return yield* keys.revoke(target)
    }),
  )
