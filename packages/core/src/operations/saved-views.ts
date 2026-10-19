import type { createSavedView, deleteSavedView, listSavedViews, OperationInput, updateSavedView } from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import { proveCanReadRecords, proveCanWriteRecords } from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { proveSavedViewEditable } from "../proofs/saved-view.ts"
import { SavedViews } from "../services/saved-views.ts"

export const list = (principal: Principal, input: OperationInput<typeof listSavedViews>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const views = yield* SavedViews
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* views.list(member, input.recordType)
    }),
  )

/** Anyone can save a view for themselves; sharing it with the team needs records:write (D60). */
export const create = (principal: Principal, input: OperationInput<typeof createSavedView>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const views = yield* SavedViews
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      const shareAccess = input.shared ? yield* proveCanWriteRecords(member) : undefined
      return yield* views.create(member, input.recordType, input, shareAccess)
    }),
  )

export const update = (principal: Principal, input: OperationInput<typeof updateSavedView>) =>
  named(principal, input.teamId, input.viewId, (principal, team, view) =>
    Effect.gen(function* () {
      const views = yield* SavedViews
      const member = yield* proveMemberOf(principal, team)
      if (input.shared === true) yield* proveCanWriteRecords(member)
      const target = yield* proveSavedViewEditable(member, view)
      return yield* views.update(target, input)
    }),
  )

export const remove = (principal: Principal, input: OperationInput<typeof deleteSavedView>) =>
  named(principal, input.teamId, input.viewId, (principal, team, view) =>
    Effect.gen(function* () {
      const views = yield* SavedViews
      const member = yield* proveMemberOf(principal, team)
      const target = yield* proveSavedViewEditable(member, view)
      return yield* views.delete(target)
    }),
  )
