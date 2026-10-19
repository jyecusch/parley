import type {
  createServiceAccount,
  deleteServiceAccount,
  listServiceAccounts,
  OperationInput,
  updateServiceAccount,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanManageServiceAccounts } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { proveServiceAccountInTeam } from "../proofs/service-account-in-team.ts"
import { ServiceAccounts } from "../services/service-accounts.ts"

/** Any member can see them: they choose one when connecting an agent (D94). */
export const list = (principal: Principal, input: OperationInput<typeof listServiceAccounts>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const serviceAccounts = yield* ServiceAccounts
      const member = yield* proveMemberOf(principal, team)
      return yield* serviceAccounts.list(member)
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createServiceAccount>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const serviceAccounts = yield* ServiceAccounts
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageServiceAccounts(member)
      return yield* serviceAccounts.create(team, { name: input.name, role: input.role ?? "member" }, access)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateServiceAccount>) =>
  named(principal, input.teamId, input.serviceAccountId, (principal, team, serviceAccount) =>
    Effect.gen(function* () {
      const serviceAccounts = yield* ServiceAccounts
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageServiceAccounts(member)
      const target = yield* proveServiceAccountInTeam(member, serviceAccount)
      return yield* serviceAccounts.update(target, input, access)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteServiceAccount>) =>
  named(principal, input.teamId, input.serviceAccountId, (principal, team, serviceAccount) =>
    Effect.gen(function* () {
      const serviceAccounts = yield* ServiceAccounts
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageServiceAccounts(member)
      const target = yield* proveServiceAccountInTeam(member, serviceAccount)
      return yield* serviceAccounts.delete(target, access)
    }),
  )
