import type { createField, deleteField, listFields, OperationInput, updateField } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveCustomFieldInTeam } from "../proofs/custom-field-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanManageFields, proveCanReadRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { CustomFields } from "../services/custom-fields.ts"

export const list = (principal: Principal, input: OperationInput<typeof listFields>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const fields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      return yield* fields.list(team, input.recordType, canRead)
    }),
  )

export const create = (principal: Principal, input: OperationInput<typeof createField>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const fields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canManage = yield* proveCanManageFields(member)
      return yield* fields.create(
        team,
        { recordType: input.recordType, name: input.name, type: input.type, options: input.options ?? [] },
        canManage,
      )
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateField>) =>
  named(principal, input.teamId, input.fieldId, (principal, team, field) =>
    Effect.gen(function* () {
      const fields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canManage = yield* proveCanManageFields(member)
      const target = yield* proveCustomFieldInTeam(team, field, canRead)
      return yield* fields.update(target, input, canManage)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteField>) =>
  named(principal, input.teamId, input.fieldId, (principal, team, field) =>
    Effect.gen(function* () {
      const fields = yield* CustomFields
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canManage = yield* proveCanManageFields(member)
      const target = yield* proveCustomFieldInTeam(team, field, canRead)
      return yield* fields.delete(target, canManage)
    }),
  )
